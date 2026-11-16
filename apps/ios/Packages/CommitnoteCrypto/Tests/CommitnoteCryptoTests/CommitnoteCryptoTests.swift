import Foundation
import Testing

@testable import CommitnoteCrypto

private let repositoryRoot: URL = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    return url
}()

private typealias JSON = [String: Any]

private func loadJSON(_ url: URL) throws -> JSON {
    let data = try Data(contentsOf: url)
    return try #require(try JSONSerialization.jsonObject(with: data) as? JSON)
}

private func vectors(_ file: String) throws -> JSON {
    try loadJSON(repositoryRoot.appendingPathComponent("apps/test-vectors/\(file)"))
}

private func entries(_ json: JSON, _ key: String) throws -> [JSON] {
    try #require(json[key] as? [JSON], "missing \(key)")
}

private func hex(_ entry: JSON, _ key: String) throws -> Data {
    let string = try #require(entry[key] as? String, "missing \(key)")
    var data = Data()
    var index = string.startIndex
    while index < string.endIndex {
        let next = string.index(index, offsetBy: 2)
        data.append(try #require(UInt8(string[index..<next], radix: 16), "bad hex in \(key)"))
        index = next
    }
    return data
}

private func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

private func string(_ entry: JSON, _ key: String) throws -> String {
    try #require(entry[key] as? String, "missing \(key)")
}

private func int(_ entry: JSON, _ key: String) throws -> Int {
    try #require(entry[key] as? Int, "missing \(key)")
}

private func base64Url(_ value: String) throws -> Data {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }
    return try #require(Data(base64Encoded: base64), "bad base64url")
}

private func utf8(_ value: String) -> Data { Data(value.utf8) }

private struct KeyringVector {
    let name: String
    let master: Data
    let content: Data
    let nameKey: Data
    let nameIv: Data
    let keyCheckKey: Data
    let keyCheck: String
}

private func keyring(_ name: String) throws -> KeyringVector {
    let all = try entries(vectors("keyring.json"), "vectors")
    let entry = try #require(all.first { $0["name"] as? String == name })
    return KeyringVector(
        name: name,
        master: try hex(entry, "masterSecretHex"),
        content: try hex(entry, "contentKeyHex"),
        nameKey: try hex(entry, "nameKeyHex"),
        nameIv: try hex(entry, "nameIvKeyHex"),
        keyCheckKey: try hex(entry, "keyCheckKeyHex"),
        keyCheck: try string(entry, "keyCheck")
    )
}

private func hkdf(_ master: Data, _ info: String) -> Data {
    HKDFSHA256.derive(ikm: master, salt: Data(), info: utf8(info), outputByteCount: 32)
}

private func keyCheck(keyCheckKey: Data) -> String {
    HMACSHA256.mac(key: keyCheckKey, data: utf8("commitnote key check v1")).base64EncodedString()
}

@Suite struct Argon2idVectors {
    @Test func matchesVectors() throws {
        for vector in try entries(vectors("argon2id.json"), "vectors") {
            let name = try string(vector, "name")
            let output = try Argon2id.hash(
                password: utf8(try string(vector, "password")),
                salt: try hex(vector, "saltHex"),
                memoryKiB: UInt32(try int(vector, "memoryKiB")),
                iterations: UInt32(try int(vector, "iterations")),
                parallelism: UInt32(try int(vector, "parallelism")),
                hashLength: try int(vector, "hashLength")
            )
            #expect(hexString(output) == (try string(vector, "outputHex")), "argon2id vector \(name)")
        }
    }

    @Test func rejectsInvalidParameters() {
        #expect(throws: CommitnoteCryptoError.self) {
            try Argon2id.hash(password: Data(), salt: Data(count: 4), memoryKiB: 1024, iterations: 1, parallelism: 1)
        }
    }
}

