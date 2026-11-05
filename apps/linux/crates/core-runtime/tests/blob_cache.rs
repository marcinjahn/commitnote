use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use commitnote_core_runtime::services::blob_cache::FileBlobCacheStore;
use commitnote_core_runtime::services::{
    BlobCacheEntry, BlobCacheListing, BlobCacheStore, ServiceError,
};

const SAMPLE_REPO: &str = "sample/notes";
const SAMPLE_REPO_DIRECTORY: &str =
    "5b7b7b25c8efdd20e54c37d95b4d54b56ac6a7660da3ba7c3ba9ec0997b24d15";
const OTHER_REPO: &str = "other/repo";
const OLDER: &str = "1111111111111111111111111111111111111111";
const NEWER: &str = "2222222222222222222222222222222222222222";
const SHA256_ID: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

fn entry(bytes: &[u8], text: bool, last_used_at: f64) -> BlobCacheEntry {
    BlobCacheEntry {
        bytes: bytes.to_vec(),
        text,
        last_used_at,
    }
}

fn recency(store: &FileBlobCacheStore, repo_key: &str) -> Vec<(String, f64)> {
    store
        .list(repo_key)
        .unwrap()
        .into_iter()
        .map(|listing| (listing.blob_sha, listing.last_used_at))
        .collect()
}

fn message<T>(result: Result<T, ServiceError>) -> Option<String> {
    result.err().map(|error| error.message().to_owned())
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn names(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn put_get_list_delete_round_trip() {
    let root = tempfile::tempdir().unwrap();
    let store = FileBlobCacheStore::new(root.path().join("blobs"));
    assert!(store.get(SAMPLE_REPO, OLDER).unwrap().is_none());
    assert!(store.list(SAMPLE_REPO).unwrap().is_empty());

    store
        .put(SAMPLE_REPO, OLDER, entry(b"cipher one", false, 100.0))
        .unwrap();
    store
        .put(SAMPLE_REPO, SHA256_ID, entry(&[0, 255, 7], true, 200.5))
        .unwrap();

    let first = store.get(SAMPLE_REPO, OLDER).unwrap().unwrap();
    assert_eq!(first.bytes, b"cipher one");
    assert!(!first.text);
    assert_eq!(first.last_used_at, 100.0);
    let second = store.get(SAMPLE_REPO, SHA256_ID).unwrap().unwrap();
    assert_eq!(second.bytes, [0, 255, 7]);
    assert!(second.text);
    assert_eq!(
        store.list(SAMPLE_REPO).unwrap(),
        vec![
            BlobCacheListing {
                blob_sha: OLDER.to_owned(),
                size: 10,
                last_used_at: 100.0
            },
            BlobCacheListing {
                blob_sha: SHA256_ID.to_owned(),
                size: 3,
                last_used_at: 200.5
            },
        ]
    );

    store
        .put(SAMPLE_REPO, OLDER, entry(b"replaced", true, 300.0))
        .unwrap();
    let replaced = store.get(SAMPLE_REPO, OLDER).unwrap().unwrap();
    assert_eq!(replaced.bytes, b"replaced");
    assert!(replaced.text);

    store.delete(SAMPLE_REPO, OLDER).unwrap();
    store.delete(SAMPLE_REPO, OLDER).unwrap();
    assert!(store.get(SAMPLE_REPO, OLDER).unwrap().is_none());
    assert_eq!(store.list(SAMPLE_REPO).unwrap().len(), 1);

    let reopened = FileBlobCacheStore::new(root.path().join("blobs"));
    assert_eq!(reopened.list(SAMPLE_REPO).unwrap().len(), 1);
    assert_eq!(
        reopened.get(SAMPLE_REPO, SHA256_ID).unwrap().unwrap().bytes,
        [0, 255, 7]
    );
}

#[test]
fn repos_are_listed_and_deleted() {
    let root = tempfile::tempdir().unwrap();
    let store = FileBlobCacheStore::new(root.path().join("blobs"));
    assert!(store.list_repos().unwrap().is_empty());

    store
        .put(SAMPLE_REPO, OLDER, entry(b"a", false, 1.0))
        .unwrap();
    store
        .put(OTHER_REPO, NEWER, entry(b"b", false, 2.0))
        .unwrap();
    assert_eq!(store.list_repos().unwrap(), vec![OTHER_REPO, SAMPLE_REPO]);

    store.delete_repo(OTHER_REPO).unwrap();
    store.delete_repo(OTHER_REPO).unwrap();
    assert_eq!(store.list_repos().unwrap(), vec![SAMPLE_REPO]);
    assert!(store.get(OTHER_REPO, NEWER).unwrap().is_none());
    assert!(store.get(SAMPLE_REPO, OLDER).unwrap().is_some());
}

#[test]
fn unreadable_repo_directories_are_dropped_from_the_listing() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"a", false, 1.0))
        .unwrap();
    fs::create_dir(blobs.join("stray")).unwrap();
    fs::write(blobs.join("stray").join("index.json"), b"{broken").unwrap();

    assert_eq!(store.list_repos().unwrap(), vec![SAMPLE_REPO]);
    assert!(!blobs.join("stray").exists());
}

