use std::fmt;

use serde::{Deserialize, Serialize};

empty_shape!(
    ImportCancelParams,
    ImportCancelResult,
    ImportEnableAtomicParams,
    ImportSaveWithoutAtomicParams,
    ImportSaveWithoutAtomicResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportNotesParams {
    pub include_images: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArchiveMimeType {
    #[serde(rename = "application/zip")]
    Zip,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedArchive {
    pub file_name: String,
    pub mime_type: ArchiveMimeType,
    pub base64: String,
}

impl fmt::Debug for ExportedArchive {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ExportedArchive")
            .field("mime_type", &self.mime_type)
            .field("base64_len", &self.base64.len())
            .finish_non_exhaustive()
    }
}

pub type ExportNotesResult = ExportedArchive;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReadArchiveParams {
    pub input: String,
    pub file_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTargetView {
    pub path: Vec<String>,
    pub label: String,
    pub depth: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFormCopy {
    pub title: String,
    pub conflicts_title: String,
    pub setup_title: String,
    pub into_label: String,
    pub new_folder_label: String,
    pub folder_name_label: String,
    pub existing_folder_label: String,
    pub root_label: String,
    pub empty_text: String,
    pub import_label: String,
    pub importing_label: String,
    pub rename_label: String,
    pub enable_atomic_label: String,
    pub cancel_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportForm {
    pub file_name: String,
    pub default_folder_name: String,
    pub skipped: Option<String>,
    pub empty: bool,
    pub targets: Vec<ImportTargetView>,
    pub copy: ImportFormCopy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportArchiveOutcome {
    Ready { form: Box<ImportForm> },
    Error { message: String },
}

pub type ImportReadArchiveResult = ImportArchiveOutcome;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportDestinationView {
    Root,
    Folder { path: Vec<String> },
    NewFolder { parent: Vec<String>, name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewParams {
    pub destination: ImportDestinationView,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewResult {
    pub text: Option<String>,
}

impl fmt::Debug for ImportPreviewResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ImportPreviewResult")
            .field("has_text", &self.text.is_some())
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportPolicy {
    Stop,
    Rename,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitParams {
    pub destination: ImportDestinationView,
    pub policy: ImportPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportOutcomeView {
    Queued {
        expand: Option<Vec<String>>,
    },
    Conflicts {
        count: u32,
        message: String,
    },
    NeedsSetup {
        can_configure: bool,
        message: String,
        action_label: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcomeResult {
    pub outcome: ImportOutcomeView,
}

pub type ImportCommitResult = ImportOutcomeResult;
pub type ImportDropFilesResult = ImportOutcomeResult;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDroppedFile {
    pub input: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportDropSource {
    Picker,
    Tree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDropFilesParams {
    pub files: Vec<ImportDroppedFile>,
    pub parent: Option<Vec<String>>,
    pub source: ImportDropSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEnableAtomicResult {
    pub error: Option<String>,
    pub outcome: Option<ImportOutcomeView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicBlockedView {
    pub title: String,
    pub message: String,
    pub enable_label: String,
    pub save_without_label: String,
    pub can_configure: bool,
}

command!(
    ExportNotes,
    "export.notes",
    ExportNotesParams,
    ExportNotesResult
);
command!(
    ImportReadArchive,
    "import.readArchive",
    ImportReadArchiveParams,
    ImportReadArchiveResult
);
command!(
    ImportPreview,
    "import.preview",
    ImportPreviewParams,
    ImportPreviewResult
);
command!(
    ImportCommit,
    "import.commit",
    ImportCommitParams,
    ImportCommitResult
);
command!(
    ImportCancel,
    "import.cancel",
    ImportCancelParams,
    ImportCancelResult
);
command!(
    ImportDropFiles,
    "import.dropFiles",
    ImportDropFilesParams,
    ImportDropFilesResult
);
command!(
    ImportEnableAtomic,
    "import.enableAtomic",
    ImportEnableAtomicParams,
    ImportEnableAtomicResult
);
command!(
    ImportSaveWithoutAtomic,
    "import.saveWithoutAtomic",
    ImportSaveWithoutAtomicParams,
    ImportSaveWithoutAtomicResult
);

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};

    use super::*;

    fn round_trip<T: Serialize + DeserializeOwned + PartialEq + fmt::Debug>(value: &T) -> Value {
        let json = serde_json::to_value(value).unwrap();
        assert_eq!(&serde_json::from_value::<T>(json.clone()).unwrap(), value);
        json
    }

    const READY: &str = r#"{"form":{"copy":{"cancelLabel":"Cancel","conflictsTitle":"Name conflicts","emptyText":"The archive has no notes to import.","enableAtomicLabel":"Use fast-forward merges","existingFolderLabel":"An existing folder","folderNameLabel":"Folder name","importLabel":"Import","importingLabel":"Importing…","intoLabel":"Import into","newFolderLabel":"A new folder","renameLabel":"Rename imported items","rootLabel":"Notes (top level)","setupTitle":"Project setting needed","title":"Import notes"},"defaultFolderName":"sample-import","empty":false,"fileName":"sample-import.zip","skipped":null,"targets":[{"depth":0,"label":"Notes (top level)","path":[]},{"depth":2,"label":"commitnote","path":["Projects","commitnote"]}]},"kind":"ready"}"#;

    #[test]
    fn a_ready_archive_decodes_with_its_form() {
        let outcome: ImportArchiveOutcome = serde_json::from_str(READY).unwrap();
        let ImportArchiveOutcome::Ready { form } = &outcome else {
            panic!("expected a ready outcome");
        };
        assert_eq!(form.file_name, "sample-import.zip");
        assert_eq!(form.default_folder_name, "sample-import");
        assert_eq!(form.skipped, None);
        assert!(!form.empty);
        assert_eq!(form.targets.len(), 2);
        assert_eq!(form.targets[1].path, ["Projects", "commitnote"]);
        assert_eq!(form.targets[1].depth, 2);
        assert_eq!(form.copy.import_label, "Import");
        assert_eq!(form.copy.importing_label, "Importing…");
        assert_eq!(
            serde_json::to_value(&outcome).unwrap(),
            serde_json::from_str::<Value>(READY).unwrap()
        );
    }

    #[test]
    fn an_unreadable_archive_carries_a_message() {
        let outcome: ImportArchiveOutcome =
            serde_json::from_value(json!({"kind":"error","message":"Not a zip"})).unwrap();
        assert_eq!(
            outcome,
            ImportArchiveOutcome::Error {
                message: "Not a zip".into()
            }
        );
    }

    #[test]
    fn destinations_use_kind_tags_and_camel_case_fields() {
        assert_eq!(
            round_trip(&ImportDestinationView::Root),
            json!({"kind":"root"})
        );
        assert_eq!(
            round_trip(&ImportDestinationView::Folder {
                path: vec!["A".into()]
            }),
            json!({"kind":"folder","path":["A"]})
        );
        assert_eq!(
            round_trip(&ImportCommitParams {
                destination: ImportDestinationView::NewFolder {
                    parent: Vec::new(),
                    name: "Imported".into(),
                },
                policy: ImportPolicy::Rename,
            }),
            json!({"destination":{"kind":"newFolder","parent":[],"name":"Imported"},"policy":"rename"})
        );
        assert_eq!(round_trip(&ImportPolicy::Stop), json!("stop"));
    }

    #[test]
    fn import_outcomes_round_trip() {
        assert_eq!(
            round_trip(&ImportOutcomeView::Queued { expand: None }),
            json!({"kind":"queued","expand":null})
        );
        assert_eq!(
            round_trip(&ImportOutcomeView::Queued {
                expand: Some(vec!["Imported".into()])
            }),
            json!({"kind":"queued","expand":["Imported"]})
        );
        assert_eq!(
            round_trip(&ImportOutcomeView::Conflicts {
                count: 2,
                message: "Two names clash".into()
            }),
            json!({"kind":"conflicts","count":2,"message":"Two names clash"})
        );
        assert_eq!(
            round_trip(&ImportOutcomeView::NeedsSetup {
                can_configure: true,
                message: "Enable it".into(),
                action_label: "Enable".into(),
            }),
            json!({"kind":"needsSetup","canConfigure":true,"message":"Enable it","actionLabel":"Enable"})
        );
        assert_eq!(
            round_trip(&ImportOutcomeView::Error {
                message: "Failed".into()
            }),
            json!({"kind":"error","message":"Failed"})
        );
    }

    #[test]
    fn dropped_files_encode_their_source_and_parent() {
        assert_eq!(
            round_trip(&ImportDropFilesParams {
                files: vec![ImportDroppedFile {
                    input: "input-1".into(),
                    name: "notes.md".into(),
                }],
                parent: None,
                source: ImportDropSource::Tree,
            }),
            json!({"files":[{"input":"input-1","name":"notes.md"}],"parent":null,"source":"tree"})
        );
        assert_eq!(round_trip(&ImportDropSource::Picker), json!("picker"));
    }

    #[test]
    fn atomic_merge_results_decode() {
        let result: ImportEnableAtomicResult =
            serde_json::from_value(json!({"error":null,"outcome":{"kind":"queued","expand":null}}))
                .unwrap();
        assert_eq!(
            result.outcome,
            Some(ImportOutcomeView::Queued { expand: None })
        );
        assert_eq!(
            round_trip(&AtomicBlockedView {
                title: "Setting needed".into(),
                message: "Enable it".into(),
                enable_label: "Enable".into(),
                save_without_label: "Save without".into(),
                can_configure: false,
            }),
            json!({"title":"Setting needed","message":"Enable it","enableLabel":"Enable","saveWithoutLabel":"Save without","canConfigure":false})
        );
    }

    #[test]
    fn archive_debug_output_leaves_out_the_bytes() {
        let archive = ExportedArchive {
            file_name: "notes.zip".into(),
            mime_type: ArchiveMimeType::Zip,
            base64: "UEsDBHNlY3JldC1ub3RlLXRleHQ=".into(),
        };
        let debug = format!("{archive:?}");
        assert!(!debug.contains("UEsDB"), "{debug}");
        assert!(!debug.contains("notes.zip"), "{debug}");
        assert_eq!(
            round_trip(&archive),
            json!({"fileName":"notes.zip","mimeType":"application/zip","base64":"UEsDBHNlY3JldC1ub3RlLXRleHQ="})
        );
    }

    #[test]
    fn preview_debug_output_leaves_out_the_note_text() {
        let preview = ImportPreviewResult {
            text: Some("secret note text".into()),
        };
        assert!(!format!("{preview:?}").contains("secret"));
    }
}