@Suite struct PrimitiveVectors {
    @Test func aesGcm() throws {
        let cases = try entries(vectors("primitives.json"), "aesGcm")
        #expect(cases.count >= 3)
        for (index, vector) in cases.enumerated() {
            let key = try hex(vector, "keyHex")
            let iv = try hex(vector, "ivHex")
            let aad = try hex(vector, "aadHex")
            let plaintext = try hex(vector, "plaintextHex")
            let expected = try hex(vector, "ciphertextHex")
            let sealed = try AESGCM.seal(key: key, iv: iv, additionalData: aad, plaintext: plaintext)
            #expect(sealed == expected, "aesGcm seal vector #\(index)")
            let opened = try AESGCM.open(key: key, iv: iv, additionalData: aad, sealed: expected)
            #expect(opened == plaintext, "aesGcm open vector #\(index)")
        }
    }

    @Test func aesGcmRejectsTampering() throws {
        let vector = try #require(try entries(vectors("primitives.json"), "aesGcm").first)
        let key = try hex(vector, "keyHex")
        let iv = try hex(vector, "ivHex")
        let aad = try hex(vector, "aadHex")
        var sealed = try hex(vector, "ciphertextHex")
        sealed[0] ^= 1
        #expect(throws: CommitnoteCryptoError.authenticationFailed) {
            try AESGCM.open(key: key, iv: iv, additionalData: aad, sealed: sealed)
        }
        #expect(throws: CommitnoteCryptoError.invalidKeyLength) {
            try AESGCM.seal(key: Data(count: 16), iv: iv, additionalData: aad, plaintext: Data())
        }
        #expect(throws: CommitnoteCryptoError.invalidNonce) {
            try AESGCM.seal(key: key, iv: Data(count: 8), additionalData: aad, plaintext: Data())
        }
    }

    @Test func hkdfSha256() throws {
        let cases = try entries(vectors("primitives.json"), "hkdfSha256")
        #expect(cases.count >= 3)
        for (index, vector) in cases.enumerated() {
            let okm = HKDFSHA256.derive(
                ikm: try hex(vector, "ikmHex"),
                salt: try hex(vector, "saltHex"),
                info: try hex(vector, "infoHex"),
                outputByteCount: try int(vector, "lengthBytes")
            )
            #expect(okm == (try hex(vector, "okmHex")), "hkdfSha256 vector #\(index)")
        }
    }

    @Test func hmacSha256() throws {
        let cases = try entries(vectors("primitives.json"), "hmacSha256")
        #expect(cases.count >= 3)
        for (index, vector) in cases.enumerated() {
            let mac = HMACSHA256.mac(key: try hex(vector, "keyHex"), data: try hex(vector, "dataHex"))
            #expect(mac == (try hex(vector, "macHex")), "hmacSha256 vector #\(index)")
        }
    }

    @Test func sha1() throws {
        let cases = try entries(vectors("primitives.json"), "sha1")
        #expect(cases.count >= 3)
        for (index, vector) in cases.enumerated() {
            #expect(
                Digest.sha1(try hex(vector, "dataHex")) == (try hex(vector, "digestHex")), "sha1 vector #\(index)")
        }
    }

    @Test func sha256() throws {
        let cases = try entries(vectors("primitives.json"), "sha256")
        #expect(cases.count >= 3)
        for (index, vector) in cases.enumerated() {
            #expect(
                Digest.sha256(try hex(vector, "dataHex")) == (try hex(vector, "digestHex")),
                "sha256 vector #\(index)")
        }
    }
}

@Suite struct KeyringVectors {
    @Test func derivesKeysAndKeyCheck() throws {
        for vector in try entries(vectors("keyring.json"), "vectors") {
            let name = try string(vector, "name")
            let kdf = try #require(vector["kdf"] as? JSON)
            let passphrase = try string(vector, "passphrase").precomposedStringWithCanonicalMapping
            let master = try Argon2id.hash(
                password: utf8(passphrase),
                salt: try hex(kdf, "saltHex"),
                memoryKiB: UInt32(try int(kdf, "memoryKiB")),
                iterations: UInt32(try int(kdf, "iterations")),
                parallelism: UInt32(try int(kdf, "parallelism"))
            )
            #expect(master == (try hex(vector, "masterSecretHex")), "keyring \(name) master secret")
            #expect(hkdf(master, "commitnote v1 content key") == (try hex(vector, "contentKeyHex")), "keyring \(name) content key")
            #expect(hkdf(master, "commitnote v1 name key") == (try hex(vector, "nameKeyHex")), "keyring \(name) name key")
            #expect(hkdf(master, "commitnote v1 name iv key") == (try hex(vector, "nameIvKeyHex")), "keyring \(name) name iv key")
            let checkKey = hkdf(master, "commitnote v1 key check key")
            #expect(checkKey == (try hex(vector, "keyCheckKeyHex")), "keyring \(name) key check key")
            #expect(keyCheck(keyCheckKey: checkKey) == (try string(vector, "keyCheck")), "keyring \(name) key check")
        }
    }
}

