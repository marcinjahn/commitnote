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

#[cfg(test)]
mod tests {
    use super::*;

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
}
