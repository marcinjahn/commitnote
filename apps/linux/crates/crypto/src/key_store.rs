use std::collections::HashMap;
use std::str::FromStr;

use zeroize::Zeroizing;

use crate::error::CryptoError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAlgorithm {
    AesGcm,
    HmacSha256,
    Hkdf,
}

impl FromStr for KeyAlgorithm {
    type Err = CryptoError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "AES-GCM" => Ok(Self::AesGcm),
            "HMAC-SHA-256" => Ok(Self::HmacSha256),
            "HKDF" => Ok(Self::Hkdf),
            _ => Err(CryptoError::UnsupportedKeyAlgorithm),
        }
    }
}

struct StoredKey {
    raw: Zeroizing<Vec<u8>>,
    algorithm: KeyAlgorithm,
}

pub struct KeyStore {
    keys: HashMap<String, StoredKey>,
    next_id: u64,
}

impl KeyStore {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn import(&mut self, raw: &[u8], algorithm: KeyAlgorithm) -> Result<String, CryptoError> {
        if algorithm == KeyAlgorithm::AesGcm && !matches!(raw.len(), 16 | 32) {
            return Err(CryptoError::InvalidKeyLength);
        }
        let handle = format!("k{}", self.next_id);
        self.next_id += 1;
        self.keys.insert(
            handle.clone(),
            StoredKey {
                raw: Zeroizing::new(raw.to_vec()),
                algorithm,
            },
        );
        Ok(handle)
    }

    pub fn release(&mut self, handle: &str) {
        self.keys.remove(handle);
    }

    pub fn clear(&mut self) {
        self.keys.clear();
    }

    pub fn export_raw(&self, handle: &str) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        let key = self.keys.get(handle).ok_or(CryptoError::UnknownKeyHandle)?;
        Ok(Zeroizing::new(key.raw.to_vec()))
    }

    pub(crate) fn raw_for(
        &self,
        handle: &str,
        algorithm: KeyAlgorithm,
    ) -> Result<&[u8], CryptoError> {
        match self.keys.get(handle) {
            Some(key) if key.algorithm == algorithm => Ok(&key.raw),
            _ => Err(CryptoError::UnknownKeyHandle),
        }
    }
}

impl Default for KeyStore {
    fn default() -> Self {
        Self::new()
    }
}
