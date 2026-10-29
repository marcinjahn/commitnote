mod common;

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use commitnote_core_api::commands::{
    LoginInitialize, LoginInitializeParams, LoginInspectRepository, LoginInspectRepositoryParams,
    LoginInspectRepositoryResult, LoginListRepositories, LoginListRepositoriesParams, LoginUnlock,
    LoginUnlockParams, NoteOpen, NoteOpenParams, TreeGet, TreeGetParams,
};
use commitnote_core_api::fake::{
    FakeExpectedSampleNotes, FakeExpectedSampleNotesParams, FakeExportRepo, FakeExportRepoParams,
    FakeRemoteEdit, FakeRemoteEditParams, FakeSaveNote, FakeSaveNoteParams,
};
use commitnote_core_api::shapes::{ForgeKind, OpenNote, TreeNode};
use commitnote_core_api::{CoreEvent, Secret};
use commitnote_core_runtime::{CoreRuntime, HostServices};
use serde_json::{Value, json};

use common::start_fake;

const DEVICE_MODEL: &str = "Linux";
const SAMPLE_PASSPHRASE: &str = "sample notes repo passphrase";
const INITIALIZE_PASSPHRASE: &str = "native read-back passphrase";
const FAKE_ACCESS_TOKEN: &str = "fake-access-token";
const EDITED_TEXT: &str = "Zażółć gęślą jaźń\n\nSecond line: naïve café ✓ 日本語\n\n- list item\n";
const SCENARIO_TIMEOUT: Duration = Duration::from_secs(90);
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const HOUSEKEEPING_TIMEOUT: Duration = Duration::from_secs(30);

fn run<F: Future>(future: F) -> F::Output {
    glib::MainContext::new()
        .block_on(glib::future_with_timeout(SCENARIO_TIMEOUT, future))
        .expect("the scenario completes in time")
}

fn output_directory() -> PathBuf {
    match std::env::var("COMMITNOTE_READBACK_DIR") {
        Ok(path) if !path.is_empty() => PathBuf::from(path),
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../out/read-back")),
    }
}

fn write_scenario(file_name: &str, scenario: &Value) {
    let directory = output_directory();
    std::fs::create_dir_all(&directory).expect("the output directory is created");
    let bytes = serde_json::to_vec(scenario).expect("the scenario encodes");
    std::fs::write(directory.join(file_name), bytes).expect("the scenario is written");
}

fn access_token() -> Secret {
    Secret::new(FAKE_ACCESS_TOKEN.to_owned())
}

fn scenario(name: &str, passphrase: &str, exported: &str, expect: Value) -> Value {
    json!({
        "name": name,
        "passphrase": passphrase,
        "exported": exported,
        "expect": expect,
    })
}

