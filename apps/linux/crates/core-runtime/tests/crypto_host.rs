mod common;

use commitnote_core_api::NATIVE_CORE_MARKER;
use commitnote_core_runtime::{CoreRuntime, RuntimeConfig};
use serde_json::{Value, json};

use common::block_on;

const API_VERSION: u32 = 7;

const PROBE_START: &str = r#"
  const reply = (id, result) =>
    host.post(JSON.stringify({ kind: "response", id, ok: true, result }));
  const hex = (bytes) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bytes = (...values) => new Uint8Array(values);
  const message = (action) => {
    try {
      action();
      return null;
    } catch (error) {
      return error.message;
    }
  };
  const aesKey = (length) => host.crypto.importKey(new Uint8Array(length).fill(7), "AES-GCM");
  const commands = {
    nonBytesArguments() {
      const key = aesKey(32);
      const hmacKey = host.crypto.importKey(bytes(1), "HMAC-SHA-256");
      const hkdfKey = host.crypto.importKey(bytes(1), "HKDF");
      const notBytes = [[1, 2, 3], new Int8Array(3), new ArrayBuffer(3), new Uint8ClampedArray(3), "abc", null, undefined];
      const outcomes = {};
      const attempt = (name, call) => {
        outcomes[name] = notBytes.map((value) => message(() => call(value)));
      };
      attempt("importKey", (value) => host.crypto.importKey(value, "AES-GCM"));
      attempt("encryptIv", (value) => host.crypto.aesGcmEncrypt(key, value, bytes(), bytes(1)));
      attempt("encryptAad", (value) => host.crypto.aesGcmEncrypt(key, new Uint8Array(12), value, bytes(1)));
      attempt("encryptPlaintext", (value) => host.crypto.aesGcmEncrypt(key, new Uint8Array(12), bytes(), value));
      attempt("decryptSealed", (value) => host.crypto.aesGcmDecrypt(key, new Uint8Array(12), bytes(), value));
      attempt("hkdfSalt", (value) => host.crypto.hkdfSha256(hkdfKey, value, bytes(), 8));
      attempt("hkdfInfo", (value) => host.crypto.hkdfSha256(hkdfKey, bytes(), value, 8));
      attempt("hmacData", (value) => host.crypto.hmacSha256(hmacKey, value));
      attempt("digestData", (value) => host.crypto.digest("SHA-256", value));
      attempt("argonPassword", (value) => host.crypto.argon2id({
        password: value, salt: new Uint8Array(16), memoryKiB: 8, iterations: 1, parallelism: 1, hashLength: 16,
      }));
      attempt("argonSalt", (value) => host.crypto.argon2id({
        password: bytes(1), salt: value, memoryKiB: 8, iterations: 1, parallelism: 1, hashLength: 16,
      }));
      return outcomes;
    },
    handles() {
      const aes = aesKey(16);
      const hmac = host.crypto.importKey(bytes(1, 2, 3), "HMAC-SHA-256");
      const hkdf = host.crypto.importKey(bytes(1, 2, 3), "HKDF");
      const iv = new Uint8Array(12);
      const data = bytes(1, 2, 3);
      return {
        working: {
          aes: host.crypto.aesGcmEncrypt(aes, iv, bytes(), data).length,
          hmac: host.crypto.hmacSha256(hmac, data).length,
          hkdf: host.crypto.hkdfSha256(hkdf, bytes(), bytes(), 8).length,
        },
        unknown: [
          message(() => host.crypto.aesGcmEncrypt("k9999", iv, bytes(), data)),
          message(() => host.crypto.aesGcmDecrypt("", iv, bytes(), new Uint8Array(16))),
          message(() => host.crypto.hmacSha256("nonsense", data)),
          message(() => host.crypto.hkdfSha256("k0", bytes(), bytes(), 8)),
        ],
        wrongAlgorithm: {
          hmacAsAes: message(() => host.crypto.aesGcmEncrypt(hmac, iv, bytes(), data)),
          hkdfAsAes: message(() => host.crypto.aesGcmDecrypt(hkdf, iv, bytes(), new Uint8Array(16))),
          aesAsHmac: message(() => host.crypto.hmacSha256(aes, data)),
          hkdfAsHmac: message(() => host.crypto.hmacSha256(hkdf, data)),
          aesAsHkdf: message(() => host.crypto.hkdfSha256(aes, bytes(), bytes(), 8)),
          hmacAsHkdf: message(() => host.crypto.hkdfSha256(hmac, bytes(), bytes(), 8)),
        },
        notAString: message(() => host.crypto.hmacSha256(42, data)),
      };
    },
    tamperedTag() {
      const key = aesKey(32);
      const iv = new Uint8Array(12).fill(3);
      const aad = bytes(9, 9);
      const plaintext = bytes(1, 2, 3, 4, 5);
      const sealed = host.crypto.aesGcmEncrypt(key, iv, aad, plaintext);
      const flipped = (index) => {
        const copy = sealed.slice();
        copy[index] ^= 1;
        return host.crypto.aesGcmDecrypt(key, iv, aad, copy);
      };
      const opened = host.crypto.aesGcmDecrypt(key, iv, aad, sealed);
      return {
        sealedLength: sealed.length,
        opened: hex(opened),
        flippedTagBit: flipped(sealed.length - 1),
        flippedFirstTagBit: flipped(sealed.length - 16),
        flippedCiphertextBit: flipped(0),
        wrongAad: host.crypto.aesGcmDecrypt(key, iv, bytes(9), sealed),
        shortInput: host.crypto.aesGcmDecrypt(key, iv, aad, bytes(1, 2, 3)),
      };
    },
    keyLengths() {
      const hmac = host.crypto.importKey(new Uint8Array(24), "HMAC-SHA-256");
      const hkdf = host.crypto.importKey(new Uint8Array(24), "HKDF");
      return {
        aes24: message(() => aesKey(24)),
        aes15: message(() => aesKey(15)),
        aes0: message(() => aesKey(0)),
        aes16: message(() => aesKey(16)),
        aes32: message(() => aesKey(32)),
        hmac24: host.crypto.hmacSha256(hmac, bytes(1)).length,
        hkdf24: host.crypto.hkdfSha256(hkdf, bytes(), bytes(), 8).length,
      };
    },
    limits() {
      const hkdf = host.crypto.importKey(bytes(1), "HKDF");
      return {
        random65536: host.random.randomBytes(65536).length,
        random0: host.random.randomBytes(0).length,
        randomNegative: message(() => host.random.randomBytes(-1)),
        randomFractional: message(() => host.random.randomBytes(1.5)),
        random65537: message(() => host.random.randomBytes(65537)),
        hkdf8161: message(() => host.crypto.hkdfSha256(hkdf, bytes(), bytes(), 8161)),
        hkdf8160: host.crypto.hkdfSha256(hkdf, bytes(), bytes(), 8160).length,
        hkdf0: message(() => host.crypto.hkdfSha256(hkdf, bytes(), bytes(), 0)),
      };
    },
    unsupportedAlgorithms() {
      return {
        key: message(() => host.crypto.importKey(bytes(1), "RSA")),
        digest: message(() => host.crypto.digest("MD5", bytes(1))),
      };
    },
    async argon2Concurrency() {
      const order = [];
      host.clock.setTimeout(() => order.push("timer"), 10);
      const hash = await host.crypto.argon2id({
        password: bytes(1, 2, 3),
        salt: new Uint8Array(16).fill(5),
        memoryKiB: 65536,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
      });
      order.push("argon2id");
      return { order, hashLength: hash.length, isUint8Array: hash instanceof Uint8Array };
    },
    async argon2Rejections() {
      const rejection = async (overrides) => {
        try {
          await host.crypto.argon2id({
            password: bytes(1), salt: new Uint8Array(16), memoryKiB: 8, iterations: 1, parallelism: 1, hashLength: 16,
            ...overrides,
          });
          return null;
        } catch (error) {
          return error.message;
        }
      };
      return {
        memory: await rejection({ memoryKiB: 7 }),
        iterations: await rejection({ iterations: 0 }),
        parallelism: await rejection({ parallelism: 0 }),
        hashLength: await rejection({ hashLength: 3 }),
        shortSalt: await rejection({ salt: new Uint8Array(4) }),
      };
    },
  };
  return {
    send(text) {
      const request = JSON.parse(text);
      Promise.resolve(commands[request.command]()).then((result) => reply(request.id, result));
    },
    stop() {},
  };
