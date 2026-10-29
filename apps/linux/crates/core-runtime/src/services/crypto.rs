use std::rc::Rc;

use commitnote_crypto::{Argon2Params, KeyAlgorithm, Zeroizing};
use javascriptcore6 as jsc;

use crate::host::{Host, Method, blocking};
use crate::js::{self, HostError, HostResult};
use crate::services::ServiceError;

const MAX_HKDF_LENGTH: f64 = 255.0 * 32.0;
const MAX_RANDOM_LENGTH: f64 = 65_536.0;
const MAX_ARGON2_PARALLELISM: f64 = 16_777_215.0;
const MIN_ARGON2_HASH_LENGTH: f64 = 4.0;
const MAX_ARGON2_HASH_LENGTH: f64 = 1024.0;
const MIN_ARGON2_MEMORY_KIB: f64 = 8.0;
const ARGON2_FAILED: &str = "Argon2id failed";

pub(crate) const METHODS: &[(&str, Method)] = &[
    ("importKey", import_key),
    ("aesGcmEncrypt", aes_gcm_encrypt),
    ("aesGcmDecrypt", aes_gcm_decrypt),
    ("hkdfSha256", hkdf_sha256),
    ("hmacSha256", hmac_sha256),
    ("digest", digest),
    ("argon2id", argon2id),
];

fn arg(arguments: &[jsc::Value], index: usize) -> Option<&jsc::Value> {
    arguments.get(index)
}

fn import_key(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let raw = Zeroizing::new(js::bytes(arg(arguments, 0))?);
    let algorithm: KeyAlgorithm = js::string_arg(arg(arguments, 1))?.parse()?;
    let handle = host.keys.borrow_mut().import(&raw, algorithm)?;
    Ok(js::string(&host.context, &handle))
}

fn aes_gcm_encrypt(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let handle = js::string_arg(arg(arguments, 0))?;
    let iv = js::bytes(arg(arguments, 1))?;
    let aad = js::bytes(arg(arguments, 2))?;
    let plaintext = Zeroizing::new(js::bytes(arg(arguments, 3))?);
    let sealed = host
        .keys
        .borrow()
        .aes_gcm_encrypt(&handle, &iv, &aad, &plaintext)?;
    host.bytes(&sealed)
}

fn aes_gcm_decrypt(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let handle = js::string_arg(arg(arguments, 0))?;
    let iv = js::bytes(arg(arguments, 1))?;
    let aad = js::bytes(arg(arguments, 2))?;
    let sealed = js::bytes(arg(arguments, 3))?;
    let opened = host
        .keys
        .borrow()
        .aes_gcm_decrypt(&handle, &iv, &aad, &sealed)?;
    match opened.map(Zeroizing::new) {
        Some(plaintext) => host.bytes(&plaintext),
        None => Ok(js::null(&host.context)),
    }
}

fn hkdf_sha256(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let handle = js::string_arg(arg(arguments, 0))?;
    let salt = js::bytes(arg(arguments, 1))?;
    let info = js::bytes(arg(arguments, 2))?;
    let length = js::integer_arg(arg(arguments, 3), 1.0, MAX_HKDF_LENGTH)? as usize;
    let derived = host
        .keys
        .borrow()
        .hkdf_sha256(&handle, &salt, &info, length)?;
    host.bytes(&derived)
}

fn hmac_sha256(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let handle = js::string_arg(arg(arguments, 0))?;
    let data = js::bytes(arg(arguments, 1))?;
    let mac = host.keys.borrow().hmac_sha256(&handle, &data)?;
    host.bytes(&mac)
}

fn digest(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let algorithm = js::string_arg(arg(arguments, 0))?;
    let data = js::bytes(arg(arguments, 1))?;
    host.bytes(&commitnote_crypto::digest(&algorithm, &data)?)
}

fn argon2id(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let input = js::object_arg(arg(arguments, 0))?;
    let field = |name| js::property(&input, name);
    let integer = |name, min, max| js::integer_arg(field(name).as_ref(), min, max);
    let password = Zeroizing::new(js::bytes(field("password").as_ref())?);
    let salt = js::bytes(field("salt").as_ref())?;
    let memory_kib = integer("memoryKiB", MIN_ARGON2_MEMORY_KIB, f64::from(u32::MAX))? as u32;
    let iterations = integer("iterations", 1.0, f64::from(u32::MAX))? as u32;
    let parallelism = integer("parallelism", 1.0, MAX_ARGON2_PARALLELISM)? as u32;
    let hash_length =
        integer("hashLength", MIN_ARGON2_HASH_LENGTH, MAX_ARGON2_HASH_LENGTH)? as usize;
    let work = blocking(move || {
        commitnote_crypto::argon2id(Argon2Params {
            password: &password,
            salt: &salt,
            memory_kib,
            iterations,
            parallelism,
            hash_length,
        })
        .map_err(|_| ServiceError::new(ARGON2_FAILED))
    });
    host.promise(Some(ARGON2_FAILED), work, |host, hash| host.bytes(&hash))
}

pub(crate) fn random_bytes(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let length = js::integer_arg(arg(arguments, 0), 0.0, MAX_RANDOM_LENGTH)? as usize;
    let bytes = commitnote_crypto::random_bytes(length).map_err(HostError::from)?;
    host.bytes(&bytes)
}
