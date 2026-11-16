public struct KeyModifiers: OptionSet, Sendable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public static let command = KeyModifiers(rawValue: 1 << 0)
    public static let control = KeyModifiers(rawValue: 1 << 1)
    public static let option = KeyModifiers(rawValue: 1 << 2)
    public static let shift = KeyModifiers(rawValue: 1 << 3)
}

public struct TypeToStartContext: Equatable, Sendable {
    public var enabled: Bool
    public var treeLoaded: Bool
    public var editorOpen: Bool
    public var placeholderVisible: Bool
    public var modalPresented: Bool
    public var searchActive: Bool
    public var textInputFocused: Bool

    public init(
        enabled: Bool,
        treeLoaded: Bool,
        editorOpen: Bool,
        placeholderVisible: Bool,
        modalPresented: Bool,
        searchActive: Bool,
        textInputFocused: Bool
    ) {
        self.enabled = enabled
        self.treeLoaded = treeLoaded
        self.editorOpen = editorOpen
        self.placeholderVisible = placeholderVisible
        self.modalPresented = modalPresented
        self.searchActive = searchActive
        self.textInputFocused = textInputFocused
    }
}

public enum TypeToStart {
    public static func shouldStart(
        characters: String,
        modifiers: KeyModifiers,
        isRepeat: Bool,
        context: TypeToStartContext
    ) -> Bool {
        guard context.enabled, context.treeLoaded, !context.editorOpen,
            context.placeholderVisible, !context.modalPresented, !context.searchActive,
            !context.textInputFocused, !isRepeat,
            modifiers.isDisjoint(with: [.command, .control, .option])
        else { return false }
        let scalars = characters.unicodeScalars
        guard scalars.count == 1, let scalar = scalars.first else { return false }
        if scalar.properties.isWhitespace { return false }
        if scalar.properties.generalCategory == .control { return false }
        if (0xF700...0xF8FF).contains(scalar.value) { return false }
        return true
    }
}

public enum TypeToStartInput: Equatable, Sendable {
    case text(String)
    case enter
    case backspace
    case other
}

public struct TypeToStartBuffer: Equatable, Sendable {
    public private(set) var text: String = ""

    public init() {}

    public mutating func append(_ input: TypeToStartInput) {
        switch input {
        case .text(let value): text += value
        case .enter: text += "\n"
        case .backspace: if !text.isEmpty { text.removeLast() }
        case .other: break
        }
    }

    public mutating func drain() -> String {
        defer { text = "" }
        return text
    }
}