#[test]
fn repo_directory_is_named_by_the_sha256_of_the_key() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"a", false, 1.0))
        .unwrap();

    let directory = blobs.join(SAMPLE_REPO_DIRECTORY);
    assert!(directory.is_dir(), "{:?}", names(&blobs));
    assert_eq!(names(&directory), vec![OLDER, "index.json"]);
    let index: serde_json::Value =
        serde_json::from_slice(&fs::read(directory.join("index.json")).unwrap()).unwrap();
    assert_eq!(
        index,
        serde_json::json!({
            "repoKey": SAMPLE_REPO,
            "blobs": {OLDER: {"size": 1, "lastUsedAt": 1.0, "text": false}},
        })
    );
    assert_eq!(fs::read(directory.join(OLDER)).unwrap(), b"a");
}

#[test]
fn directories_are_private_and_files_are_owner_only() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("cache").join("blobs");
    let previous = unsafe { libc::umask(0) };
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"a", false, 1.0))
        .unwrap();
    unsafe { libc::umask(previous) };

    let directory = blobs.join(SAMPLE_REPO_DIRECTORY);
    assert_eq!(mode(&blobs), 0o700);
    assert_eq!(mode(&directory), 0o700);
    assert_eq!(mode(&directory.join(OLDER)), 0o600);
    assert_eq!(mode(&directory.join("index.json")), 0o600);
}

#[test]
fn touched_recency_persists_after_flush() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"one", true, 100.0))
        .unwrap();
    store
        .put(SAMPLE_REPO, NEWER, entry(b"two", true, 200.0))
        .unwrap();

    store.touch(SAMPLE_REPO, OLDER, 300.0).unwrap();

    let stale = FileBlobCacheStore::new(blobs.clone());
    assert_eq!(
        recency(&stale, SAMPLE_REPO),
        vec![(OLDER.to_owned(), 100.0), (NEWER.to_owned(), 200.0)]
    );

    store.flush();

    let fresh = FileBlobCacheStore::new(blobs);
    assert_eq!(
        recency(&fresh, SAMPLE_REPO),
        vec![(OLDER.to_owned(), 300.0), (NEWER.to_owned(), 200.0)]
    );
}

#[test]
fn touched_recency_persists_when_the_store_is_dropped() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"one", true, 100.0))
        .unwrap();
    store.touch(SAMPLE_REPO, OLDER, 300.0).unwrap();
    store.touch(SAMPLE_REPO, NEWER, 400.0).unwrap();

    drop(store);

    let fresh = FileBlobCacheStore::new(blobs);
    assert_eq!(
        recency(&fresh, SAMPLE_REPO),
        vec![(OLDER.to_owned(), 300.0)]
    );
}

#[test]
fn invalid_blob_ids_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    let upper = "A".repeat(40);
    let short = "1".repeat(39);
    let long = "1".repeat(41);
    let traversal = format!("../{}", "1".repeat(37));
    let invalid = [
        "older",
        "",
        upper.as_str(),
        short.as_str(),
        long.as_str(),
        traversal.as_str(),
    ];

    for blob_sha in invalid {
        let expected = Some("Invalid blob id".to_owned());
        assert_eq!(message(store.get(SAMPLE_REPO, blob_sha)), expected);
        assert_eq!(
            message(store.put(SAMPLE_REPO, blob_sha, entry(b"x", false, 1.0))),
            expected
        );
        assert_eq!(message(store.touch(SAMPLE_REPO, blob_sha, 1.0)), expected);
        assert_eq!(message(store.delete(SAMPLE_REPO, blob_sha)), expected);
    }
    assert!(!blobs.exists());
}

#[test]
fn writes_leave_no_temporary_files() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    for round in 0..5 {
        store
            .put(SAMPLE_REPO, OLDER, entry(b"one", false, f64::from(round)))
            .unwrap();
        store
            .put(SAMPLE_REPO, NEWER, entry(b"two", false, f64::from(round)))
            .unwrap();
    }
    store.touch(SAMPLE_REPO, OLDER, 50.0).unwrap();
    store.flush();
    store.delete(SAMPLE_REPO, NEWER).unwrap();

    assert_eq!(names(&blobs), vec![SAMPLE_REPO_DIRECTORY]);
    assert_eq!(
        names(&blobs.join(SAMPLE_REPO_DIRECTORY)),
        vec![OLDER, "index.json"]
    );
}

#[test]
fn a_missing_blob_file_is_dropped_from_the_index() {
    let root = tempfile::tempdir().unwrap();
    let blobs = root.path().join("blobs");
    let store = FileBlobCacheStore::new(blobs.clone());
    store
        .put(SAMPLE_REPO, OLDER, entry(b"one", false, 1.0))
        .unwrap();
    fs::remove_file(blobs.join(SAMPLE_REPO_DIRECTORY).join(OLDER)).unwrap();

    assert!(store.get(SAMPLE_REPO, OLDER).unwrap().is_none());
    assert!(store.list(SAMPLE_REPO).unwrap().is_empty());
}
