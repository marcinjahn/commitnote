import Foundation

enum HostKeyAlgorithm: String {
    case aesGcm = "AES-GCM"
    case hmacSha256 = "HMAC-SHA-256"
    case hkdf = "HKDF"
}

struct StoredKey {
    let raw: Data
    let algorithm: HostKeyAlgorithm
}

/// Confined to the core runtime's queue.
final class KeyStore {
    private var keys: [String: StoredKey] = [:]
    private var nextId = 1

    func importKey(_ raw: Data, algorithm: HostKeyAlgorithm) -> String {
        let handle = "k\(nextId)"
        nextId += 1
        keys[handle] = StoredKey(raw: Data(raw), algorithm: algorithm)
        return handle
    }

    func key(_ handle: String) throws -> StoredKey {
        guard let key = keys[handle] else { throw HostCallError("Unknown key handle") }
        return key
    }

    func raw(_ handle: String, for algorithm: HostKeyAlgorithm) throws -> Data {
        let key = try key(handle)
        guard key.algorithm == algorithm else {
            throw HostCallError("Unknown \(algorithm.rawValue) key handle")
        }
        return key.raw
    }

    func removeAll() {
        keys.removeAll()
    }
}