"#;

fn probe(command: &str) -> Value {
    let bundle = format!(
        "globalThis.CommitnoteNativeCore = {{ marker: {NATIVE_CORE_MARKER:?}, apiVersion: {API_VERSION}, start(host) {{ {PROBE_START} }} }};"
    );
    let runtime =
        CoreRuntime::start(RuntimeConfig::new(bundle, "Linux")).expect("the probe starts");
    block_on(runtime.send(command, json!({}))).expect("the probe answers")
}

#[test]
fn byte_arguments_must_be_uint8_arrays() {
    let outcomes = probe("nonBytesArguments");

    for (name, messages) in outcomes.as_object().expect("an object of outcomes") {
        assert_eq!(
            messages,
            &json!(vec!["Expected a Uint8Array"; 7]),
            "{name} accepted a value that is not a Uint8Array"
        );
    }
}

#[test]
fn unknown_and_wrong_algorithm_handles_are_rejected() {
    let result = probe("handles");

    assert_eq!(
        result["working"],
        json!({ "aes": 19, "hmac": 32, "hkdf": 8 })
    );
    assert_eq!(result["unknown"], json!(vec!["Unknown key handle"; 4]));
    for (name, message) in result["wrongAlgorithm"].as_object().expect("an object") {
        assert_eq!(message, "Unknown key handle", "{name}");
    }
    assert_eq!(result["notAString"], "Expected a string");
}

