mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use commitnote_core_api::commands::{
    ForgesList, ForgesListParams, SessionLogout, SessionLogoutParams,
};
use commitnote_core_api::fake::{FakeTimerProbe, FakeTimerProbeParams};
use commitnote_core_api::shapes::SessionEndReason;
use commitnote_core_api::{CoreErrorKind, CoreEvent, NATIVE_CORE_MARKER};
use commitnote_core_runtime::services::{DeviceSettingsStore, ServiceError};
use commitnote_core_runtime::{CoreRuntime, HostServices, RequestError, RuntimeConfig, StartError};
use serde_json::json;

use common::{block_on, core_bundle, start_fake};

fn start_bundle(bundle: String) -> Result<CoreRuntime, StartError> {
    CoreRuntime::start(RuntimeConfig::new(bundle, "Linux"))
}

fn synthetic_bundle(marker: &str, api_version: u32, start_body: &str) -> String {
    format!(
        "globalThis.CommitnoteNativeCore = {{ marker: {marker:?}, apiVersion: {api_version}, start(host) {{ {start_body} }} }};"
    )
}

const PROBE_START: &str = r#"
  const reply = (id, result) =>
    host.post(JSON.stringify({ kind: "response", id, ok: true, result }));
  const message = (action) => {
    try {
      action();
      return null;
    } catch (error) {
      return error.message;
    }
  };
  const commands = {
    bytes() {
      const view = new Uint8Array([0, 0x61, 0x62, 0x63, 0]).subarray(1, 4);
      const digest = host.crypto.digest("SHA-256", view);
      return {
        digest: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        isUint8Array: digest instanceof Uint8Array,
        notBytes: message(() => host.crypto.digest("SHA-256", [1, 2, 3])),
        notFunction: message(() => host.clock.setTimeout(42, 1)),
      };
    },
    async storage() {
      await host.blobCache.put("repo", "sha", {
        bytes: new Uint8Array([1, 2, 3]),
        text: false,
        lastUsedAt: 5,
      });
      const entry = await host.blobCache.get("repo", "sha");
      const rejection = await host.imageCodec.decode(new Uint8Array([1])).then(
        () => null,
        (error) => (error instanceof Error ? error.message : "not an Error"),
      );
      return { bytes: Array.from(entry.bytes), lastUsedAt: entry.lastUsedAt, rejection };
    },
  };
  return {
    send(text) {
      const request = JSON.parse(text);
      Promise.resolve(commands[request.command]()).then((result) => reply(request.id, result));
    },
    stop() {},
  };
"#;

#[test]
fn production_bundle_answers_forges_list() {
    let runtime = start_bundle(core_bundle()).expect("the core starts");

    let result = block_on(runtime.request::<ForgesList>(ForgesListParams {})).expect("forges.list");

    assert!(!result.forges.is_empty());
}

#[test]
fn bundle_with_another_api_version_is_rejected() {
    let bundle = synthetic_bundle(NATIVE_CORE_MARKER, 999, "return { send() {}, stop() {} };");

    let error = start_bundle(bundle).err();

    assert_eq!(
        error,
        Some(StartError::ApiVersionMismatch {
            expected: 7,
            found: 999
        })
    );
}

#[test]
fn bundle_with_wrong_marker_is_invalid() {
    let bundle = synthetic_bundle("another-core", 7, "return { send() {}, stop() {} };");

    assert_eq!(start_bundle(bundle).err(), Some(StartError::BundleInvalid));
}

#[test]
fn bundle_without_global_is_invalid() {
    assert_eq!(
        start_bundle("globalThis.Something = {};".to_owned()).err(),
        Some(StartError::BundleInvalid)
    );
}

#[test]
fn start_returning_nothing_is_invalid() {
    let bundle = synthetic_bundle(NATIVE_CORE_MARKER, 7, "return null;");

    assert_eq!(start_bundle(bundle).err(), Some(StartError::BundleInvalid));
}

#[test]
fn throwing_bundle_reports_the_exception() {
    let error = start_bundle("throw new Error(\"broken bundle\");".to_owned()).err();

    assert_eq!(
        error,
        Some(StartError::JavaScriptException("broken bundle".to_owned()))
    );
}

#[test]
fn throwing_start_reports_the_exception() {
    let bundle = synthetic_bundle(NATIVE_CORE_MARKER, 7, "throw new Error(\"start failed\");");

    assert_eq!(
        start_bundle(bundle).err(),
        Some(StartError::JavaScriptException("start failed".to_owned()))
    );
}

