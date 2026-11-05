mod common;

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use commitnote_core_api::commands::{
    LoginInspectRepository, LoginInspectRepositoryParams, LoginListRepositories,
    LoginListRepositoriesParams, LoginUnlock, LoginUnlockParams, SessionLogout,
    SessionLogoutParams, SessionResume, SessionResumeParams, SessionResumeResult, TreeGet,
    TreeGetParams,
};
use commitnote_core_api::shapes::{ForgeKind, LogoutOutcome, TreeNode};
use commitnote_core_api::{CoreEvent, Secret};
use commitnote_core_runtime::services::remembered_session::{
    HostRememberedSession, open_remembered_session_store,
};
use commitnote_core_runtime::services::{
    RememberedSessionRecord, RememberedSessionStore, RepoCoordinates,
};
use commitnote_core_runtime::{CoreRuntime, HostServices};
use serde_json::json;
use zeroize::Zeroizing;

use common::{block_on, start_fake};

const ITEM_LABEL: &str = "commitnote remembered session";

fn app_id(name: &str) -> String {
    format!("test.commitnote.{name}.{}", std::process::id())
}

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

fn open_keyring_store(app_id: &str) -> Arc<HostRememberedSession> {
    let session = block_on(open_remembered_session_store(app_id));
    assert!(session.keyring_available);
    session.store
}

async fn stored_items(app_id: &str) -> Vec<oo7::dbus::Item> {
    let service = oo7::dbus::Service::new().await.expect("Secret Service");
    let collection = service
        .default_collection()
        .await
        .expect("default collection");
    collection
        .search_items(&[("application", app_id), ("kind", "remembered-session")])
        .await
        .expect("search")
}

#[test]
fn store_round_trip() {
    let id = app_id("round-trip");
    let store = open_keyring_store(&id);

    assert!(block_on(store.load()).unwrap().is_none());

    let saved = record("token");
    block_on(store.save(saved.clone())).unwrap();
    assert_same(&block_on(store.load()).unwrap().unwrap(), &saved);

    let replacement = record("other-token");
    block_on(store.save(replacement.clone())).unwrap();
    assert_same(&block_on(store.load()).unwrap().unwrap(), &replacement);
    assert_eq!(block_on(stored_items(&id)).len(), 1);

    block_on(store.clear()).unwrap();
    assert!(block_on(store.load()).unwrap().is_none());
    assert!(block_on(stored_items(&id)).is_empty());
}

#[test]
fn item_holds_the_documented_secret_and_attributes() {
    let id = app_id("item-shape");
    let store = open_keyring_store(&id);
    block_on(store.save(record("token"))).unwrap();

    let items = block_on(stored_items(&id));
    assert_eq!(items.len(), 1);
    let item = &items[0];
    assert_eq!(block_on(item.label()).unwrap(), ITEM_LABEL);
    let mut attributes = block_on(item.attributes()).unwrap();
    attributes.remove(oo7::XDG_SCHEMA_ATTRIBUTE);
    assert_eq!(
        attributes,
        HashMap::from([
            ("application".to_owned(), id.clone()),
            ("kind".to_owned(), "remembered-session".to_owned()),
        ])
    );
    let secret = block_on(item.secret()).unwrap();
    let json: serde_json::Value = serde_json::from_slice(secret.as_bytes()).unwrap();
    let key = |byte: u8| STANDARD.encode([byte; 32]);
    assert_eq!(
        json,
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

    block_on(store.clear()).unwrap();
}

#[test]
fn disabling_persistence_removes_the_item_and_keeps_memory() {
    let id = app_id("persist");
    let store = open_keyring_store(&id);
    block_on(store.save(record("token"))).unwrap();
    assert_eq!(block_on(stored_items(&id)).len(), 1);

    block_on(store.set_persist(false)).unwrap();
    assert!(block_on(stored_items(&id)).is_empty());
    assert_same(&block_on(store.load()).unwrap().unwrap(), &record("token"));

    let memory_only = record("memory-token");
    block_on(store.save(memory_only.clone())).unwrap();
    assert!(block_on(stored_items(&id)).is_empty());
    assert_same(&block_on(store.load()).unwrap().unwrap(), &memory_only);

    block_on(store.set_persist(true)).unwrap();
    block_on(store.save(record("persisted"))).unwrap();
    assert_eq!(block_on(stored_items(&id)).len(), 1);
    assert_same(
        &block_on(store.load()).unwrap().unwrap(),
        &record("persisted"),
    );

    block_on(store.clear()).unwrap();
    assert!(block_on(stored_items(&id)).is_empty());
    assert!(block_on(store.load()).unwrap().is_none());
}

fn runtime_with(store: &Arc<HostRememberedSession>) -> CoreRuntime {
    start_fake(HostServices {
        remembered_session: store.clone(),
        ..HostServices::default()
    })
}

fn wait_for_tree(
    runtime: &CoreRuntime,
    events: &async_channel::Receiver<CoreEvent>,
) -> Vec<TreeNode> {
    if let Some(tree) = block_on(runtime.request::<TreeGet>(TreeGetParams {}))
        .unwrap()
        .tree
    {
        return tree;
    }
    loop {
        if let CoreEvent::TreeChanged(changed) =
            block_on(events.recv()).expect("the event stream stays open")
            && let Some(tree) = changed.tree
        {
            return tree;
        }
    }
}

fn log_in(runtime: &CoreRuntime) {
    let token = Secret::new("any-token");
    let listing = block_on(
        runtime.request::<LoginListRepositories>(LoginListRepositoriesParams {
            forge: ForgeKind::Github,
            access_token: token.clone(),
        }),
    )
    .unwrap();
    let repository = listing
        .repositories
        .iter()
        .find(|repository| repository.url == "https://github.com/sample/notes")
        .expect("the sample repository is listed");
    block_on(
        runtime.request::<LoginInspectRepository>(LoginInspectRepositoryParams {
            forge: ForgeKind::Github,
            access_token: token,
            repository_url: repository.url.clone(),
        }),
    )
    .unwrap();
    block_on(runtime.request::<LoginUnlock>(LoginUnlockParams {
        passphrase: Secret::new("sample notes repo passphrase"),
    }))
    .unwrap();
}

#[test]
fn logged_in_session_resumes_in_a_new_runtime_and_logout_clears_it() {
    let id = app_id("resume");
    let store = open_keyring_store(&id);

    let first = runtime_with(&store);
    let events = first.subscribe();
    log_in(&first);
    assert!(!wait_for_tree(&first, &events).is_empty());
    drop(first);
    assert_eq!(block_on(stored_items(&id)).len(), 1);

    let store = open_keyring_store(&id);
    let second = runtime_with(&store);
    let events = second.subscribe();
    let resumed = block_on(second.request::<SessionResume>(SessionResumeParams {})).unwrap();
    assert_eq!(resumed, SessionResumeResult::Resumed);
    assert!(!wait_for_tree(&second, &events).is_empty());

    let logout =
        block_on(second.request::<SessionLogout>(SessionLogoutParams { anyway: false })).unwrap();
    assert_eq!(logout.outcome, LogoutOutcome::LoggedOut);
    drop(second);
    assert!(block_on(stored_items(&id)).is_empty());

    let store = open_keyring_store(&id);
    let third = runtime_with(&store);
    let resumed = block_on(third.request::<SessionResume>(SessionResumeParams {})).unwrap();
    assert_eq!(resumed, SessionResumeResult::None);
}
