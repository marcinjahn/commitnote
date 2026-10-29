#![allow(dead_code)]

use std::future::Future;
use std::time::Duration;

use commitnote_core_runtime::{CoreRuntime, HostServices, RuntimeConfig};

const CORE_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../dist-native-core/commitnote-core.js"
);
const FAKE_CORE_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../dist-native-core-fake/commitnote-core.js"
);
const TEST_TIMEOUT: Duration = Duration::from_secs(30);

fn read_bundle(path: &str) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|_| panic!("run `npm run build:native-core` first"))
}

pub fn core_bundle() -> String {
    read_bundle(CORE_BUNDLE)
}

pub fn fake_core_bundle() -> String {
    read_bundle(FAKE_CORE_BUNDLE)
}

pub fn start_fake(services: HostServices) -> CoreRuntime {
    CoreRuntime::start(RuntimeConfig {
        bundle: fake_core_bundle(),
        device_model: "Linux".to_owned(),
        services,
    })
    .expect("the fake core starts")
}

/// Fails the test instead of hanging when the future never completes.
pub fn block_on<F: Future>(future: F) -> F::Output {
    glib::MainContext::new()
        .block_on(glib::future_with_timeout(TEST_TIMEOUT, future))
        .expect("the future completes in time")
}