fn paths(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

async fn inspect(runtime: &CoreRuntime, repo: &str) -> LoginInspectRepositoryResult {
    let listing = runtime
        .request::<LoginListRepositories>(LoginListRepositoriesParams {
            forge: ForgeKind::Github,
            access_token: access_token(),
        })
        .await
        .expect("login.listRepositories");
    let suffix = format!("/{repo}");
    let repository = listing
        .repositories
        .iter()
        .find(|repository| repository.url.to_lowercase().ends_with(&suffix))
        .expect("the repository is listed");
    runtime
        .request::<LoginInspectRepository>(LoginInspectRepositoryParams {
            forge: ForgeKind::Github,
            access_token: access_token(),
            repository_url: repository.url.clone(),
        })
        .await
        .expect("login.inspectRepository")
}

async fn poll<T, F>(what: &str, timeout: Duration, mut attempt: impl FnMut() -> F) -> T
where
    F: Future<Output = Option<T>>,
{
    let attempts = timeout.as_millis() / POLL_INTERVAL.as_millis();
    for _ in 0..=attempts {
        if let Some(found) = attempt().await {
            return found;
        }
        glib::timeout_future(POLL_INTERVAL).await;
    }
    panic!("timed out waiting for {what}");
}

async fn wait_for_tree(runtime: &CoreRuntime) -> Vec<TreeNode> {
    poll("the tree to load", Duration::from_secs(30), || async {
        runtime
            .request::<TreeGet>(TreeGetParams {})
            .await
            .expect("tree.get")
            .tree
    })
    .await
}

async fn log_in(runtime: &CoreRuntime, repo: &str, passphrase: &str) -> Vec<TreeNode> {
    log_in_after(runtime, repo, passphrase, || async {}).await
}

async fn log_in_after<F: Future<Output = ()>>(
    runtime: &CoreRuntime,
    repo: &str,
    passphrase: &str,
    before_unlock: impl FnOnce() -> F,
) -> Vec<TreeNode> {
    let inspection = inspect(runtime, repo).await;
    assert!(
        matches!(inspection, LoginInspectRepositoryResult::NotesRepo { .. }),
        "the repository was not inspected as a notes repo"
    );
    before_unlock().await;
    runtime
        .request::<LoginUnlock>(LoginUnlockParams {
            passphrase: Secret::new(passphrase.to_owned()),
        })
        .await
        .expect("login.unlock");
    wait_for_tree(runtime).await
}

fn note_paths(tree: &[TreeNode]) -> Vec<Vec<String>> {
    let mut found = Vec::new();
    for node in tree {
        match node {
            TreeNode::Note { path, .. } => found.push(path.clone()),
            TreeNode::Folder { children, .. } => found.extend(note_paths(children)),
        }
    }
    found
}

async fn open_note_loaded(runtime: &CoreRuntime, path: &[String]) -> String {
    poll("a note to load", Duration::from_secs(30), || async {
        let opened = runtime
            .request::<NoteOpen>(NoteOpenParams {
                path: Some(path.to_vec()),
            })
            .await
            .expect("note.open")
            .note;
        match opened {
            Some(OpenNote::Loading { .. }) => None,
            Some(OpenNote::Loaded { content, .. }) => Some(content),
            _ => panic!("a note did not load"),
        }
    })
    .await
}

async fn export_repo(runtime: &CoreRuntime, repo: &str) -> String {
    runtime
        .request::<FakeExportRepo>(FakeExportRepoParams {
            repo_key: repo.to_owned(),
        })
        .await
        .expect("fake.exportRepo")
        .exported
}

fn exported_main(exported: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(exported).expect("the export is JSON");
    parsed["main"].as_str().map(str::to_owned)
}

async fn command(runtime: &CoreRuntime, name: &str, params: Value) -> Value {
    runtime
        .send(name, params)
        .await
        .unwrap_or_else(|error| panic!("{name} failed: {error:?}"))
}

async fn flush_saved(runtime: &CoreRuntime) {
    let flushed = command(runtime, "sync.flush", json!({})).await;
    assert_eq!(flushed["result"], json!({"kind": "saved"}));
}

async fn edit_note(runtime: &CoreRuntime, path: &[String], text: &str) {
    command(runtime, "note.edit", json!({"path": path, "text": text})).await;
}

async fn structure(runtime: &CoreRuntime, name: &str, params: Value) -> Vec<String> {
    let result = command(runtime, name, params).await;
    let outcome = &result["outcome"];
    assert_eq!(outcome["kind"], "ok", "{name} did not succeed");
    serde_json::from_value(outcome["path"].clone()).expect("the outcome carries a path")
}

async fn trash(runtime: &CoreRuntime, path: &[&str]) -> String {
    let result = command(
        runtime,
        "node.trash",
        json!({"path": path, "shareCount": 0}),
    )
    .await;
    let outcome = &result["outcome"];
    assert_eq!(outcome["kind"], "trashed", "node.trash did not trash");
    outcome["entryId"]
        .as_str()
        .expect("the outcome carries an entry id")
        .to_owned()
}

fn created_path(result: &Value) -> Vec<String> {
    let outcome = &result["outcome"];
    assert_eq!(outcome["kind"], "created", "the draft was not created");
    serde_json::from_value(outcome["path"].clone()).expect("the outcome carries a path")
}

#[test]
fn initialized_repo_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        let inspection = inspect(&runtime, "sample/empty").await;
        assert!(
            matches!(
                inspection,
                LoginInspectRepositoryResult::Uninitialized { .. }
            ),
            "sample/empty was not inspected as uninitialized"
        );
        runtime
            .request::<LoginInitialize>(LoginInitializeParams {
                passphrase: Secret::new(INITIALIZE_PASSPHRASE.to_owned()),
            })
            .await
            .expect("login.initialize");
        wait_for_tree(&runtime).await;

        let exported = export_repo(&runtime, "sample/empty").await;
        write_scenario(
            "initialize.json",
            &scenario(
                "linux initialize",
                INITIALIZE_PASSPHRASE,
                &exported,
                json!({"initialized": true, "notes": [], "deviceName": DEVICE_MODEL}),
            ),
        );
    });
}