#[test]
fn decrypting_with_a_tampered_input_resolves_to_null() {
    let result = probe("tamperedTag");

    assert_eq!(result["sealedLength"], 21);
    assert_eq!(result["opened"], "0102030405");
    for field in [
        "flippedTagBit",
        "flippedFirstTagBit",
        "flippedCiphertextBit",
        "wrongAad",
        "shortInput",
    ] {
        assert_eq!(result[field], Value::Null, "{field}");
    }
}

#[test]
fn only_16_and_32_byte_aes_keys_are_accepted() {
    let result = probe("keyLengths");

    for field in ["aes24", "aes15", "aes0"] {
        assert_eq!(result[field], "Invalid key length", "{field}");
    }
    assert_eq!(result["aes16"], Value::Null);
    assert_eq!(result["aes32"], Value::Null);
    assert_eq!(result["hmac24"], 32);
    assert_eq!(result["hkdf24"], 8);
}

#[test]
fn random_and_hkdf_lengths_are_bounded() {
    let result = probe("limits");

    for field in [
        "random65537",
        "randomNegative",
        "randomFractional",
        "hkdf8161",
        "hkdf0",
    ] {
        assert_eq!(result[field], "Integer out of range", "{field}");
    }
    assert_eq!(result["random65536"], 65536);
    assert_eq!(result["random0"], 0);
    assert_eq!(result["hkdf8160"], 8160);
}

#[test]
fn unsupported_algorithms_are_rejected() {
    let result = probe("unsupportedAlgorithms");

    assert_eq!(result["key"], "Unsupported key algorithm");
    assert_eq!(result["digest"], "Unsupported digest algorithm");
}

#[test]
fn argon2id_resolves_while_timers_keep_firing() {
    let result = probe("argon2Concurrency");

    assert_eq!(result["order"], json!(["timer", "argon2id"]));
    assert_eq!(result["hashLength"], 32);
    assert_eq!(result["isUint8Array"], true);
}

#[test]
fn argon2id_rejects_invalid_parameters_with_a_generic_message() {
    let result = probe("argon2Rejections");

    for (name, message) in result.as_object().expect("an object") {
        let expected = if name == "shortSalt" {
            "Argon2id failed"
        } else {
            "Integer out of range"
        };
        assert_eq!(message, expected, "{name}");
    }
}
