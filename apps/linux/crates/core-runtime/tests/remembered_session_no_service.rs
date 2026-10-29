mod common;

use std::path::Path;

use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use commitnote_core_runtime::services::remembered_session::open_remembered_session_store;
use commitnote_core_runtime::services::{
    RememberedSessionRecord, RememberedSessionStore, RepoCoordinates,
};
use zeroize::Zeroizing;

use common::block_on;

fn files_under(directory: &Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(directory) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(files_under(&path));
        } else {
            found.push(path);
        }
    }
    found
}

#[test]
#[ignore = "needs an environment without a Secret Service; run with DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent"]
fn remembered_session_no_service() {
    let home = tempfile::tempdir().unwrap();
    let data = home.path().join("data");
    unsafe {
        std::env::set_var("HOME", home.path());
        std::env::set_var("XDG_DATA_HOME", &data);
    }

    let session = block_on(open_remembered_session_store("test.commitnote.no-service"));
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
    assert_eq!(*loaded.content_key, vec![1; 32]);

    block_on(store.set_persist(false)).unwrap();
    block_on(store.clear()).unwrap();
    assert!(block_on(store.load()).unwrap().is_none());

    assert_eq!(files_under(home.path()), Vec::<std::path::PathBuf>::new());
}