#[test]
fn saved_note_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        let tree = log_in(&runtime, "sample/notes", SAMPLE_PASSPHRASE).await;
        let path = note_paths(&tree).into_iter().next().expect("a note exists");
        open_note_loaded(&runtime, &path).await;

        runtime
            .request::<FakeSaveNote>(FakeSaveNoteParams {
                path: path.clone(),
                text: EDITED_TEXT.to_owned(),
            })
            .await
            .expect("fake.saveNote");

        let exported = export_repo(&runtime, "sample/notes").await;
        write_scenario(
            "save.json",
            &scenario(
                "linux save",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({
                    "initialized": false,
                    "notes": [{"path": path, "text": EDITED_TEXT}],
                    "deviceName": DEVICE_MODEL,
                }),
            ),
        );
    });
}

#[test]
fn housekeeping_commit_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        let mut fixture_main = None;
        log_in_after(&runtime, "sample/trash", SAMPLE_PASSPHRASE, || async {
            fixture_main = exported_main(&export_repo(&runtime, "sample/trash").await);
        })
        .await;
        let baseline = fixture_main.expect("the fixture has a main branch");

        let exported = poll(
            "the automatic trash purge commit",
            HOUSEKEEPING_TIMEOUT,
            || async {
                let exported = export_repo(&runtime, "sample/trash").await;
                (exported_main(&exported).as_ref() != Some(&baseline)).then_some(exported)
            },
        )
        .await;

        write_scenario(
            "housekeeping.json",
            &scenario(
                "linux housekeeping",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({"initialized": false, "notes": [], "deviceName": DEVICE_MODEL}),
            ),
        );
    });
}

#[test]
fn edited_note_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        log_in(&runtime, "sample/notes", SAMPLE_PASSPHRASE).await;
        let welcome = paths(&["Welcome"]);
        open_note_loaded(&runtime, &welcome).await;

        edit_note(&runtime, &welcome, EDITED_TEXT).await;
        flush_saved(&runtime).await;

        let exported = export_repo(&runtime, "sample/notes").await;
        write_scenario(
            "edit.json",
            &scenario(
                "linux edit",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({
                    "initialized": false,
                    "notes": [{"path": welcome, "text": EDITED_TEXT}],
                    "deviceName": DEVICE_MODEL,
                }),
            ),
        );
    });
}

#[test]
fn created_notes_and_folder_read_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        log_in(&runtime, "sample/notes", SAMPLE_PASSPHRASE).await;
        let first_text = "First thought: żółć 🙂\n";
        let plan_text = "Plan for Q3 – naïve café\n";

        command(&runtime, "draft.start", json!({"parent": []})).await;
        let first = command(
            &runtime,
            "draft.content",
            json!({"name": "", "content": first_text}),
        )
        .await;
        let first_path = created_path(&first);

        let folder = command(
            &runtime,
            "folder.create",
            json!({"parent": [], "name": "Quarterly"}),
        )
        .await;
        assert_eq!(
            folder["outcome"],
            json!({"kind": "created", "path": ["Quarterly"]})
        );

        command(&runtime, "draft.start", json!({"parent": ["Quarterly"]})).await;
        let named = command(&runtime, "draft.commitName", json!({"name": "Plan"})).await;
        let plan_path = created_path(&named);
        assert_eq!(plan_path, paths(&["Quarterly", "Plan"]));
        edit_note(&runtime, &plan_path, plan_text).await;
        flush_saved(&runtime).await;

        let exported = export_repo(&runtime, "sample/notes").await;
        write_scenario(
            "create.json",
            &scenario(
                "linux create",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({
                    "initialized": false,
                    "notes": [
                        {"path": first_path, "text": first_text},
                        {"path": plan_path, "text": plan_text},
                    ],
                    "folders": [["Quarterly"]],
                    "deviceName": DEVICE_MODEL,
                }),
            ),
        );
    });
}

