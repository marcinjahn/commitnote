use serde::{Deserialize, Serialize};

use crate::secret::Secret;

empty_shape!(
    PassphraseChangeFormParams,
    PassphraseCommitChangeParams,
    PassphraseSettleParams,
    PassphraseCancelChangeParams,
    PassphraseCancelChangeResult,
    PassphraseEnableAtomicParams,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseChangeCopy {
    pub title: String,
    pub intro: String,
    pub current_label: String,
    pub new_label: String,
    pub repeat_label: String,
    pub new_hint: String,
    pub remove_history_label: String,
    pub remove_history_description: String,
    pub history_warning: String,
    pub other_devices_warning: String,
    pub version_history_notice: String,
    pub continue_label: String,
    pub confirm_label: String,
    pub cancel_label: String,
    pub check_again_label: String,
    pub checking_label: String,
    pub log_out_label: String,
    pub starting_label: String,
    pub enable_atomic_label: String,
    pub passphrases_differ: String,
    pub enter_current_passphrase: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseChangeFormResult {
    pub copy: PassphraseChangeCopy,
    pub can_remove_history: bool,
    pub repository_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphrasePrepareChangeParams {
    pub current: Secret,
    pub next: Secret,
    pub remove_history: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PassphraseChangeOutcome {
    Review {
        summary: String,
        carried_over: Vec<String>,
        history_warning: Option<String>,
    },
    Changed,
    Failed {
        message: String,
        clear_current: bool,
    },
    NeedsSetup {
        can_configure: bool,
        message: String,
        action_label: String,
    },
    Unsettled {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseChangeOutcomeResult {
    pub outcome: PassphraseChangeOutcome,
}

pub type PassphrasePrepareChangeResult = PassphraseChangeOutcomeResult;
pub type PassphraseCommitChangeResult = PassphraseChangeOutcomeResult;
pub type PassphraseSettleResult = PassphraseChangeOutcomeResult;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseEnableAtomicResult {
    pub error: Option<String>,
}

command!(
    PassphraseChangeForm,
    "passphrase.changeForm",
    PassphraseChangeFormParams,
    PassphraseChangeFormResult
);
command!(
    PassphrasePrepareChange,
    "passphrase.prepareChange",
    PassphrasePrepareChangeParams,
    PassphrasePrepareChangeResult
);
command!(
    PassphraseCommitChange,
    "passphrase.commitChange",
    PassphraseCommitChangeParams,
    PassphraseCommitChangeResult
);
command!(
    PassphraseSettle,
    "passphrase.settle",
    PassphraseSettleParams,
    PassphraseSettleResult
);
command!(
    PassphraseCancelChange,
    "passphrase.cancelChange",
    PassphraseCancelChangeParams,
    PassphraseCancelChangeResult
);
command!(
    PassphraseEnableAtomic,
    "passphrase.enableAtomic",
    PassphraseEnableAtomicParams,
    PassphraseEnableAtomicResult
);

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};

    use super::*;

    fn round_trip<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(
        value: &T,
    ) -> Value {
        let json = serde_json::to_value(value).unwrap();
        assert_eq!(&serde_json::from_value::<T>(json.clone()).unwrap(), value);
        json
    }

    const FORM: &str = r#"{"canRemoveHistory":true,"copy":{"cancelLabel":"Back","checkAgainLabel":"Check again","checkingLabel":"Checking…","confirmLabel":"Change passphrase","continueLabel":"Continue","currentLabel":"Current passphrase","enableAtomicLabel":"Use fast-forward merges","enterCurrentPassphrase":"Enter the current passphrase.","historyWarning":"Earlier versions stay.","intro":"Change your passphrase.","logOutLabel":"Log out","newHint":"Use a long passphrase.","newLabel":"New passphrase","otherDevicesWarning":"Other devices are signed out.","passphrasesDiffer":"The new passphrases do not match.","removeHistoryDescription":"Replaces the whole history.","removeHistoryLabel":"Also delete the old history","repeatLabel":"Repeat new passphrase","startingLabel":"Starting…","title":"Change passphrase","versionHistoryNotice":"Version history starts over."},"repositoryLabel":"sample/notes"}"#;

    #[test]
    fn the_change_form_decodes_every_label() {
        let form: PassphraseChangeFormResult = serde_json::from_str(FORM).unwrap();
        assert!(form.can_remove_history);
        assert_eq!(form.repository_label, "sample/notes");
        assert_eq!(form.copy.title, "Change passphrase");
        assert_eq!(
            form.copy.enter_current_passphrase,
            "Enter the current passphrase."
        );
        assert_eq!(form.copy.starting_label, "Starting…");
        assert_eq!(
            serde_json::to_value(&form).unwrap(),
            serde_json::from_str::<Value>(FORM).unwrap()
        );
    }

    #[test]
    fn change_outcomes_use_kind_tags() {
        assert_eq!(
            round_trip(&PassphraseChangeOutcome::Review {
                summary: "Ready".into(),
                carried_over: vec!["Settings".into()],
                history_warning: None,
            }),
            json!({"kind":"review","summary":"Ready","carriedOver":["Settings"],"historyWarning":null})
        );
        assert_eq!(
            round_trip(&PassphraseChangeOutcome::Changed),
            json!({"kind":"changed"})
        );
        assert_eq!(
            round_trip(&PassphraseChangeOutcome::Failed {
                message: "Wrong passphrase".into(),
                clear_current: true,
            }),
            json!({"kind":"failed","message":"Wrong passphrase","clearCurrent":true})
        );
        assert_eq!(
            round_trip(&PassphraseChangeOutcome::NeedsSetup {
                can_configure: false,
                message: "Enable it".into(),
                action_label: "Enable".into(),
            }),
            json!({"kind":"needsSetup","canConfigure":false,"message":"Enable it","actionLabel":"Enable"})
        );
        assert_eq!(
            round_trip(&PassphraseChangeOutcome::Unsettled {
                message: "Check again".into()
            }),
            json!({"kind":"unsettled","message":"Check again"})
        );
    }

    #[test]
    fn prepare_params_encode_the_passphrases_and_hide_them_from_debug() {
        let params = PassphrasePrepareChangeParams {
            current: Secret::new("hunter2-current".to_owned()),
            next: Secret::new("hunter2-next".to_owned()),
            remove_history: true,
        };
        assert_eq!(
            serde_json::to_value(&params).unwrap(),
            json!({"current":"hunter2-current","next":"hunter2-next","removeHistory":true})
        );
        let debug = format!("{params:?}");
        assert!(!debug.contains("hunter2"), "{debug}");
    }

    #[test]
    fn enabling_atomic_merges_reports_an_optional_error() {
        assert_eq!(
            round_trip(&PassphraseEnableAtomicResult { error: None }),
            json!({"error":null})
        );
    }
}
