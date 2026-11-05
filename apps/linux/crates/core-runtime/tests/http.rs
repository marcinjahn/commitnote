mod common;

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use commitnote_core_api::CoreErrorKind;
use commitnote_core_api::fake::{FakeHttpRequest, FakeHttpRequestParams, FakeHttpRequestResult};
use commitnote_core_runtime::services::http::{HttpPolicy, SoupHttp, soup_http_factory};
use commitnote_core_runtime::services::{Http, HttpRequest, HttpResponse};
use commitnote_core_runtime::{HostServices, RequestError};
use soup::prelude::*;

use common::{block_on, start_fake};

const FAILURE: &str = "Network request failed";

#[derive(Debug, Clone, Default)]
struct Seen {
    method: String,
    path: String,
    query: Option<String>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

struct TestServer {
    port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
    context: glib::MainContext,
    main_loop: glib::MainLoop,
    thread: Option<JoinHandle<()>>,
}

impl TestServer {
    fn start() -> Self {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let context = glib::MainContext::new();
        let main_loop = glib::MainLoop::new(Some(&context), false);
        let (ready, port) = mpsc::channel();
        let thread = std::thread::spawn({
            let seen = seen.clone();
            let context = context.clone();
            let main_loop = main_loop.clone();
            move || {
                context
                    .with_thread_default(|| {
                        let server = soup::Server::builder().build();
                        server.add_handler(None, move |server, message, path, _| {
                            respond(server, message, path, &seen);
                        });
                        server
                            .listen_local(0, soup::ServerListenOptions::empty())
                            .expect("the server listens");
                        let uri = server.uris().into_iter().next().expect("a listening uri");
                        ready.send(uri.port()).expect("the port is reported");
                        main_loop.run();
                        soup::prelude::ServerExt::disconnect(&server);
                    })
                    .expect("the server context is acquired");
            }
        });
        let port = port.recv().expect("the server starts");
        Self {
            port: u16::try_from(port).expect("a valid port"),
            seen,
            context,
            main_loop,
            thread: Some(thread),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        // A quit before run() starts is lost; invoking it on the loop's context defers it until the loop dispatches.
        let main_loop = self.main_loop.clone();
        self.context.invoke(move || main_loop.quit());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn respond(
    server: &soup::Server,
    message: &soup::ServerMessage,
    path: &str,
    seen: &Mutex<Vec<Seen>>,
) {
    let mut headers = Vec::new();
    if let Some(request_headers) = message.request_headers() {
        request_headers.foreach(|name, value| headers.push((name.to_owned(), value.to_owned())));
    }
    let body = message
        .request_body()
        .and_then(|body| body.flatten())
        .map(|bytes| bytes.to_vec())
        .unwrap_or_default();
    seen.lock().unwrap().push(Seen {
        method: message
            .method()
            .map(|method| method.to_string())
            .unwrap_or_default(),
        path: path.to_owned(),
        query: message
            .uri()
            .and_then(|uri| uri.query())
            .map(|query| query.to_string()),
        headers,
        body,
    });

    let reply = |status: u32, content: &str| {
        message.set_status(status, None);
        message.set_response(
            Some("text/plain"),
            soup::MemoryUse::Copy,
            content.as_bytes(),
        );
    };
    match path {
        "/echo" => {
            reply(201, "reply ✓\nsecond line");
            message
                .response_headers()
                .expect("response headers")
                .append("X-Reply", "Yes");
        }
        "/missing" => reply(404, "missing"),
        "/duplicated" => {
            reply(200, "ok");
            let headers = message.response_headers().expect("response headers");
            headers.append("X-Twice", "one");
            headers.append("X-Twice", "two");
        }
        "/redirect" => {
            message.set_status(302, None);
            message
                .response_headers()
                .expect("response headers")
                .append("Location", "http://example.invalid/");
        }
        "/hang" => server.pause_message(message),
        _ => reply(200, "ok"),
    }
}

fn policy(allow_loopback_http: bool, timeout: Duration) -> HttpPolicy {
    HttpPolicy {
        user_agent: "commitnote-linux/test".to_owned(),
        allow_loopback_http,
        timeout,
    }
}

fn request(
    runtime: &commitnote_core_runtime::CoreRuntime,
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body_text: &str,
) -> Result<FakeHttpRequestResult, RequestError> {
    block_on(
        runtime.request::<FakeHttpRequest>(FakeHttpRequestParams {
            method: method.to_owned(),
            url: url.to_owned(),
            headers: headers
                .iter()
                .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                .collect::<BTreeMap<_, _>>(),
            body_text: body_text.to_owned(),
        }),
    )
}

fn runtime_with(policy: HttpPolicy) -> commitnote_core_runtime::CoreRuntime {
    start_fake(HostServices {
        http: soup_http_factory(policy),
        ..HostServices::default()
    })
}

fn call_directly(
    policy: HttpPolicy,
    method: &str,
    url: &str,
) -> Result<HttpResponse, commitnote_core_runtime::services::ServiceError> {
    let context = glib::MainContext::new();
    context
        .with_thread_default(|| {
            let http: Rc<dyn Http> = Rc::new(SoupHttp::new(policy));
            let future = http.request(HttpRequest {
                method: method.to_owned(),
                url: url.to_owned(),
                headers: Vec::new(),
                body: None,
            });
            context.block_on(glib::future_with_timeout(Duration::from_secs(20), future))
        })
        .expect("the context is acquired")
        .expect("the request settles in time")
}

fn assert_network_failure(result: Result<FakeHttpRequestResult, RequestError>) {
    match result {
        Err(RequestError::Core(error)) => assert!(
            matches!(error.kind, CoreErrorKind::Network | CoreErrorKind::Internal),
            "unexpected kind: {:?}",
            error.kind
        ),
        other => panic!("expected a network failure, got {other:?}"),
    }
}

#[test]
fn request_and_response_round_trip() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    let result = request(
        &runtime,
        "POST",
        &server.url("/echo?x=1"),
        &[
            ("X-Custom-Header", "Value 1"),
            ("Content-Type", "text/plain"),
        ],
        "héllo\nbody",
    )
    .expect("the request succeeds");

    assert_eq!(result.status, 201);
    assert_eq!(
        result.headers.get("x-reply").map(String::as_str),
        Some("Yes")
    );
    assert_eq!(result.body_text, "reply ✓\nsecond line");
    let seen = server.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].path, "/echo");
    assert_eq!(seen[0].query.as_deref(), Some("x=1"));
    assert_eq!(seen[0].header("x-custom-header"), Some("Value 1"));
    assert_eq!(seen[0].header("content-type"), Some("text/plain"));
    assert_eq!(seen[0].body, "héllo\nbody".as_bytes());
}

#[test]
fn bodyless_request_and_error_status() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    let result = request(&runtime, "GET", &server.url("/missing"), &[], "")
        .expect("an error status is not a failure");

