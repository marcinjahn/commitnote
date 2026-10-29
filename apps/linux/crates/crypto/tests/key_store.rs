use commitnote_crypto::{
    Argon2Params, CryptoError, KeyAlgorithm, KeyStore, argon2id, digest, random_bytes,
};

const IV: [u8; 12] = [3; 12];

fn aes_store() -> (KeyStore, String) {
    let mut store = KeyStore::new();
    let handle = store.import(&[9u8; 32], KeyAlgorithm::AesGcm).unwrap();
    (store, handle)
}

fn argon2_params(overrides: impl FnOnce(&mut Argon2Params<'static>)) -> Argon2Params<'static> {
    let mut params = Argon2Params {
        password: b"password",
        salt: &[1u8; 16],
        memory_kib: 8,
        iterations: 1,
        parallelism: 1,
        hash_length: 32,
    };
    overrides(&mut params);
    params
}

#[test]
fn handles_are_numbered_from_one_and_never_reused() {
    let mut store = KeyStore::new();
    let first = store.import(&[1u8; 32], KeyAlgorithm::AesGcm).unwrap();
    let second = store.import(&[2u8; 5], KeyAlgorithm::Hkdf).unwrap();
    assert_eq!(first, "k1");
    assert_eq!(second, "k2");
    store.release(&second);
    let third = store.import(&[3u8; 5], KeyAlgorithm::HmacSha256).unwrap();
    assert_eq!(third, "k3");
    store.clear();
    assert_eq!(
        store.import(&[4u8; 16], KeyAlgorithm::AesGcm).unwrap(),
        "k4"
    );
}

#[test]
fn failed_import_does_not_consume_a_handle() {
    let mut store = KeyStore::new();
    assert!(store.import(&[0u8; 24], KeyAlgorithm::AesGcm).is_err());
    assert_eq!(
        store.import(&[0u8; 32], KeyAlgorithm::AesGcm).unwrap(),
        "k1"
    );
}

#[test]
fn key_algorithm_parses_core_names() {
    assert_eq!("AES-GCM".parse(), Ok(KeyAlgorithm::AesGcm));
    assert_eq!("HMAC-SHA-256".parse(), Ok(KeyAlgorithm::HmacSha256));
    assert_eq!("HKDF".parse(), Ok(KeyAlgorithm::Hkdf));
    let error = "RSA".parse::<KeyAlgorithm>().unwrap_err();
    assert_eq!(error.to_string(), "Unsupported key algorithm");
    assert!("aes-gcm".parse::<KeyAlgorithm>().is_err());
}

#[test]
fn aes_key_lengths() {
    let mut store = KeyStore::new();
    assert!(store.import(&[0u8; 16], KeyAlgorithm::AesGcm).is_ok());
    assert!(store.import(&[0u8; 32], KeyAlgorithm::AesGcm).is_ok());
    for length in [0usize, 15, 17, 24, 31, 33, 64] {
        let error = store
            .import(&vec![0u8; length], KeyAlgorithm::AesGcm)
            .unwrap_err();
        assert_eq!(error.to_string(), "Invalid key length", "length {length}");
    }
}

#[test]
fn hmac_and_hkdf_accept_any_key_length() {
    let mut store = KeyStore::new();
    for length in [0usize, 1, 24, 100] {
        assert!(
            store
                .import(&vec![5u8; length], KeyAlgorithm::HmacSha256)
                .is_ok()
        );
        assert!(store.import(&vec![5u8; length], KeyAlgorithm::Hkdf).is_ok());
    }
}

#[test]
fn aes_128_matches_known_answer() {
    let mut store = KeyStore::new();
    let handle = store.import(&[0u8; 16], KeyAlgorithm::AesGcm).unwrap();
    let sealed = store
        .aes_gcm_encrypt(&handle, &[0u8; 12], &[], &[0u8; 16])
        .unwrap();
    assert_eq!(
        hex::encode(&sealed),
        "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf"
    );
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &[0u8; 12], &[], &sealed)
            .unwrap(),
        Some(vec![0u8; 16])
    );
}

