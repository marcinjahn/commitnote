use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use soup::prelude::*;

#[derive(Debug, Clone, Default)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub struct TestServer {
    pub port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
    context: glib::MainContext,
    main_loop: glib::MainLoop,
    thread: Option<JoinHandle<()>>,
}

impl TestServer {
    pub fn start() -> Self {
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

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn seen(&self) -> Vec<Seen> {
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
