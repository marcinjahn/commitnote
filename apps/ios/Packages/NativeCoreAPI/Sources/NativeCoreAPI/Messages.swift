import Foundation

public struct CoreRequest<Command: NativeCoreCommand>: Encodable, Sendable {
    public var id: Int
    public var command: String
    public var params: Command

    public init(id: Int, command: Command) {
        self.id = id
        self.command = Command.name
        self.params = command
    }

    public func jsonString() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

public enum CoreMessage: Decodable, Sendable {
    case response(id: Int, result: Result<JSONValue, CoreError>)
    case event(CoreEvent)

    private enum CodingKeys: String, CodingKey {
        case kind, id, ok, result, error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "response":
            let id = try container.decode(Int.self, forKey: .id)
            if try container.decode(Bool.self, forKey: .ok) {
                let result = try container.decodeIfPresent(JSONValue.self, forKey: .result)
                self = .response(id: id, result: .success(result ?? .object([:])))
            } else {
                self = .response(
                    id: id, result: .failure(try container.decode(CoreError.self, forKey: .error)))
            }
        case "event":
            self = .event(try CoreEvent(from: decoder))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown message kind \(other)")
        }
    }

    public static func decode(_ text: String) throws -> CoreMessage {
        try JSONDecoder().decode(CoreMessage.self, from: Data(text.utf8))
    }
}

public func decodeResult<C: NativeCoreCommand>(_ type: C.Type, from value: JSONValue) throws
    -> C.Result
{
    try JSONDecoder().decode(C.Result.self, from: JSONEncoder().encode(value))
}
