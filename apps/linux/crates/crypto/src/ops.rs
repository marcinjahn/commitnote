use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes128Gcm, Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::key_store::{KeyAlgorithm, KeyStore};

const IV_LENGTH: usize = 12;
const MAX_HKDF_LENGTH: usize = 255 * 32;
const MAX_RANDOM_LENGTH: usize = 65_536;
const MIN_ARGON2_MEMORY_KIB: u32 = 8;
const MIN_ARGON2_HASH_LENGTH: usize = 4;
const MAX_ARGON2_HASH_LENGTH: usize = 1024;

fn aes_gcm_seal(key: &[u8], iv: &[u8], payload: Payload<'_, '_>) -> Result<Vec<u8>, CryptoError> {
    let iv: &[u8; IV_LENGTH] = iv.try_into().map_err(|_| CryptoError::InvalidIvLength)?;
    match key.len() {
        16 => Aes128Gcm::new_from_slice(key)
            .map_err(|_| CryptoError::InvalidKeyLength)?
            .encrypt(&(*iv).into(), payload),
        32 => Aes256Gcm::new_from_slice(key)
            .map_err(|_| CryptoError::InvalidKeyLength)?
            .encrypt(&(*iv).into(), payload),
        _ => return Err(CryptoError::InvalidKeyLength),
    }
    .map_err(|_| CryptoError::OperationFailed)
}

fn aes_gcm_open(
    key: &[u8],
    iv: &[u8],
    payload: Payload<'_, '_>,
) -> Result<Option<Vec<u8>>, CryptoError> {
    let iv: &[u8; IV_LENGTH] = iv.try_into().map_err(|_| CryptoError::InvalidIvLength)?;
    let opened = match key.len() {
        16 => Aes128Gcm::new_from_slice(key)
            .map_err(|_| CryptoError::InvalidKeyLength)?
            .decrypt(&(*iv).into(), payload),
        32 => Aes256Gcm::new_from_slice(key)
            .map_err(|_| CryptoError::InvalidKeyLength)?
            .decrypt(&(*iv).into(), payload),
        _ => return Err(CryptoError::InvalidKeyLength),
    };
    Ok(opened.ok())
}

impl KeyStore {
    /// Returns the ciphertext followed by the 16-byte tag.
    pub fn aes_gcm_encrypt(
        &self,
        handle: &str,
        iv: &[u8],
        aad: &[u8],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let key = self.raw_for(handle, KeyAlgorithm::AesGcm)?;
        aes_gcm_seal(
            key,
            iv,
            Payload {
                msg: plaintext,
                aad,
            },
        )
    }

    /// Returns `Ok(None)` when authentication fails.
    pub fn aes_gcm_decrypt(
        &self,
        handle: &str,
        iv: &[u8],
        aad: &[u8],
        data: &[u8],
    ) -> Result<Option<Vec<u8>>, CryptoError> {
        let key = self.raw_for(handle, KeyAlgorithm::AesGcm)?;
        aes_gcm_open(key, iv, Payload { msg: data, aad })
    }

    pub fn hkdf_sha256(
        &self,
        handle: &str,
        salt: &[u8],
        info: &[u8],
        length: usize,
    ) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        let ikm = self.raw_for(handle, KeyAlgorithm::Hkdf)?;
        if !(1..=MAX_HKDF_LENGTH).contains(&length) {
            return Err(CryptoError::InvalidHkdfLength);
        }
        let mut okm = Zeroizing::new(vec![0u8; length]);
        Hkdf::<Sha256>::new(Some(salt), ikm)
            .expand(info, &mut okm)
            .map_err(|_| CryptoError::InvalidHkdfLength)?;
        Ok(okm)
    }

    pub fn hmac_sha256(&self, handle: &str, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let key = self.raw_for(handle, KeyAlgorithm::HmacSha256)?;
        let mut mac =
            Hmac::<Sha256>::new_from_slice(key).map_err(|_| CryptoError::OperationFailed)?;
        mac.update(data);
        Ok(mac.finalize().into_bytes().to_vec())
    }
}

pub fn digest(algorithm: &str, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    match algorithm {
        "SHA-1" => Ok(Sha1::digest(data).to_vec()),
        "SHA-256" => Ok(Sha256::digest(data).to_vec()),
        _ => Err(CryptoError::UnsupportedDigestAlgorithm),
    }
}

pub struct Argon2Params<'a> {
    pub password: &'a [u8],
    pub salt: &'a [u8],
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub hash_length: usize,
}

/// Blocking; callers run it off their main thread.
pub fn argon2id(params: Argon2Params<'_>) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    let valid = params.memory_kib >= MIN_ARGON2_MEMORY_KIB
        && (MIN_ARGON2_HASH_LENGTH..=MAX_ARGON2_HASH_LENGTH).contains(&params.hash_length)
        && params.iterations > 0
        && params.parallelism > 0;
    if !valid {
        return Err(CryptoError::InvalidArgon2Parameters);
    }
    let engine_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(params.hash_length),
    )
    .map_err(|_| CryptoError::InvalidArgon2Parameters)?;
    let mut output = Zeroizing::new(vec![0u8; params.hash_length]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, engine_params)
        .hash_password_into(params.password, params.salt, &mut output)
        .map_err(|_| CryptoError::InvalidArgon2Parameters)?;
    Ok(output)
}

pub fn random_bytes(length: usize) -> Result<Vec<u8>, CryptoError> {
    if length > MAX_RANDOM_LENGTH {
        return Err(CryptoError::InvalidRandomLength);
    }
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes).map_err(|_| CryptoError::RandomUnavailable)?;
    Ok(bytes)
}
