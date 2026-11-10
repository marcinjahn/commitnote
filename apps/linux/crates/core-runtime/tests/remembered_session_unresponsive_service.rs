mod common;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use commitnote_core_runtime::services::remembered_session::open_remembered_session_store;
use commitnote_core_runtime::services::{
    RememberedSessionRecord, RememberedSessionStore, RepoCoordinates,
};
use zeroize::Zeroizing;

use common::block_on;

const SERVICE_NAME: &str = "org.freedesktop.secrets";
const SERVICE_PATH: &str = "/org/freedesktop/secrets";
const SERVICE_XML: &str = r#"
<node>
  <interface name="org.freedesktop.Secret.Service">
    <method name="OpenSession">
      <arg direction="in" type="s" name="algorithm"/>
      <arg direction="in" type="v" name="input"/>
      <arg direction="out" type="v" name="output"/>
      <arg direction="out" type="o" name="result"/>
    </method>
  </interface>
</node>
"#;
const MINIMUM_WAIT: Duration = Duration::from_secs(4);
const MAXIMUM_WAIT: Duration = Duration::from_secs(15);

/// Owns the Secret Service name and accepts every call without ever answering it.
fn serve_unresponsive_secret_service() {
    let (ready, acquired) = mpsc::channel();
    thread::spawn(move || {
        let context = glib::MainContext::new();
        let main_loop = glib::MainLoop::new(Some(&context), false);
        let run = context.with_thread_default(|| {
            let unanswered = Rc::new(RefCell::new(Vec::new()));
            let node = gio::DBusNodeInfo::for_xml(SERVICE_XML).expect("valid introspection");
            let interface = node
                .lookup_interface("org.freedesktop.Secret.Service")
                .expect("the interface is declared");
            let _owner = gio::bus_own_name(
                gio::BusType::Session,
                SERVICE_NAME,
                gio::BusNameOwnerFlags::NONE,
                move |connection, _| {
                    let unanswered = unanswered.clone();
                    connection
                        .register_object(SERVICE_PATH, &interface)
                        .method_call(move |_, _, _, _, _, _, invocation| {
                            unanswered.borrow_mut().push(invocation);
                        })
                        .build()
                        .expect("the object registers");
                },
                move |_, _| ready.send(()).expect("the test is waiting"),
                |_, _| {},
            );
            main_loop.run();
        });
        run.expect("the service thread owns its context");
    });
    acquired
        .recv_timeout(Duration::from_secs(10))
        .expect("the fake Secret Service owns its name");
}

#[test]
#[ignore = "needs a session bus without a Secret Service; run under dbus-run-session"]
fn remembered_session_unresponsive_service() {
    let home = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home.path());
        std::env::set_var("XDG_DATA_HOME", home.path().join("data"));
    }
    serve_unresponsive_secret_service();

    let started = Instant::now();
    let session = block_on(open_remembered_session_store(
        "test.commitnote.unresponsive-service",
    ));
    let waited = started.elapsed();
    assert!(
        waited >= MINIMUM_WAIT,
        "the service was never waited for: {waited:?}"
    );
    assert!(
        waited < MAXIMUM_WAIT,
        "the wait was not bounded: {waited:?}"
    );
    assert!(!session.keyring_available);

    let store = session.store;
    assert!(block_on(store.load()).unwrap().is_none());
    block_on(store.save(RememberedSessionRecord {
        repo_url: "https://github.com/test/notes".to_owned(),
        coordinates: RepoCoordinates {
            forge: ForgeKind::Github,
            owner: "test".to_owned(),
            repo: "notes".to_owned(),
        },
        access_token: Secret::new("token"),
        content_key: Zeroizing::new(vec![1; 32]),
        name_key: Zeroizing::new(vec![2; 32]),
        name_iv_key: Zeroizing::new(vec![3; 32]),
        key_check_key: Zeroizing::new(vec![4; 32]),
    }))
    .unwrap();
    let loaded = block_on(store.load()).unwrap().expect("kept in memory");
    assert_eq!(loaded.access_token.expose(), "token");
}