#[test]
fn release_makes_only_that_handle_unknown() {
    let mut store = KeyStore::new();
    let kept = store.import(&[1u8; 32], KeyAlgorithm::AesGcm).unwrap();
    let released = store.import(&[2u8; 32], KeyAlgorithm::AesGcm).unwrap();
    store.release(&released);
    store.release(&released);
    store.release("k999");

    assert_eq!(
        store
            .aes_gcm_encrypt(&released, &IV, &[], b"x")
            .unwrap_err(),
        CryptoError::UnknownKeyHandle
    );
    assert_eq!(
        store.export_raw(&released).unwrap_err().to_string(),
        "Unknown key handle"
    );
    assert!(store.aes_gcm_encrypt(&kept, &IV, &[], b"x").is_ok());
}

#[test]
fn clear_makes_every_handle_unknown() {
    let mut store = KeyStore::new();
    let aes = store.import(&[1u8; 32], KeyAlgorithm::AesGcm).unwrap();
    let hmac = store.import(&[1u8; 8], KeyAlgorithm::HmacSha256).unwrap();
    let hkdf = store.import(&[1u8; 8], KeyAlgorithm::Hkdf).unwrap();
    store.clear();

    assert_eq!(
        store.aes_gcm_encrypt(&aes, &IV, &[], b"x").unwrap_err(),
        CryptoError::UnknownKeyHandle
    );
    assert_eq!(
        store.hmac_sha256(&hmac, b"x").unwrap_err(),
        CryptoError::UnknownKeyHandle
    );
    assert_eq!(
        store.hkdf_sha256(&hkdf, &[], &[], 8).unwrap_err(),
        CryptoError::UnknownKeyHandle
    );
    assert!(store.export_raw(&aes).is_err());
}

#[test]
fn export_raw_returns_the_imported_bytes() {
    let mut store = KeyStore::new();
    let handle = store.import(&[0xab; 32], KeyAlgorithm::AesGcm).unwrap();
    assert_eq!(&**store.export_raw(&handle).unwrap(), &[0xab; 32]);
}

#[test]
fn wrong_algorithm_handles_are_unknown() {
    let mut store = KeyStore::new();
    let aes = store.import(&[1u8; 32], KeyAlgorithm::AesGcm).unwrap();
    let hmac = store.import(&[1u8; 32], KeyAlgorithm::HmacSha256).unwrap();
    let hkdf = store.import(&[1u8; 32], KeyAlgorithm::Hkdf).unwrap();
    let unknown = CryptoError::UnknownKeyHandle;

    assert_eq!(
        store.aes_gcm_encrypt(&hmac, &IV, &[], b"x").unwrap_err(),
        unknown
    );
    assert_eq!(
        store
            .aes_gcm_decrypt(&hkdf, &IV, &[], &[0u8; 16])
            .unwrap_err(),
        unknown
    );
    assert_eq!(store.hmac_sha256(&aes, b"x").unwrap_err(), unknown);
    assert_eq!(store.hmac_sha256(&hkdf, b"x").unwrap_err(), unknown);
    assert_eq!(store.hkdf_sha256(&aes, &[], &[], 16).unwrap_err(), unknown);
    assert_eq!(store.hkdf_sha256(&hmac, &[], &[], 16).unwrap_err(), unknown);
    assert_eq!(
        store.hmac_sha256("nope", b"x").unwrap_err().to_string(),
        "Unknown key handle"
    );
}

#[test]
fn decrypt_returns_none_on_any_tampering() {
    let (store, handle) = aes_store();
    let sealed = store
        .aes_gcm_encrypt(&handle, &IV, b"aad", b"hello world")
        .unwrap();
    assert_eq!(sealed.len(), 11 + 16);

    let mut flipped_tag = sealed.clone();
    *flipped_tag.last_mut().unwrap() ^= 0x01;
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &IV, b"aad", &flipped_tag)
            .unwrap(),
        None
    );

    let mut flipped_body = sealed.clone();
    flipped_body[0] ^= 0x80;
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &IV, b"aad", &flipped_body)
            .unwrap(),
        None
    );

    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &IV, b"other", &sealed)
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &[4u8; 12], b"aad", &sealed)
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &IV, b"aad", &sealed[..15])
            .unwrap(),
        None
    );
    assert_eq!(
        store.aes_gcm_decrypt(&handle, &IV, b"aad", &[]).unwrap(),
        None
    );
    assert_eq!(
        store
            .aes_gcm_decrypt(&handle, &IV, b"aad", &sealed)
            .unwrap(),
        Some(b"hello world".to_vec())
    );
}