    assert_eq!(result.status, 404);
    assert_eq!(result.body_text, "missing");
    let seen = server.seen();
    assert_eq!(seen[0].method, "GET");
    assert!(seen[0].body.is_empty());
}

#[test]
fn duplicated_response_headers_are_joined() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    let result = request(&runtime, "GET", &server.url("/duplicated"), &[], "")
        .expect("the request succeeds");

    assert_eq!(
        result.headers.get("x-twice").map(String::as_str),
        Some("one, two")
    );
}

#[test]
fn service_joins_duplicated_response_headers_itself() {
    let server = TestServer::start();

    let response = call_directly(
        policy(true, Duration::from_secs(60)),
        "GET",
        &server.url("/duplicated"),
    )
    .expect("the request succeeds");

    let twice: Vec<_> = response
        .headers
        .iter()
        .filter(|(name, _)| name == "x-twice")
        .collect();
    assert_eq!(twice.len(), 1);
    assert_eq!(twice[0].1, "one, two");
    assert!(
        response
            .headers
            .iter()
            .all(|(name, _)| *name == name.to_ascii_lowercase())
    );
}

#[test]
fn requests_identify_the_application() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    request(&runtime, "GET", &server.url("/any"), &[], "").expect("the request succeeds");

    assert_eq!(
        server.seen()[0].header("user-agent"),
        Some("commitnote-linux/test")
    );
}

