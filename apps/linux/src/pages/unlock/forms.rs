use std::cell::Cell;
use std::time::Duration;

use commitnote_core_api::shapes::PassphraseStrength;

pub const STRENGTH_DEBOUNCE: Duration = Duration::from_millis(150);

const ENTER_PASSPHRASE: &str = "Enter the passphrase.";
const CREATE_PASSPHRASE: &str = "Create a passphrase.";
const PASSPHRASES_DIFFER: &str = "Passphrases do not match.";

pub fn validate_unlock(passphrase: &str) -> Result<(), &'static str> {
    if passphrase.trim().is_empty() {
        return Err(ENTER_PASSPHRASE);
    }
    Ok(())
}

pub fn validate_initialize(passphrase: &str, repeated: &str) -> Result<(), &'static str> {
    if passphrase.trim().is_empty() {
        return Err(CREATE_PASSPHRASE);
    }
    if passphrase != repeated {
        return Err(PASSPHRASES_DIFFER);
    }
    Ok(())
}

pub fn strength_text(strength: &PassphraseStrength) -> String {
    let mut text = format!("Passphrase strength: {}.", strength.label);
    if strength.score <= 2 && !strength.warning.is_empty() {
        text.push(' ');
        text.push_str(&strength.warning);
    }
    text
}

#[derive(Debug, Default)]
pub struct LatestRequest {
    generation: Cell<u64>,
}

impl LatestRequest {
    pub fn begin(&self) -> u64 {
        let generation = self.generation.get().wrapping_add(1);
        self.generation.set(generation);
        generation
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.generation.get() == generation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strength(score: u8, warning: &str) -> PassphraseStrength {
        PassphraseStrength {
            score,
            label: "Fair".to_owned(),
            filled_segments: score,
            weak: score <= 1,
            warning: warning.to_owned(),
        }
    }

    #[test]
    fn strength_text_appends_the_warning_for_weak_scores() {
        assert_eq!(
            strength_text(&strength(2, "This is a common phrase.")),
            "Passphrase strength: Fair. This is a common phrase."
        );
    }

    #[test]
    fn strength_text_without_a_warning_ends_after_the_label() {
        assert_eq!(
            strength_text(&strength(2, "")),
            "Passphrase strength: Fair."
        );
    }

    #[test]
    fn strength_text_omits_the_warning_from_score_three() {
        assert_eq!(
            strength_text(&strength(3, "Avoid repeats.")),
            "Passphrase strength: Fair."
        );
    }

    #[test]
    fn unlock_rejects_empty_and_whitespace_passphrases() {
        assert_eq!(validate_unlock(""), Err("Enter the passphrase."));
        assert_eq!(validate_unlock(" \t\n"), Err("Enter the passphrase."));
        assert_eq!(validate_unlock(" a "), Ok(()));
    }

    #[test]
    fn initialize_requires_a_passphrase_before_comparing() {
        assert_eq!(validate_initialize("  ", "  "), Err("Create a passphrase."));
        assert_eq!(validate_initialize("", "x"), Err("Create a passphrase."));
    }

    #[test]
    fn initialize_requires_matching_passphrases() {
        assert_eq!(
            validate_initialize("one two", "one  two"),
            Err("Passphrases do not match.")
        );
        assert_eq!(
            validate_initialize("one two", ""),
            Err("Passphrases do not match.")
        );
        assert_eq!(validate_initialize("one two", "one two"), Ok(()));
    }

    #[test]
    fn only_the_latest_request_is_current() {
        let requests = LatestRequest::default();
        let first = requests.begin();
        assert!(requests.is_current(first));
        let second = requests.begin();
        assert!(!requests.is_current(first));
        assert!(requests.is_current(second));
    }
}