#[test]
fn timers_fire_in_delay_order_and_can_be_cancelled() {
    let runtime = start_fake(HostServices::default());
    let started = Instant::now();

    let result = block_on(runtime.request::<FakeTimerProbe>(FakeTimerProbeParams {
        delays_ms: vec![50, 10, 30],
        cancel_index: Some(0),
    }))
    .expect("fake.timerProbe");

    assert_eq!(result.fired, vec![1, 2]);
    assert!(started.elapsed() >= Duration::from_millis(30));
}

#[test]
fn unknown_command_answers_with_unknown_command_error() {
    let runtime = start_fake(HostServices::default());

    let result = block_on(runtime.send("no.suchCommand", json!({})));

    match result {
        Err(RequestError::Core(error)) => assert_eq!(error.kind, CoreErrorKind::UnknownCommand),
        other => panic!("expected an unknownCommand error, got {other:?}"),
    }
}

#[test]
fn stop_fails_pending_requests_and_is_idempotent() {
    let runtime = start_fake(HostServices::default());
    let pending = runtime.request::<FakeTimerProbe>(FakeTimerProbeParams {
        delays_ms: vec![60_000],
        cancel_index: None,
    });

    runtime.stop();
    runtime.stop();

    assert_eq!(block_on(pending).err(), Some(RequestError::Stopped));
    assert_eq!(
        block_on(runtime.send("forges.list", json!({}))).err(),
        Some(RequestError::Stopped)
    );
}

struct DropProbe {
    dropped_on: Arc<Mutex<Option<String>>>,
}

impl DeviceSettingsStore for DropProbe {
    fn get_item(&mut self, _key: &str) -> Option<String> {
        None
    }

    fn set_item(&mut self, _key: &str, _value: &str) -> Result<(), ServiceError> {
        Ok(())
    }

    fn remove_item(&mut self, _key: &str) -> Result<(), ServiceError> {
        Ok(())
    }
}

impl Drop for DropProbe {
    fn drop(&mut self) {
        let name = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_owned();
        *self.dropped_on.lock().unwrap() = Some(name);
    }
}

#[test]
fn dropping_the_runtime_tears_down_the_core_thread() {
    let dropped_on = Arc::new(Mutex::new(None));
    let runtime = start_fake(HostServices {
        device_settings: Box::new(DropProbe {
            dropped_on: dropped_on.clone(),
        }),
        ..HostServices::default()
    });

    drop(runtime);

    assert_eq!(
        dropped_on.lock().unwrap().as_deref(),
        Some("commitnote-core")
    );
}

fn next_session_end(events: &async_channel::Receiver<CoreEvent>) -> SessionEndReason {
    loop {
        match block_on(events.recv()).expect("the event stream stays open") {
            CoreEvent::SessionEnded { reason } => return reason,
            _ => continue,
        }
    }
}

#[test]
fn every_subscriber_receives_events() {
    let runtime = start_fake(HostServices::default());
    let first = runtime.subscribe();
    let second = runtime.subscribe();

    block_on(runtime.request::<SessionLogout>(SessionLogoutParams { anyway: false }))
        .expect("session.logout");

    assert_eq!(next_session_end(&first), SessionEndReason::LoggedOut);
    assert_eq!(next_session_end(&second), SessionEndReason::LoggedOut);
}

#[test]
fn subscribers_are_closed_when_the_runtime_stops() {
    let runtime = start_fake(HostServices::default());
    let events = runtime.subscribe();

    runtime.stop();

    assert!(block_on(events.recv()).is_err());
}

#[test]
fn host_converts_bytes_and_validates_arguments() {
    let runtime = start_bundle(synthetic_bundle(NATIVE_CORE_MARKER, 7, PROBE_START))
        .expect("the probe starts");

    let result = block_on(runtime.send("bytes", json!({}))).expect("bytes");

    assert_eq!(
        result,
        json!({
            "digest": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "isUint8Array": true,
            "notBytes": "Expected a Uint8Array",
            "notFunction": "The callback must be a function",
        })
    );
}

#[test]
fn host_promises_resolve_and_reject_on_the_core_thread() {
    let runtime = start_bundle(synthetic_bundle(NATIVE_CORE_MARKER, 7, PROBE_START))
        .expect("the probe starts");

    let result = block_on(runtime.send("storage", json!({}))).expect("storage");

    assert_eq!(
        result,
        json!({
            "bytes": [1, 2, 3],
            "lastUsedAt": 5,
            "rejection": "Image processing is not available",
        })
    );
}

const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<CoreRuntime>();
};