#[test]
fn transport_failure_rejects() {
    let unused_port = {
        let server = TestServer::start();
        server.port
    };
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    assert_network_failure(request(
        &runtime,
        "GET",
        &format!("http://127.0.0.1:{unused_port}/"),
        &[],
        "",
    ));
    let error = call_directly(
        policy(true, Duration::from_secs(60)),
        "GET",
        &format!("http://127.0.0.1:{unused_port}/"),
    )
    .expect_err("nothing is listening");
    assert_eq!(error.message(), FAILURE);
}

#[test]
fn unanswered_request_times_out() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(true, Duration::from_secs(1)));
    let started = Instant::now();

    assert_network_failure(request(&runtime, "GET", &server.url("/hang"), &[], ""));

    assert!(started.elapsed() < Duration::from_secs(10));
    let error = call_directly(
        policy(true, Duration::from_secs(1)),
        "GET",
        &server.url("/hang"),
    )
    .expect_err("the server never answers");
    assert_eq!(error.message(), FAILURE);
    assert_eq!(server.seen().len(), 2);
}

#[test]
fn loopback_http_is_refused_unless_allowed() {
    let server = TestServer::start();
    let runtime = runtime_with(policy(false, Duration::from_secs(60)));

    assert_network_failure(request(&runtime, "GET", &server.url("/echo"), &[], ""));
    let error = call_directly(
        policy(false, Duration::from_secs(60)),
        "GET",
        &server.url("/echo"),
    )
    .expect_err("plain http is refused");

    assert_eq!(error.message(), FAILURE);
    assert!(server.seen().is_empty());
}

#[test]
fn other_schemes_and_hosts_are_always_refused() {
    let runtime = runtime_with(policy(true, Duration::from_secs(60)));

    for url in [
        "ftp://127.0.0.1/file",
        "http://example.invalid/",
        "http://127.0.0.1.example.invalid/",
        "http://127.0.0.1@example.invalid/",
        "file:///etc/hostname",
        "not a url",
    ] {
        assert_network_failure(request(&runtime, "GET", url, &[], ""));
        let error = call_directly(policy(true, Duration::from_secs(60)), "GET", url)
            .expect_err("the url is refused");
        assert_eq!(error.message(), FAILURE);
    }
}

#[test]
fn redirects_to_disallowed_targets_are_refused() {
    let server = TestServer::start();

    let error = call_directly(
        policy(true, Duration::from_secs(60)),
        "GET",
        &server.url("/redirect"),
    )
    .expect_err("the redirect is refused");

    assert_eq!(error.message(), FAILURE);
    assert_eq!(server.seen().len(), 1);
}

#[test]
fn dropping_a_pending_request_leaves_the_service_usable() {
    let server = TestServer::start();
    let context = glib::MainContext::new();

    let response = context
        .with_thread_default(|| {
            let http = SoupHttp::new(policy(true, Duration::from_secs(60)));
            let get = |path: &str| {
                http.request(HttpRequest {
                    method: "GET".to_owned(),
                    url: server.url(path),
                    headers: Vec::new(),
                    body: None,
                })
            };
            let abandoned = context.block_on(glib::future_with_timeout(
                Duration::from_millis(300),
                get("/hang"),
            ));
            assert!(abandoned.is_err(), "the pending request is dropped");
            context.block_on(glib::future_with_timeout(
                Duration::from_secs(20),
                get("/echo"),
            ))
        })
        .expect("the context is acquired")
        .expect("the request settles in time")
        .expect("the request succeeds");

    assert_eq!(response.status, 201);
}