#[test]
fn aes_gcm_requires_a_12_byte_iv() {
    let (store, handle) = aes_store();
    for length in [0usize, 8, 11, 13, 16] {
        let iv = vec![1u8; length];
        let encrypt = store.aes_gcm_encrypt(&handle, &iv, &[], b"x").unwrap_err();
        let decrypt = store
            .aes_gcm_decrypt(&handle, &iv, &[], &[0u8; 20])
            .unwrap_err();
        assert_eq!(encrypt.to_string(), "AES-GCM IV must be 12 bytes");
        assert_eq!(decrypt.to_string(), "AES-GCM IV must be 12 bytes");
    }
    let short_data = store
        .aes_gcm_decrypt(&handle, &[1u8; 8], &[], &[])
        .unwrap_err();
    assert_eq!(short_data, CryptoError::InvalidIvLength);
}

#[test]
fn hkdf_length_limits() {
    let mut store = KeyStore::new();
    let handle = store.import(&[1u8; 22], KeyAlgorithm::Hkdf).unwrap();
    assert_eq!(store.hkdf_sha256(&handle, &[], &[], 1).unwrap().len(), 1);
    assert_eq!(
        store.hkdf_sha256(&handle, &[], &[], 8160).unwrap().len(),
        8160
    );
    for length in [0usize, 8161, 100_000] {
        let error = store.hkdf_sha256(&handle, &[], &[], length).unwrap_err();
        assert_eq!(error.to_string(), "Invalid HKDF length");
    }
}

#[test]
fn digest_algorithms() {
    assert_eq!(
        hex::encode(digest("SHA-1", b"abc").unwrap()),
        "a9993e364706816aba3e25717850c26c9cd0d89d"
    );
    assert_eq!(
        hex::encode(digest("SHA-256", b"abc").unwrap()),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    for name in ["SHA-512", "sha-1", "MD5", ""] {
        assert_eq!(
            digest(name, b"abc").unwrap_err().to_string(),
            "Unsupported digest algorithm"
        );
    }
}

#[test]
fn argon2id_rejects_invalid_parameters() {
    let cases: Vec<(&str, Argon2Params<'static>)> = vec![
        ("memory 7", argon2_params(|p| p.memory_kib = 7)),
        ("memory 0", argon2_params(|p| p.memory_kib = 0)),
        ("hash length 3", argon2_params(|p| p.hash_length = 3)),
        ("hash length 1025", argon2_params(|p| p.hash_length = 1025)),
        ("zero iterations", argon2_params(|p| p.iterations = 0)),
        ("zero parallelism", argon2_params(|p| p.parallelism = 0)),
    ];
    for (name, params) in cases {
        let error = argon2id(params).unwrap_err();
        assert_eq!(error.to_string(), "Invalid Argon2id parameters", "{name}");
    }
}

#[test]
fn argon2id_accepts_boundary_parameters() {
    assert_eq!(argon2id(argon2_params(|_| {})).unwrap().len(), 32);
    assert_eq!(
        argon2id(argon2_params(|p| p.hash_length = 4))
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        argon2id(argon2_params(|p| p.hash_length = 1024))
            .unwrap()
            .len(),
        1024
    );
}

#[test]
fn random_bytes_limits() {
    assert!(random_bytes(0).unwrap().is_empty());
    assert_eq!(random_bytes(65_536).unwrap().len(), 65_536);
    assert_eq!(
        random_bytes(65_537).unwrap_err().to_string(),
        "Invalid random length"
    );
    assert_ne!(random_bytes(32).unwrap(), random_bytes(32).unwrap());
}

#[test]
fn errors_expose_only_fixed_messages() {
    let all = [
        (
            CryptoError::UnsupportedKeyAlgorithm,
            "Unsupported key algorithm",
        ),
        (CryptoError::InvalidKeyLength, "Invalid key length"),
        (CryptoError::UnknownKeyHandle, "Unknown key handle"),
        (CryptoError::InvalidIvLength, "AES-GCM IV must be 12 bytes"),
        (CryptoError::InvalidHkdfLength, "Invalid HKDF length"),
        (
            CryptoError::UnsupportedDigestAlgorithm,
            "Unsupported digest algorithm",
        ),
        (
            CryptoError::InvalidArgon2Parameters,
            "Invalid Argon2id parameters",
        ),
        (CryptoError::InvalidRandomLength, "Invalid random length"),
    ];
    for (error, message) in all {
        assert_eq!(error.to_string(), message);
        let boxed: Box<dyn std::error::Error> = Box::new(error);
        assert_eq!(boxed.to_string(), message);
    }
}
