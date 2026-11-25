mod common;

use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use commitnote_core_runtime::services::remembered_session::open_remembered_session_store_with;
use commitnote_core_runtime::services::{
    RememberedSessionRecord, RememberedSessionStore, RepoCoordinates,
};
use serde_json::{Value, json};
use tempfile::TempDir;
use zeroize::Zeroizing;

use common::block_on;

/// Implements the shim's protocol for the one record the app keeps, stored next to the link it is
/// run through. Relies on `value` being the request's last field.
const FAKE_SHIM: &str = r#"#!/bin/sh
set -eu
[ "$#" -eq 0 ] || exit 2
state=$(dirname "$0")
request=$(cat)
printf '%s\n' "$request" >> "$state/requests"
case "$request" in
  *'"operation":"put"'*)
    value=${request#*,\"value\":}
    printf '%s' "${value%\}}" > "$state/value"
    echo '{"entries":[],"changed":true}'
    ;;
  *'"operation":"search"'*)
    if [ -f "$state/value" ]; then
      printf '{"entries":[{"attributes":{},"value":%s}],"changed":false}\n' "$(cat "$state/value")"
    else
      echo '{"entries":[],"changed":false}'
    fi
    ;;
  *'"operation":"delete"'*)
    rm -f "$state/value"
    echo '{"entries":[],"changed":true}'
    ;;
  *)
    echo 'unsupported secret operation' >&2
    exit 1
    ;;
esac
"#;

const FAILING_SHIM: &str = r#"#!/bin/sh
cat > /dev/null
echo 'secure credential storage is unavailable or locked' >&2
exit 1
"#;

/// Written once and linked into each test's directory: executing a file another thread still
/// holds open for writing fails with ETXTBSY.
fn shims() -> &'static Path {
    static SHIMS: OnceLock<TempDir> = OnceLock::new();
    SHIMS
        .get_or_init(|| {
            let directory = tempfile::tempdir().unwrap();
            for (name, script) in [("fake", FAKE_SHIM), ("failing", FAILING_SHIM)] {
                let path = directory.path().join(name);
                std::fs::write(&path, script).unwrap();
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            directory
        })
        .path()
}

fn shim_in(directory: &TempDir, kind: &str) -> PathBuf {
    let path = directory.path().join("cpak-secrets");
    symlink(shims().join(kind), &path).unwrap();
    path
}

fn requests(directory: &TempDir) -> Vec<Value> {
    std::fs::read_to_string(directory.path().join("requests"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

const APP_ID: &str = "test.commitnote.cpak";

fn record(token: &str) -> RememberedSessionRecord {
    RememberedSessionRecord {
        repo_url: "https://github.com/test/notes".to_owned(),
        coordinates: RepoCoordinates {
            forge: ForgeKind::Github,
            owner: "test".to_owned(),
            repo: "notes".to_owned(),
        },
        access_token: Secret::new(token),
        content_key: Zeroizing::new(vec![1; 32]),
        name_key: Zeroizing::new(vec![2; 32]),
        name_iv_key: Zeroizing::new(vec![3; 32]),
        key_check_key: Zeroizing::new(vec![4; 32]),
    }
}

fn assert_same(actual: &RememberedSessionRecord, expected: &RememberedSessionRecord) {
    assert_eq!(actual.repo_url, expected.repo_url);
    assert!(actual.coordinates == expected.coordinates);
    assert_eq!(actual.access_token.expose(), expected.access_token.expose());
    assert_eq!(*actual.content_key, *expected.content_key);
    assert_eq!(*actual.name_key, *expected.name_key);
    assert_eq!(*actual.name_iv_key, *expected.name_iv_key);
    assert_eq!(*actual.key_check_key, *expected.key_check_key);
}

#[test]
fn round_trips_through_the_shim_across_reopening() {
    let directory = tempfile::tempdir().unwrap();
    let shim = shim_in(&directory, "fake");

    let session = block_on(open_remembered_session_store_with(APP_ID, &shim));
    assert!(session.keyring_available);
    let store = session.store;
    assert!(block_on(store.load()).unwrap().is_none());

    block_on(store.save(record("token"))).unwrap();
    block_on(store.save(record("other-token"))).unwrap();
    assert_same(
        &block_on(store.load()).unwrap().unwrap(),
        &record("other-token"),
    );

    let reopened = block_on(open_remembered_session_store_with(APP_ID, &shim)).store;
    assert_same(
        &block_on(reopened.load()).unwrap().unwrap(),
        &record("other-token"),
    );

    block_on(reopened.clear()).unwrap();
    assert!(block_on(reopened.load()).unwrap().is_none());
    assert!(!directory.path().join("value").exists());
}

#[test]
fn requests_carry_the_item_attributes_and_the_record() {
    let directory = tempfile::tempdir().unwrap();
    let shim = shim_in(&directory, "fake");
    let store = block_on(open_remembered_session_store_with(APP_ID, &shim)).store;
    block_on(store.save(record("token"))).unwrap();
    block_on(store.set_persist(false)).unwrap();

    let attributes = json!({"application": APP_ID, "kind": "remembered-session"});
    let key = |byte: u8| STANDARD.encode([byte; 32]);
    let sent = requests(&directory);
    assert_eq!(sent.len(), 3);
    assert_eq!(
        sent[0],
        json!({"operation": "search", "attributes": attributes})
    );
    assert_eq!(sent[1]["operation"], "put");
    assert_eq!(sent[1]["attributes"], attributes);
    let value: Value = serde_json::from_str(sent[1]["value"].as_str().unwrap()).unwrap();
    assert_eq!(
        value,
        json!({
            "repoUrl": "https://github.com/test/notes",
            "coordinates": {"forge": "github", "owner": "test", "repo": "notes"},
            "accessToken": "token",
            "keys": {
                "contentKey": key(1),
                "nameKey": key(2),
                "nameIvKey": key(3),
                "keyCheckKey": key(4),
            },
        })
    );
    assert_eq!(
        sent[2],
        json!({"operation": "delete", "attributes": attributes})
    );
}

#[test]
fn a_failing_shim_keeps_the_session_in_memory_only() {
    let directory = tempfile::tempdir().unwrap();
    let shim = shim_in(&directory, "failing");

    let session = block_on(open_remembered_session_store_with(APP_ID, &shim));
    assert!(!session.keyring_available);

    let store = session.store;
    assert!(block_on(store.load()).unwrap().is_none());
    block_on(store.save(record("token"))).unwrap();
    assert_same(&block_on(store.load()).unwrap().unwrap(), &record("token"));
    block_on(store.set_persist(false)).unwrap();
    block_on(store.clear()).unwrap();
    assert!(block_on(store.load()).unwrap().is_none());
}

#[test]
fn without_the_shim_the_keyring_is_used() {
    let directory = tempfile::tempdir().unwrap();
    let session = block_on(open_remembered_session_store_with(
        &format!("test.commitnote.no-cpak.{}", std::process::id()),
        &directory.path().join("cpak-secrets"),
    ));
    assert!(session.keyring_available);
    block_on(session.store.clear()).unwrap();
}