#[test]
fn resolved_conflict_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        log_in(&runtime, "sample/notes", SAMPLE_PASSPHRASE).await;
        let welcome = paths(&["Welcome"]);
        let original = open_note_loaded(&runtime, &welcome).await;
        let rest: Vec<&str> = original.split('\n').skip(1).collect();
        let with_title = |title: &str| {
            std::iter::once(title)
                .chain(rest.iter().copied())
                .collect::<Vec<_>>()
                .join("\n")
        };
        let remote_text = with_title("# Remote title");
        let local_text = with_title("# Local title");

        runtime
            .request::<FakeRemoteEdit>(FakeRemoteEditParams {
                repo: "sample/notes".to_owned(),
                path: welcome.clone(),
                text: remote_text,
                device: "Other iPhone".to_owned(),
            })
            .await
            .expect("fake.remoteEdit");
        let events = runtime.subscribe();
        edit_note(&runtime, &welcome, &local_text).await;
        command(&runtime, "sync.flush", json!({})).await;

        let other_device = loop {
            let event = events.recv().await.expect("the runtime keeps running");
            let CoreEvent::NoteChanged(changed) = event else {
                continue;
            };
            let Some(OpenNote::Loaded {
                conflict: Some(conflict),
                ..
            }) = changed.note
            else {
                continue;
            };
            if let Some(device) = conflict["otherDevice"].as_str() {
                break device.to_owned();
            }
        };
        assert_eq!(other_device, "Other iPhone");

        command(
            &runtime,
            "conflict.resolve",
            json!({"path": welcome, "resolution": "keepMine"}),
        )
        .await;
        flush_saved(&runtime).await;

        let exported = export_repo(&runtime, "sample/notes").await;
        write_scenario(
            "conflict.json",
            &scenario(
                "linux conflict",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({
                    "initialized": false,
                    "notes": [{"path": welcome, "text": local_text}],
                    "deviceName": DEVICE_MODEL,
                }),
            ),
        );
    });
}

#[test]
fn organised_repo_reads_back() {
    run(async {
        let runtime = start_fake(HostServices::default());
        log_in(&runtime, "sample/notes", SAMPLE_PASSPHRASE).await;
        let sample_notes = runtime
            .request::<FakeExpectedSampleNotes>(FakeExpectedSampleNotesParams {})
            .await
            .expect("fake.expectedSampleNotes")
            .notes;
        let text_of = |path: &[&str]| {
            let wanted = paths(path);
            sample_notes
                .iter()
                .find(|note| note.path == wanted)
                .expect("the sample note exists")
                .text
                .clone()
        };
        let welcome_text = text_of(&["Welcome"]);
        let polish_text = text_of(&["Zażółć gęślą jaźń"]);
        let roadmap_text = text_of(&["Projects", "commitnote", "Roadmap"]);

        let renamed = structure(
            &runtime,
            "node.rename",
            json!({"path": ["Welcome"], "name": "Hello"}),
        )
        .await;
        let moved = structure(
            &runtime,
            "node.move",
            json!({"path": ["Zażółć gęślą jaźń"], "parent": ["Projects"]}),
        )
        .await;
        structure(
            &runtime,
            "node.place",
            json!({"path": renamed, "parent": [], "before": "Empty folder"}),
        )
        .await;
        structure(
            &runtime,
            "node.setColorTag",
            json!({"path": renamed, "tag": "yellow"}),
        )
        .await;
        trash(&runtime, &["Journal", "2026", "Whiteboard"]).await;
        let folder_entry = trash(&runtime, &["Projects", "commitnote"]).await;
        let restored = structure(
            &runtime,
            "trash.restore",
            json!({"entryId": folder_entry, "subPath": ["Roadmap"], "parent": []}),
        )
        .await;
        flush_saved(&runtime).await;

        let exported = export_repo(&runtime, "sample/notes").await;
        write_scenario(
            "organise.json",
            &scenario(
                "linux organise",
                SAMPLE_PASSPHRASE,
                &exported,
                json!({
                    "initialized": false,
                    "notes": [
                        {"path": renamed, "text": welcome_text},
                        {"path": moved, "text": polish_text},
                        {"path": restored, "text": roadmap_text},
                    ],
                    "folders": [["Projects"], ["Journal", "2026"]],
                    "order": [{
                        "parent": [],
                        "names": ["Hello", "Empty folder", "Journal", "Projects", "Roadmap"],
                    }],
                    "tags": [
                        {"path": renamed, "tag": "yellow"},
                        {"path": moved, "tag": "purple"},
                        {"path": restored, "tag": "blue"},
                        {"path": ["Journal", "2026", "January"], "tag": "orange"},
                    ],
                    "trash": {"count": 2, "names": ["Whiteboard", "commitnote"]},
                    "deviceName": DEVICE_MODEL,
                }),
            ),
        );
    });
}
