mod common;

use std::collections::BTreeMap;
use std::time::Duration;

use commitnote_core_api::Secret;
use commitnote_core_api::commands::{
    LoginInspectRepository, LoginInspectRepositoryParams, LoginInspectRepositoryResult,
    LoginListRepositories, LoginListRepositoriesParams, LoginUnlock, LoginUnlockParams, NoteOpen,
    NoteOpenParams, SessionLogout, SessionLogoutParams, TreeGet, TreeGetParams,
};
use commitnote_core_api::fake::{FakeExpectedSampleNotes, FakeExpectedSampleNotesParams};
use commitnote_core_api::shapes::{ForgeKind, OpenNote, TreeNode};
use commitnote_core_runtime::{CoreRuntime, HostServices, RuntimeConfig};
use serde_json::json;

use common::{block_on, fake_core_bundle, start_fake};

const SAMPLE_REPO: &str = "sample/notes";
const SAMPLE_PASSPHRASE: &str = "sample notes repo passphrase";
const FAKE_ACCESS_TOKEN: &str = "fake-access-token";
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const POLL_ATTEMPTS: u32 = 600;

fn access_token() -> Secret {
    Secret::new(FAKE_ACCESS_TOKEN.to_owned())
}

async fn poll<T, F>(what: &str, mut attempt: impl FnMut() -> F) -> T
where
    F: std::future::Future<Output = Option<T>>,
{
    for _ in 0..POLL_ATTEMPTS {
        if let Some(found) = attempt().await {
            return found;
        }
        glib::timeout_future(POLL_INTERVAL).await;
    }
    panic!("timed out waiting for {what}");
}

fn log_in(runtime: &CoreRuntime, repo: &str, passphrase: &str) -> Vec<TreeNode> {
    block_on(async {
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
        let inspection = runtime
            .request::<LoginInspectRepository>(LoginInspectRepositoryParams {
                forge: ForgeKind::Github,
                access_token: access_token(),
                repository_url: repository.url.clone(),
            })
            .await
            .expect("login.inspectRepository");
        assert!(
            matches!(inspection, LoginInspectRepositoryResult::NotesRepo { .. }),
            "the repository was not inspected as a notes repo"
        );
        runtime
            .request::<LoginUnlock>(LoginUnlockParams {
                passphrase: Secret::new(passphrase.to_owned()),
            })
            .await
            .expect("login.unlock");
        poll("the tree to load", || async {
            runtime
                .request::<TreeGet>(TreeGetParams {})
                .await
                .expect("tree.get")
                .tree
        })
        .await
    })
}

fn note_paths(tree: &[TreeNode]) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for node in tree {
        match node {
            TreeNode::Note { path, .. } => paths.push(path.clone()),
            TreeNode::Folder { children, .. } => paths.extend(note_paths(children)),
        }
    }
    paths
}

fn open_note_loaded(runtime: &CoreRuntime, path: &[String]) -> String {
    block_on(poll("a note to load", || async {
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
    }))
}

#[test]
fn whole_sample_notes_repo_decrypts() {
    let runtime = start_fake(HostServices::default());
    let tree = log_in(&runtime, SAMPLE_REPO, SAMPLE_PASSPHRASE);

    let expected =
        block_on(runtime.request::<FakeExpectedSampleNotes>(FakeExpectedSampleNotesParams {}))
            .expect("fake.expectedSampleNotes")
            .notes;
    let paths = note_paths(&tree);

    let expected_by_path: BTreeMap<&Vec<String>, &String> = expected
        .iter()
        .map(|note| (&note.path, &note.text))
        .collect();
    assert_eq!(expected_by_path.len(), expected.len());
    assert_eq!(paths.len(), expected.len());
    for path in &paths {
        let text = open_note_loaded(&runtime, path);
        let matches = expected_by_path
            .get(path)
            .is_some_and(|wanted| **wanted == text);
        assert!(matches, "a note differs from the expected sample text");
    }
}

const ISSUED_KEYS_PROBE: &str = r#"
;(() => {
  const core = globalThis.CommitnoteNativeCore;
  const start = core.start;
  core.start = (host, options) => {
    const issued = [];
    const importKey = host.crypto.importKey;
    host.crypto.importKey = (raw, algorithm) => {
      const handle = importKey(raw, algorithm);
      issued.push({ handle, algorithm });
      return handle;
    };
    const attempt = ({ handle, algorithm }) => {
      try {
        if (algorithm === "AES-GCM") {
          host.crypto.aesGcmEncrypt(handle, new Uint8Array(12), new Uint8Array(0), new Uint8Array(1));
        } else if (algorithm === "HMAC-SHA-256") {
          host.crypto.hmacSha256(handle, new Uint8Array(1));
        } else {
          host.crypto.hkdfSha256(handle, new Uint8Array(0), new Uint8Array(0), 1);
        }
        return "ok";
      } catch (error) {
        return error.message;
      }
    };
    const core = start(host, options);
    const send = core.send;
    core.send = (text) => {
      const request = JSON.parse(text);
      if (request.command !== "probe.issuedKeys") {
        return send(text);
      }
      host.post(JSON.stringify({
        kind: "response",
        id: request.id,
        ok: true,
        result: { outcomes: issued.map(attempt) },
      }));
    };
    return core;
  };
})();
"#;

fn issued_key_outcomes(runtime: &CoreRuntime) -> Vec<String> {
    let result = block_on(runtime.send("probe.issuedKeys", json!({}))).expect("probe.issuedKeys");
    result["outcomes"]
        .as_array()
        .expect("outcomes")
        .iter()
        .map(|outcome| outcome.as_str().expect("an outcome message").to_owned())
        .collect()
}

#[test]
fn logout_invalidates_every_issued_key_handle() {
    let runtime = CoreRuntime::start(RuntimeConfig::new(
        format!("{}{ISSUED_KEYS_PROBE}", fake_core_bundle()),
        "Linux",
    ))
    .expect("the probed core starts");
    log_in(&runtime, SAMPLE_REPO, SAMPLE_PASSPHRASE);

    let before = issued_key_outcomes(&runtime);
    assert!(!before.is_empty(), "logging in issued no key handles");
    assert!(before.iter().all(|outcome| outcome == "ok"));

    block_on(runtime.request::<SessionLogout>(SessionLogoutParams { anyway: false }))
        .expect("session.logout");

    let after = issued_key_outcomes(&runtime);
    assert_eq!(after.len(), before.len());
    assert!(after.iter().all(|outcome| outcome == "Unknown key handle"));
}
