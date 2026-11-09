mod common;

use std::cell::RefCell;
use std::time::{Duration, Instant};

use commitnote_core_api::commands::{AnalyticsSetCounted, AnalyticsSetCountedParams};
use commitnote_core_runtime::{CoreRuntime, HostServices, SoupVisitSender, VisitSender, run_visit};

use common::test_server::{Seen, TestServer};
use common::{block_on, start_fake};

const FAKE_VISIT_URL: &str = "https://analytics.invalid/count?p=%2Fapp%2Flinux&t=App%20(Linux)";
const SEND_TIMEOUT: Duration = Duration::from_secs(20);
const SETTLE: Duration = Duration::from_millis(300);
const FORBIDDEN_HEADERS: [&str; 5] = [
    "cookie",
    "referer",
    "authorization",
    "content-length",
    "content-type",
];

#[derive(Default)]
struct RecordingSender {
    urls: RefCell<Vec<String>>,
}

impl VisitSender for RecordingSender {
    fn send(&self, url: &str) {
        self.urls.borrow_mut().push(url.to_owned());
    }
}

struct LocalServerSender<'a> {
    inner: SoupVisitSender,
    server: &'a TestServer,
}

impl VisitSender for LocalServerSender<'_> {
    fn send(&self, url: &str) {
        let target = url.replacen("https://analytics.invalid", &self.server.url(""), 1);
        self.inner.send(&target);
    }
}

fn set_counted(runtime: &CoreRuntime, counted: bool) {
    block_on(runtime.request::<AnalyticsSetCounted>(AnalyticsSetCountedParams { counted }))
        .expect("the setting is stored");
}

async fn wait_for_requests(server: &TestServer, count: usize) -> Vec<Seen> {
    let deadline = Instant::now() + SEND_TIMEOUT;
    while server.seen().len() < count {
        assert!(Instant::now() < deadline, "the visit never arrived");
        glib::timeout_future(Duration::from_millis(20)).await;
    }
    glib::timeout_future(SETTLE).await;
    server.seen()
}

#[test]
fn the_core_builds_the_linux_visit_and_the_sender_gets_it_once() {
    let runtime = start_fake(HostServices::default());
    let sender = RecordingSender::default();

    block_on(run_visit(&runtime, &sender));

    assert_eq!(*sender.urls.borrow(), [FAKE_VISIT_URL]);
}

#[test]
fn an_opted_out_visit_sends_nothing_until_the_user_opts_back_in() {
    let runtime = start_fake(HostServices::default());
    let sender = RecordingSender::default();
    set_counted(&runtime, false);

    block_on(run_visit(&runtime, &sender));
    assert!(sender.urls.borrow().is_empty());

    set_counted(&runtime, true);
    block_on(run_visit(&runtime, &sender));
    assert_eq!(sender.urls.borrow().len(), 1);
}

#[test]
fn the_soup_sender_makes_one_anonymous_get() {
    let server = TestServer::start();
    let runtime = start_fake(HostServices::default());

    let seen = block_on(async {
        let sender = LocalServerSender {
            inner: SoupVisitSender::allowing_loopback_http(),
            server: &server,
        };
        run_visit(&runtime, &sender).await;
        wait_for_requests(&server, 1).await
    });

    assert_eq!(seen.len(), 1);
    let request = &seen[0];
    assert_eq!(request.method, "GET");
    assert_eq!(request.path, "/count");
    assert_eq!(
        request.query.as_deref(),
        Some("p=%2Fapp%2Flinux&t=App%20(Linux)")
    );
    assert!(request.body.is_empty());
    for name in FORBIDDEN_HEADERS {
        assert_eq!(request.header(name), None, "unexpected {name} header");
    }
    assert!(
        request
            .header("user-agent")
            .is_none_or(|agent| !agent.contains("commitnote")),
        "the visit identifies the application"
    );
}

#[test]
fn the_soup_sender_refuses_anything_but_https_in_production() {
    let server = TestServer::start();

    block_on(async {
        let sender = SoupVisitSender::new();
        sender.send(&server.url("/count"));
        sender.send("file:///etc/hostname");
        sender.send("not a url");
        glib::timeout_future(SETTLE).await;
    });

    assert!(server.seen().is_empty());
}
