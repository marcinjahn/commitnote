import CArgon2
import Crypto
import Foundation

public enum CommitnoteCryptoError: Error, Equatable {
    case invalidKeyLength
    case invalidNonce
    case authenticationFailed
    case argon2(code: Int32)
}

public enum AESGCM {
    private static let keyLength = 32
    private static let ivLength = 12
    private static let tagLength = 16

    public static func seal(key: Data, iv: Data, additionalData: Data, plaintext: Data) throws -> Data {
        guard key.count == keyLength else { throw CommitnoteCryptoError.invalidKeyLength }
        guard iv.count == ivLength else { throw CommitnoteCryptoError.invalidNonce }
        let nonce: AES.GCM.Nonce
        do { nonce = try AES.GCM.Nonce(data: iv) } catch { throw CommitnoteCryptoError.invalidNonce }
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce, authenticating: additionalData)
        return box.ciphertext + box.tag
    }

    public static func open(key: Data, iv: Data, additionalData: Data, sealed: Data) throws -> Data {
        guard key.count == keyLength else { throw CommitnoteCryptoError.invalidKeyLength }
        guard iv.count == ivLength else { throw CommitnoteCryptoError.invalidNonce }
        guard sealed.count >= tagLength else { throw CommitnoteCryptoError.authenticationFailed }
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let ciphertext = sealed.prefix(sealed.count - tagLength)
            let tag = sealed.suffix(tagLength)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: additionalData)
        } catch {
            throw CommitnoteCryptoError.authenticationFailed
        }
    }
}

public enum HKDFSHA256 {
    public static func derive(ikm: Data, salt: Data, info: Data, outputByteCount: Int) -> Data {
        let key = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: ikm),
            salt: salt,
            info: info,
            outputByteCount: outputByteCount
        )
        return key.withUnsafeBytes { Data($0) }
    }
}

public enum HMACSHA256 {
    public static func mac(key: Data, data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
    }
}

public enum Digest {
    public static func sha1(_ data: Data) -> Data {
        Data(Insecure.SHA1.hash(data: data))
    }

    public static func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }
}

public enum Argon2id {
    public static func hash(
        password: Data,
        salt: Data,
        memoryKiB: UInt32,
        iterations: UInt32,
        parallelism: UInt32,
        hashLength: Int = 32
    ) throws -> Data {
        var output = [UInt8](repeating: 0, count: hashLength)
        let code = password.withUnsafeBytes { pwd in
            salt.withUnsafeBytes { saltBytes in
                output.withUnsafeMutableBytes { out in
                    argon2id_hash_raw(
                        iterations,
                        memoryKiB,
                        parallelism,
                        pwd.baseAddress,
                        pwd.count,
                        saltBytes.baseAddress,
                        saltBytes.count,
                        out.baseAddress,
                        out.count
                    )
                }
            }
        }
        guard code == ARGON2_OK.rawValue else { throw CommitnoteCryptoError.argon2(code: code) }
        return Data(output)
    }
}
