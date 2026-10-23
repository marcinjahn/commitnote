import CommitnoteCrypto
import Foundation
import JavaScriptCore
import NativeCoreAPI
import Security
import os

struct HostArguments {
    let values: [JSValue]

    subscript(index: Int) -> JSValue? {
        index < values.count ? values[index] : nil
    }
}

/// Builds the JavaScript `host` object. Every method, including the callbacks of the JS functions
/// it creates, runs on `queue`; only Argon2id, storage, HTTP and image codec work leave it, and their results
/// come back to it before touching JavaScript.
final class HostServicesObject {
    private static let maxRandomBytes = 65_536
    private static let maxHkdfBytes = 255 * 32
    private static let maxTimerDelayMs = 2_147_483_647.0
    private static let maxImageDimension = 16_383

    let context: JSContext
    private let queue: DispatchQueue
    private let storageQueue = DispatchQueue(label: "io.github.marcinjahn.commitnote.core-runtime.storage")
    private let configuration: CoreRuntimeConfiguration
    private let logger: Logger
    private let onPost: (String) -> Void
    private let keyStore = KeyStore()
    private let stagedInputs: HandleStore<StagedInput>
    private let decodedImages = HandleStore<DecodedImage>()
    private var timers: [Int: DispatchWorkItem] = [:]
    private var nextTimerId = 1
    private var stopped = false

    init(
        context: JSContext,
        queue: DispatchQueue,
        configuration: CoreRuntimeConfiguration,
        stagedInputs: HandleStore<StagedInput>,
        logger: Logger,
        onPost: @escaping (String) -> Void
    ) {
        self.context = context
        self.queue = queue
        self.configuration = configuration
        self.stagedInputs = stagedInputs
        self.logger = logger
        self.onPost = onPost
    }

    func stop() {
        stopped = true
        for timer in timers.values {
            timer.cancel()
        }
        timers.removeAll()
        keyStore.removeAll()
        decodedImages.close()
    }

    func makeObject() -> JSValue {
        let crypto = JSBridge.newObject(
            in: context,
            [
                ("importKey", function { try $0.importKey($1) }),
                ("aesGcmEncrypt", function { try $0.aesGcmEncrypt($1) }),
                ("aesGcmDecrypt", function { try $0.aesGcmDecrypt($1) }),
                ("hkdfSha256", function { try $0.hkdfSha256($1) }),
                ("hmacSha256", function { try $0.hmacSha256($1) }),
                ("digest", function { try $0.digest($1) }),
                ("argon2id", function { try $0.argon2id($1) }),
            ])
        let random = JSBridge.newObject(
            in: context,
            [("randomBytes", function { try $0.randomBytes($1) })])
        let http = JSBridge.newObject(
            in: context,
            [("request", function { try $0.httpRequest($1) })])
        let clock = JSBridge.newObject(
            in: context,
            [
                ("now", function { host, _ in host.now() }),
                ("setTimeout", function { try $0.setTimeout($1) }),
                ("clearTimeout", function { $0.clearTimeout($1) }),
            ])
        let rememberedSession = JSBridge.newObject(
            in: context,
            [
                ("save", function { try $0.saveRememberedSession($1) }),
                ("load", function { host, _ in try host.loadRememberedSession() }),
                ("clear", function { host, _ in try host.clearRememberedSession() }),
            ])
        let blobCache = JSBridge.newObject(
            in: context,
            [
                ("get", function { try $0.blobGet($1) }),
                ("put", function { try $0.blobPut($1) }),
                ("touch", function { try $0.blobTouch($1) }),
                ("delete", function { try $0.blobDelete($1) }),
                ("list", function { try $0.blobList($1) }),
                ("listRepos", function { host, _ in try host.blobListRepos() }),
                ("deleteRepo", function { try $0.blobDeleteRepo($1) }),
            ])
        let deviceSettings = JSBridge.newObject(
            in: context,
            [
                ("getItem", function { try $0.settingsGetItem($1) }),
                ("setItem", function { try $0.settingsSetItem($1) }),
                ("removeItem", function { try $0.settingsRemoveItem($1) }),
            ])
        let log = JSBridge.newObject(
            in: context,
            [("log", function { try $0.log($1) })])
        let stagedInputs = JSBridge.newObject(
            in: context,
            [("take", function { try $0.takeStagedInput($1) })])
        let imageCodec = JSBridge.newObject(
            in: context,
            [
                ("decode", function { try $0.decodeImage($1) }),
                ("encodeWebp", function { try $0.encodeWebp($1) }),
                ("release", function { try $0.releaseImage($1) }),
            ])

        return JSBridge.newObject(
            in: context,
            [
                ("crypto", crypto),
                ("random", random),
                ("http", http),
                ("clock", clock),
                ("rememberedSession", rememberedSession),
                ("blobCache", blobCache),
                ("deviceSettings", deviceSettings),
                ("log", log),
                ("stagedInputs", stagedInputs),
                ("imageCodec", imageCodec),
                ("post", function { try $0.post($1) }),
            ])
    }

