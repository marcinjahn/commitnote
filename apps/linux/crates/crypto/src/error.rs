use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    UnsupportedKeyAlgorithm,
    InvalidKeyLength,
    UnknownKeyHandle,
    InvalidIvLength,
    InvalidHkdfLength,
    UnsupportedDigestAlgorithm,
    InvalidArgon2Parameters,
    InvalidRandomLength,
    RandomUnavailable,
    OperationFailed,
}

impl CryptoError {
    pub fn message(self) -> &'static str {
        match self {
            Self::UnsupportedKeyAlgorithm => "Unsupported key algorithm",
            Self::InvalidKeyLength => "Invalid key length",
            Self::UnknownKeyHandle => "Unknown key handle",
            Self::InvalidIvLength => "AES-GCM IV must be 12 bytes",
            Self::InvalidHkdfLength => "Invalid HKDF length",
            Self::UnsupportedDigestAlgorithm => "Unsupported digest algorithm",
            Self::InvalidArgon2Parameters => "Invalid Argon2id parameters",
            Self::InvalidRandomLength => "Invalid random length",
            Self::RandomUnavailable => "Random bytes unavailable",
            Self::OperationFailed => "Crypto operation failed",
        }
    }
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for CryptoError {}