@Suite struct EncryptedVectors {
    @Test func decryptsNames() throws {
        let keyA = try keyring("A")
        let segments = try entries(vectors("names.json"), "segments")
        #expect(!segments.isEmpty)
        for vector in segments {
            let name = try string(vector, "name")
            let combined = try base64Url(try string(vector, "segment"))
            let opened = try AESGCM.open(
                key: keyA.nameKey,
                iv: combined.prefix(12),
                additionalData: utf8("commitnote name v1"),
                sealed: combined.dropFirst(12)
            )
            let decrypted = try #require(String(data: opened, encoding: .utf8))
            #expect(decrypted == name.precomposedStringWithCanonicalMapping, "name vector \(hexString(utf8(name).prefix(8)))")
        }
    }

    @Test func decryptsNotesAndIndexes() throws {
        let keyA = try keyring("A")
        let json = try vectors("notes.json")
        let stored =
            try entries(json, "notes").map { ($0, try string($0, "markdown")) }
            + entries(json, "indexes").map { ($0, try string($0, "serialized")) }
        #expect(!stored.isEmpty)
        for (index, (vector, expected)) in stored.enumerated() {
            let value = try string(vector, "stored")
            #expect(value.hasPrefix("v1:"), "notes vector #\(index) prefix")
            let combined = try #require(Data(base64Encoded: String(value.dropFirst(3))), "notes vector #\(index) base64")
            let opened = try AESGCM.open(
                key: keyA.content,
                iv: combined.prefix(12),
                additionalData: utf8("commitnote note v1"),
                sealed: combined.dropFirst(12)
            )
            #expect(String(data: opened, encoding: .utf8) == expected, "notes vector #\(index)")
        }
    }
}

@Suite struct GitBlobVectors {
    @Test func gitBlobSha1() throws {
        for (index, vector) in try entries(vectors("git-blob-sha1.json"), "vectors").enumerated() {
            let content = try hex(vector, "contentHex")
            let object = utf8("blob \(content.count)\0") + content
            #expect(hexString(Digest.sha1(object)) == (try string(vector, "sha")), "git blob vector #\(index)")
        }
    }
}

@Suite struct SampleNotesRepoKeyCheck {
    @Test func keyCheckMatchesConfig() throws {
        let repo = try loadJSON(repositoryRoot.appendingPathComponent("src/testing/sample-notes-repo/sample-notes-repo.json"))
        let commit = try #require(try entries(repo, "commits").first)
        let files = try #require(commit["files"] as? JSON)
        let configText = try string(files, ".commitnote/config.json")
        let config = try #require(try JSONSerialization.jsonObject(with: utf8(configText)) as? JSON)
        let kdf = try #require(config["kdf"] as? JSON)
        let salt = try #require(Data(base64Encoded: try string(kdf, "salt")))
        let passphrase = try string(repo, "passphrase").precomposedStringWithCanonicalMapping
        let master = try Argon2id.hash(
            password: utf8(passphrase),
            salt: salt,
            memoryKiB: UInt32(try int(kdf, "memoryKiB")),
            iterations: UInt32(try int(kdf, "iterations")),
            parallelism: UInt32(try int(kdf, "parallelism"))
        )
        let derived = keyCheck(keyCheckKey: hkdf(master, "commitnote v1 key check key"))
        #expect(derived == (try string(config, "keyCheck")), "sample notes repo key check")
    }
}