    // MARK: - Function plumbing

    /// The body receives the host object as a parameter so the JS function never retains it.
    private func function(
        _ body: @escaping (HostServicesObject, HostArguments) throws -> JSValue
    ) -> JSValue {
        let block: @convention(block) () -> JSValue = { [weak self] in
            let context: JSContext = JSContext.current()
            guard let self, !self.stopped else {
                context.exception = JSBridge.error("The core runtime has stopped", in: context)
                return JSValue(undefinedIn: context)
            }
            let arguments = HostArguments(values: (JSContext.currentArguments() as? [JSValue]) ?? [])
            do {
                return try body(self, arguments)
            } catch {
                context.exception = JSBridge.error(
                    Self.describe(error, fallback: "Host operation failed"), in: context)
                return JSValue(undefinedIn: context)
            }
        }
        return JSValue(object: unsafeBitCast(block, to: AnyObject.self), in: context)
    }

    private static func describe(_ error: Error, fallback: String) -> String {
        switch error {
        case let error as HostCallError: error.message
        case CommitnoteCryptoError.invalidKeyLength: "Invalid key length"
        case CommitnoteCryptoError.invalidNonce: "AES-GCM IV must be 12 bytes"
        case CommitnoteCryptoError.argon2(let code): "Argon2id failed with code \(code)"
        default: fallback
        }
    }

    private func promise<T>(
        failure: String,
        _ start: (@escaping (Result<T, Error>) -> Void) -> Void,
        resolve: @escaping (HostServicesObject, T) throws -> JSValue
    ) throws -> JSValue {
        let deferred = try JSBridge.deferred(in: context)
        let queue = self.queue
        start { [weak self] result in
            queue.async { [weak self] in
                guard let self, !self.stopped else { return }
                do {
                    let value = try resolve(self, result.get())
                    deferred.resolve.call(withArguments: [value])
                } catch {
                    deferred.reject.call(withArguments: [
                        JSBridge.error(Self.describe(error, fallback: failure), in: self.context)
                    ])
                }
            }
        }
        return deferred.promise
    }

    private func onStorageQueue<T>(
        failure: String,
        _ work: @escaping () throws -> T,
        resolve: @escaping (HostServicesObject, T) throws -> JSValue
    ) throws -> JSValue {
        let storageQueue = self.storageQueue
        return try promise(
            failure: failure,
            { complete in storageQueue.async { complete(Result { try work() }) } },
            resolve: resolve)
    }

