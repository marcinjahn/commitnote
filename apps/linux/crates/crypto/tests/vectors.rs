use commitnote_crypto::{Argon2Params, KeyAlgorithm, KeyStore, argon2id, digest};
use serde::Deserialize;

fn load<T: for<'de> Deserialize<'de>>(name: &str) -> T {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../test-vectors/").to_owned() + name;
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn unhex(value: &str) -> Vec<u8> {
    hex::decode(value).unwrap()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AesGcmVector {
    key_hex: String,
    iv_hex: String,
    aad_hex: String,
    plaintext_hex: String,
    ciphertext_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HkdfVector {
    ikm_hex: String,
    salt_hex: String,
    info_hex: String,
    length_bytes: usize,
    okm_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HmacVector {
    key_hex: String,
    data_hex: String,
    mac_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DigestVector {
    data_hex: String,
    digest_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Primitives {
    aes_gcm: Vec<AesGcmVector>,
    hkdf_sha256: Vec<HkdfVector>,
    hmac_sha256: Vec<HmacVector>,
    sha1: Vec<DigestVector>,
    sha256: Vec<DigestVector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Argon2Vector {
    name: String,
    password: String,
    salt_hex: String,
    memory_ki_b: u32,
    iterations: u32,
    parallelism: u32,
    hash_length: usize,
    output_hex: String,
}

#[derive(Deserialize)]
struct Argon2Vectors {
    vectors: Vec<Argon2Vector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitBlobVector {
    content_hex: String,
    sha: String,
}

#[derive(Deserialize)]
struct GitBlobVectors {
    vectors: Vec<GitBlobVector>,
}

#[test]
fn aes_gcm_vectors_encrypt_and_decrypt() {
    let primitives: Primitives = load("primitives.json");
    assert!(!primitives.aes_gcm.is_empty());
    for vector in primitives.aes_gcm {
        let mut store = KeyStore::new();
        let key = unhex(&vector.key_hex);
        let handle = store.import(&key, KeyAlgorithm::AesGcm).unwrap();
        let iv = unhex(&vector.iv_hex);
        let aad = unhex(&vector.aad_hex);
        let plaintext = unhex(&vector.plaintext_hex);
        let sealed = unhex(&vector.ciphertext_hex);

        assert_eq!(
            store
                .aes_gcm_encrypt(&handle, &iv, &aad, &plaintext)
                .unwrap(),
            sealed
        );
        assert_eq!(
            store.aes_gcm_decrypt(&handle, &iv, &aad, &sealed).unwrap(),
            Some(plaintext)
        );
    }
}

#[test]
fn aes_192_vectors_are_rejected() {
    let primitives: Primitives = load("primitives.json");
    for vector in primitives.aes_gcm {
        assert_ne!(unhex(&vector.key_hex).len(), 24);
    }
    let mut store = KeyStore::new();
    let error = store.import(&[7u8; 24], KeyAlgorithm::AesGcm).unwrap_err();
    assert_eq!(error.to_string(), "Invalid key length");
}

#[test]
fn hkdf_sha256_vectors() {
    let primitives: Primitives = load("primitives.json");
    assert!(!primitives.hkdf_sha256.is_empty());
    for vector in primitives.hkdf_sha256 {
        let mut store = KeyStore::new();
        let handle = store
            .import(&unhex(&vector.ikm_hex), KeyAlgorithm::Hkdf)
            .unwrap();
        let okm = store
            .hkdf_sha256(
                &handle,
                &unhex(&vector.salt_hex),
                &unhex(&vector.info_hex),
                vector.length_bytes,
            )
            .unwrap();
        assert_eq!(hex::encode(&*okm), vector.okm_hex);
    }
}

#[test]
fn hmac_sha256_vectors() {
    let primitives: Primitives = load("primitives.json");
    assert!(!primitives.hmac_sha256.is_empty());
    for vector in primitives.hmac_sha256 {
        let mut store = KeyStore::new();
        let handle = store
            .import(&unhex(&vector.key_hex), KeyAlgorithm::HmacSha256)
            .unwrap();
        let mac = store
            .hmac_sha256(&handle, &unhex(&vector.data_hex))
            .unwrap();
        assert_eq!(hex::encode(mac), vector.mac_hex);
    }
}

#[test]
fn sha1_vectors() {
    let primitives: Primitives = load("primitives.json");
    assert!(!primitives.sha1.is_empty());
    for vector in primitives.sha1 {
        let out = digest("SHA-1", &unhex(&vector.data_hex)).unwrap();
        assert_eq!(hex::encode(out), vector.digest_hex);
    }
}

#[test]
fn sha256_vectors() {
    let primitives: Primitives = load("primitives.json");
    assert!(!primitives.sha256.is_empty());
    for vector in primitives.sha256 {
        let out = digest("SHA-256", &unhex(&vector.data_hex)).unwrap();
        assert_eq!(hex::encode(out), vector.digest_hex);
    }
}

#[test]
fn git_blob_sha1_vectors() {
    let vectors: GitBlobVectors = load("git-blob-sha1.json");
    assert!(!vectors.vectors.is_empty());
    for vector in vectors.vectors {
        let content = unhex(&vector.content_hex);
        let mut blob = format!("blob {}\0", content.len()).into_bytes();
        blob.extend_from_slice(&content);
        assert_eq!(hex::encode(digest("SHA-1", &blob).unwrap()), vector.sha);
    }
}

#[test]
fn argon2id_vectors() {
    let vectors: Argon2Vectors = load("argon2id.json");
    assert!(vectors.vectors.iter().any(|v| v.memory_ki_b == 65_536));
    for vector in vectors.vectors {
        let output = argon2id(Argon2Params {
            password: vector.password.as_bytes(),
            salt: &unhex(&vector.salt_hex),
            memory_kib: vector.memory_ki_b,
            iterations: vector.iterations,
            parallelism: vector.parallelism,
            hash_length: vector.hash_length,
        })
        .unwrap_or_else(|e| panic!("{}: {e}", vector.name));
        assert_eq!(hex::encode(&*output), vector.output_hex, "{}", vector.name);
    }
}
