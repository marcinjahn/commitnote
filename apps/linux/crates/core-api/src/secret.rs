use serde::{Deserialize, Serialize};
use std::fmt;

use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for Secret {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_zeroize_on_drop<T: ZeroizeOnDrop>() {}

    #[test]
    fn wipes_itself_on_drop() {
        assert_zeroize_on_drop::<Secret>();
    }

    #[test]
    fn zeroize_empties_the_value() {
        let mut secret = Secret::new("hunter2");
        secret.zeroize();
        assert_eq!(secret.expose(), "");
    }

    #[test]
    fn debug_hides_the_value() {
        let secret = Secret::new("hunter2");
        assert_eq!(format!("{secret:?}"), "Secret(<redacted>)");
        assert_eq!(secret.expose(), "hunter2");
    }

    #[test]
    fn serializes_as_a_plain_string() {
        let secret = Secret::new("hunter2");
        assert_eq!(serde_json::to_string(&secret).unwrap(), "\"hunter2\"");
        let back: Secret = serde_json::from_str("\"hunter2\"").unwrap();
        assert_eq!(back, secret);
    }
}