    func flushBlobCache() async throws {
        let storage = configuration.blobCache
        let storageQueue = self.storageQueue
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            storageQueue.async { continuation.resume(with: Result { try storage.flush() }) }
        }
    }

    private func undefined() -> JSValue {
        JSValue(undefinedIn: context)
    }

    private func null() -> JSValue {
        JSValue(nullIn: context)
    }

    private func string(_ value: String) -> JSValue {
        JSValue(object: value, in: context)
    }

    private func isAbsent(_ value: JSValue?) -> Bool {
        guard let value else { return true }
        return value.isNull || value.isUndefined
    }

    // MARK: - crypto

    private func importKey(_ arguments: HostArguments) throws -> JSValue {
        let raw = try JSBridge.data(arguments[0])
        guard let algorithm = HostKeyAlgorithm(rawValue: try JSBridge.string(arguments[1])) else {
            throw HostCallError("Unsupported key algorithm")
        }
        if algorithm == .aesGcm && raw.count != 32 {
            throw HostCallError("AES key must be 256 bits")
        }
        return string(keyStore.importKey(raw, algorithm: algorithm))
    }

    private func aesGcmEncrypt(_ arguments: HostArguments) throws -> JSValue {
        let key = try keyStore.raw(JSBridge.string(arguments[0]), for: .aesGcm)
        let sealed = try AESGCM.seal(
            key: key,
            iv: JSBridge.data(arguments[1]),
            additionalData: JSBridge.data(arguments[2]),
            plaintext: JSBridge.data(arguments[3]))
        return try JSBridge.uint8Array(sealed, in: context)
    }

    private func aesGcmDecrypt(_ arguments: HostArguments) throws -> JSValue {
        let key = try keyStore.raw(JSBridge.string(arguments[0]), for: .aesGcm)
        let iv = try JSBridge.data(arguments[1])
        let additionalData = try JSBridge.data(arguments[2])
        let sealed = try JSBridge.data(arguments[3])
        do {
            let plaintext = try AESGCM.open(key: key, iv: iv, additionalData: additionalData, sealed: sealed)
            return try JSBridge.uint8Array(plaintext, in: context)
        } catch CommitnoteCryptoError.authenticationFailed {
            return null()
        }
    }

    private func hkdfSha256(_ arguments: HostArguments) throws -> JSValue {
        let key = try keyStore.raw(JSBridge.string(arguments[0]), for: .hkdf)
        let derived = HKDFSHA256.derive(
            ikm: key,
            salt: try JSBridge.data(arguments[1]),
            info: try JSBridge.data(arguments[2]),
            outputByteCount: try JSBridge.integer(arguments[3], in: 1...Self.maxHkdfBytes))
        return try JSBridge.uint8Array(derived, in: context)
    }

    private func hmacSha256(_ arguments: HostArguments) throws -> JSValue {
        let key = try keyStore.raw(JSBridge.string(arguments[0]), for: .hmacSha256)
        let mac = HMACSHA256.mac(key: key, data: try JSBridge.data(arguments[1]))
        return try JSBridge.uint8Array(mac, in: context)
    }

    private func digest(_ arguments: HostArguments) throws -> JSValue {
        let algorithm = try JSBridge.string(arguments[0])
        let data = try JSBridge.data(arguments[1])
        switch algorithm {
        case "SHA-1": return try JSBridge.uint8Array(Digest.sha1(data), in: context)
        case "SHA-256": return try JSBridge.uint8Array(Digest.sha256(data), in: context)
        default: throw HostCallError("Unsupported digest algorithm")
        }
    }

    private func argon2id(_ arguments: HostArguments) throws -> JSValue {
        let input = try JSBridge.object(arguments[0])
        let password = try JSBridge.data(input.forProperty("password"))
        let salt = try JSBridge.data(input.forProperty("salt"))
        let memoryKiB = try JSBridge.integer(input.forProperty("memoryKiB"), in: 8...Int(UInt32.max))
        let iterations = try JSBridge.integer(input.forProperty("iterations"), in: 1...Int(UInt32.max))
        let parallelism = try JSBridge.integer(input.forProperty("parallelism"), in: 1...0xFF_FFFF)
        let hashLength = try JSBridge.integer(input.forProperty("hashLength"), in: 4...1024)
        return try promise(
            failure: "Argon2id failed",
            { complete in
                DispatchQueue.global(qos: .userInitiated).async {
                    complete(
                        Result {
                            try Argon2id.hash(
                                password: password,
                                salt: salt,
                                memoryKiB: UInt32(memoryKiB),
                                iterations: UInt32(iterations),
                                parallelism: UInt32(parallelism),
                                hashLength: hashLength)
                        })
                }
            },
            resolve: { host, hash in try JSBridge.uint8Array(hash, in: host.context) })
    }

    // MARK: - random

    private func randomBytes(_ arguments: HostArguments) throws -> JSValue {
        let length = try JSBridge.integer(arguments[0], in: 0...Self.maxRandomBytes)
        var bytes = Data(count: length)
        if length > 0 {
            let status = bytes.withUnsafeMutableBytes { buffer in
                SecRandomCopyBytes(kSecRandomDefault, length, buffer.baseAddress!)
            }
            guard status == errSecSuccess else { throw HostCallError("Random bytes unavailable") }
        }
        return try JSBridge.uint8Array(bytes, in: context)
    }

    // MARK: - http

    private func httpRequest(_ arguments: HostArguments) throws -> JSValue {
        let request = try JSBridge.object(arguments[0])
        let method = try JSBridge.string(request.forProperty("method"))
        guard let url = URL(string: try JSBridge.string(request.forProperty("url"))) else {
            throw HostCallError("Invalid request URL")
        }
        let headers = try stringRecord(request.forProperty("headers"))
        let bodyValue = request.forProperty("body")
        let body = isAbsent(bodyValue) ? nil : try JSBridge.data(bodyValue)
        let hostRequest = HostHTTPRequest(method: method, url: url, headers: headers, body: body)
        let client = configuration.http
        return try promise(
            failure: "Network request failed",
            { complete in
                Task {
                    do {
                        complete(.success(try await client.send(hostRequest)))
                    } catch {
                        complete(.failure(HostCallError("Network request failed")))
                    }
                }
            },
            resolve: { host, response in
                let headers = Dictionary(
                    response.headers.map { ($0.key.lowercased(), $0.value) },
                    uniquingKeysWith: { first, second in "\(first), \(second)" })
                return JSBridge.newObject(
                    in: host.context,
                    [
                        ("status", response.status),
                        ("headers", JSValue(object: headers, in: host.context) as Any),
                        ("body", try JSBridge.uint8Array(response.body, in: host.context)),
                    ])
            })
    }

    private func stringRecord(_ value: JSValue?) throws -> [String: String] {
        let object = try JSBridge.object(value)
        var record: [String: String] = [:]
        for (key, element) in object.toDictionary() ?? [:] {
            guard let key = key as? String, let element = element as? String else {
                throw HostCallError("Expected string headers")
            }
            record[key] = element
        }
        return record
    }

    // MARK: - clock

    private func now() -> JSValue {
        JSValue(double: Date().timeIntervalSince1970 * 1000, in: context)
    }

    private func setTimeout(_ arguments: HostArguments) throws -> JSValue {
        guard let callback = arguments[0], callback.isObject else {
            throw HostCallError("The callback must be a function")
        }
        let requested = arguments[1].map { $0.isNumber ? $0.toDouble() : 0 } ?? 0
        let delayMs = requested.isFinite ? min(max(requested, 0), Self.maxTimerDelayMs) : 0
        let id = nextTimerId
        nextTimerId += 1
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.stopped, self.timers.removeValue(forKey: id) != nil else { return }
            callback.call(withArguments: [])
        }
        timers[id] = item
        queue.asyncAfter(deadline: .now() + .microseconds(Int(delayMs * 1000)), execute: item)
        return JSValue(double: Double(id), in: context)
    }

    private func clearTimeout(_ arguments: HostArguments) -> JSValue {
        if let value = arguments[0], value.isNumber, let id = Int(exactly: value.toDouble()) {
            timers.removeValue(forKey: id)?.cancel()
        }
        return undefined()
    }

    // MARK: - rememberedSession

    private func saveRememberedSession(_ arguments: HostArguments) throws -> JSValue {
        let record = try JSBridge.object(arguments[0])
        let coordinates = try JSBridge.object(record.forProperty("coordinates"))
        guard let forge = ForgeID(rawValue: try JSBridge.string(coordinates.forProperty("forge"))) else {
            throw HostCallError("Unknown forge")
        }
        let keys = try JSBridge.object(record.forProperty("keys"))
        func raw(_ name: String, _ algorithm: HostKeyAlgorithm) throws -> Data {
            try keyStore.raw(JSBridge.string(keys.forProperty(name)), for: algorithm)
        }
        let material = RememberedSessionMaterial(
            repoUrl: try JSBridge.string(record.forProperty("repoUrl")),
            coordinates: .init(
                forge: forge,
                owner: try JSBridge.string(coordinates.forProperty("owner")),
                repo: try JSBridge.string(coordinates.forProperty("repo"))),
            accessToken: try JSBridge.string(record.forProperty("accessToken")),
            keys: .init(
                contentKey: try raw("contentKey", .aesGcm),
                nameKey: try raw("nameKey", .aesGcm),
                nameIvKey: try raw("nameIvKey", .hmacSha256),
                keyCheckKey: try raw("keyCheckKey", .hmacSha256)))
        let storage = configuration.rememberedSession
        return try onStorageQueue(
            failure: "Could not save the remembered session",
            { try storage.save(material) },
            resolve: { host, _ in host.undefined() })
    }

    private func loadRememberedSession() throws -> JSValue {
        let storage = configuration.rememberedSession
        return try onStorageQueue(
            failure: "Could not load the remembered session",
            { try storage.load() },
            resolve: { host, material in
                guard let material else { return host.null() }
                let context = host.context
                let store = host.keyStore
                let keys = JSBridge.newObject(
                    in: context,
                    [
                        ("contentKey", store.importKey(material.keys.contentKey, algorithm: .aesGcm)),
                        ("nameKey", store.importKey(material.keys.nameKey, algorithm: .aesGcm)),
                        ("nameIvKey", store.importKey(material.keys.nameIvKey, algorithm: .hmacSha256)),
                        ("keyCheckKey", store.importKey(material.keys.keyCheckKey, algorithm: .hmacSha256)),
                    ])
                let coordinates = JSBridge.newObject(
                    in: context,
                    [
                        ("forge", material.coordinates.forge.rawValue),
                        ("owner", material.coordinates.owner),
                        ("repo", material.coordinates.repo),
                    ])
                return JSBridge.newObject(
                    in: context,
                    [
                        ("repoUrl", material.repoUrl),
                        ("coordinates", coordinates),
                        ("accessToken", material.accessToken),
                        ("keys", keys),
                    ])
            })
    }

    private func clearRememberedSession() throws -> JSValue {
        let storage = configuration.rememberedSession
        return try onStorageQueue(
            failure: "Could not clear the remembered session",
            { try storage.clear() },
            resolve: { host, _ in host.undefined() })
    }

    // MARK: - blobCache

    private func blobGet(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let blobSha = try JSBridge.string(arguments[1])
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache read failed",
            { try storage.get(repoKey: repoKey, blobSha: blobSha) },
            resolve: { host, entry in
                guard let entry else { return host.null() }
                return JSBridge.newObject(
                    in: host.context,
                    [
                        ("bytes", try JSBridge.uint8Array(entry.bytes, in: host.context)),
                        ("text", JSValue(bool: entry.text, in: host.context) as Any),
                        ("lastUsedAt", entry.lastUsedAt),
                    ])
            })
    }

    private func blobPut(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let blobSha = try JSBridge.string(arguments[1])
        let entryValue = try JSBridge.object(arguments[2])
        let entry = BlobCacheEntry(
            bytes: try JSBridge.data(entryValue.forProperty("bytes")),
            text: try JSBridge.bool(entryValue.forProperty("text")),
            lastUsedAt: try JSBridge.number(entryValue.forProperty("lastUsedAt")))
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache write failed",
            { try storage.put(repoKey: repoKey, blobSha: blobSha, entry: entry) },
            resolve: { host, _ in host.undefined() })
    }

    private func blobTouch(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let blobSha = try JSBridge.string(arguments[1])
        let lastUsedAt = try JSBridge.number(arguments[2])
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache write failed",
            { try storage.touch(repoKey: repoKey, blobSha: blobSha, lastUsedAt: lastUsedAt) },
            resolve: { host, _ in host.undefined() })
    }

    private func blobDelete(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let blobSha = try JSBridge.string(arguments[1])
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache write failed",
            { try storage.delete(repoKey: repoKey, blobSha: blobSha) },
            resolve: { host, _ in host.undefined() })
    }

    private func blobList(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache read failed",
            { try storage.list(repoKey: repoKey) },
            resolve: { host, listings in
                JSBridge.newArray(
                    in: host.context,
                    listings.map { listing in
                        JSBridge.newObject(
                            in: host.context,
                            [
                                ("blobSha", listing.blobSha),
                                ("size", listing.size),
                                ("lastUsedAt", listing.lastUsedAt),
                            ])
                    })
            })
    }

    private func blobListRepos() throws -> JSValue {
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache read failed",
            { try storage.listRepos() },
            resolve: { host, repos in JSBridge.newArray(in: host.context, repos.map(host.string)) })
    }

    private func blobDeleteRepo(_ arguments: HostArguments) throws -> JSValue {
        let repoKey = try JSBridge.string(arguments[0])
        let storage = configuration.blobCache
        return try onStorageQueue(
            failure: "Blob cache write failed",
            { try storage.deleteRepo(repoKey: repoKey) },
            resolve: { host, _ in host.undefined() })
    }

    // MARK: - deviceSettings

    private func settingsGetItem(_ arguments: HostArguments) throws -> JSValue {
        let key = try JSBridge.string(arguments[0])
        return configuration.deviceSettings.getItem(key).map(string) ?? null()
    }

    private func settingsSetItem(_ arguments: HostArguments) throws -> JSValue {
        configuration.deviceSettings.setItem(try JSBridge.string(arguments[0]), try JSBridge.string(arguments[1]))
        return undefined()
    }

    private func settingsRemoveItem(_ arguments: HostArguments) throws -> JSValue {
        configuration.deviceSettings.removeItem(try JSBridge.string(arguments[0]))
        return undefined()
    }

    // MARK: - stagedInputs

    private func takeStagedInput(_ arguments: HostArguments) throws -> JSValue {
        guard let input = stagedInputs.remove(try JSBridge.string(arguments[0])) else { return null() }
        return JSBridge.newObject(
            in: context,
            [
                ("bytes", try JSBridge.uint8Array(input.data, in: context)),
                ("type", input.type),
            ])
    }

    private func decodeImage(_ arguments: HostArguments) throws -> JSValue {
        let data = try JSBridge.data(arguments[0])
        let codec = configuration.imageCodec
        return try promise(
            failure: "Could not decode the image",
            { complete in
                DispatchQueue.global(qos: .userInitiated).async {
                    complete(Result { try codec.decode(data) })
                }
            },
            resolve: { host, image in
                JSBridge.newObject(
                    in: host.context,
                    [
                        ("handle", host.decodedImages.insert(image)),
                        ("width", image.width),
                        ("height", image.height),
                    ])
            })
    }

    private func encodeWebp(_ arguments: HostArguments) throws -> JSValue {
        let handle = try JSBridge.string(arguments[0])
        let width = try JSBridge.integer(arguments[1], in: 1...Self.maxImageDimension)
        let height = try JSBridge.integer(arguments[2], in: 1...Self.maxImageDimension)
        let quality = try JSBridge.number(arguments[3])
        let image = decodedImages.value(handle)
        let codec = configuration.imageCodec
        return try promise(
            failure: "Could not encode the image",
            { complete in
                guard let image else {
                    complete(.failure(HostCallError("Unknown image handle")))
                    return
                }
                DispatchQueue.global(qos: .userInitiated).async {
                    complete(
                        Result {
                            try codec.encodeWebP(image, width: width, height: height, quality: quality)
                        })
                }
            },
            resolve: { host, bytes in try JSBridge.uint8Array(bytes, in: host.context) })
    }

    private func releaseImage(_ arguments: HostArguments) throws -> JSValue {
        decodedImages.remove(try JSBridge.string(arguments[0]))
        return undefined()
    }

    // MARK: - log and post

    private func log(_ arguments: HostArguments) throws -> JSValue {
        let level = try JSBridge.string(arguments[0])
        let message = try JSBridge.string(arguments[1])
        switch level {
        case "debug": logger.debug("\(message, privacy: .private)")
        case "info": logger.info("\(message, privacy: .private)")
        case "warn": logger.warning("\(message, privacy: .private)")
        default: logger.error("\(message, privacy: .private)")
        }
        return undefined()
    }

    private func post(_ arguments: HostArguments) throws -> JSValue {
        onPost(try JSBridge.string(arguments[0]))
        return undefined()
    }
}
