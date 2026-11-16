// Node vocabulary of lezer-markdown with the GFM, subscript, superscript and emoji extensions,
// so the scanner consumes text exactly as the web editor does even where no style applies.
enum NodeType: Equatable {
    case document
    case codeBlock
    case fencedCode
    case blockquote
    case horizontalRule
    case bulletList
    case orderedList
    case listItem
    case atxHeading(Int)
    case setextHeading(Int)
    case htmlBlock
    case linkReference
    case paragraph
    case commentBlock
    case processingInstructionBlock
    case escape
    case entity
    case hardBreak
    case emphasis
    case strongEmphasis
    case link
    case image
    case inlineCode
    case htmlTag
    case comment
    case processingInstruction
    case autolink
    case headerMark
    case quoteMark
    case listMark
    case linkMark
    case emphasisMark
    case codeMark
    case codeText
    case codeInfo
    case linkTitle
    case linkLabel
    case url
    case table
    case tableHeader
    case tableRow
    case tableCell
    case tableDelimiter
    case task
    case taskMarker
    case strikethrough
    case strikethroughMark
    case subscriptText
    case subscriptMark
    case superscript
    case superscriptMark
    case emoji
    /// The label between the brackets of an inline link or image.
    case linkText
    /// A bracketed span without an inline destination, kept as plain text.
    case plainLink
}

struct Node {
    var type: NodeType
    var from: Int
    var to: Int
    var children: [Node] = []

    init(_ type: NodeType, _ from: Int, _ to: Int, _ children: [Node] = []) {
        self.type = type
        self.from = from
        self.to = to
        self.children = children
    }
}

enum Ch {
    static let tab = 9
    static let newline = 10
    static let space = 32
    static let bang = 33
    static let doubleQuote = 34
    static let hash = 35
    static let ampersand = 38
    static let singleQuote = 39
    static let openParen = 40
    static let closeParen = 41
    static let asterisk = 42
    static let plus = 43
    static let dash = 45
    static let dot = 46
    static let slash = 47
    static let colon = 58
    static let semicolon = 59
    static let lessThan = 60
    static let equals = 61
    static let greaterThan = 62
    static let question = 63
    static let at = 64
    static let openBracket = 91
    static let backslash = 92
    static let closeBracket = 93
    static let caret = 94
    static let underscore = 95
    static let backtick = 96
    static let pipe = 124
    static let tilde = 126
}

extension Array where Element == UInt16 {
    @inline(__always)
    func code(_ index: Int) -> Int {
        index >= 0 && index < count ? Int(self[index]) : -1
    }

    func slice(_ from: Int, _ to: Int) -> [UInt16] {
        let lower = Swift.max(0, from)
        let upper = Swift.min(count, to)
        return lower < upper ? Array(self[lower..<upper]) : []
    }

    func hasPrefix(_ ascii: String, at index: Int, caseInsensitive: Bool = false) -> Bool {
        var position = index
        for unit in ascii.utf16 {
            let actual = code(position)
            if caseInsensitive ? lowerASCII(actual) != lowerASCII(Int(unit)) : actual != Int(unit) {
                return false
            }
            position += 1
        }
        return true
    }

    func contains(_ ascii: String, caseInsensitive: Bool = false) -> Bool {
        let needle = Array(ascii.utf16)
        guard needle.count <= count else { return false }
        for start in 0...(count - needle.count) where hasPrefix(ascii, at: start, caseInsensitive: caseInsensitive) {
            return true
        }
        return false
    }
}

/// Markdown whitespace: space, tab, line feed and carriage return.
@inline(__always)
func isSpace(_ c: Int) -> Bool {
    c == 32 || c == 9 || c == 10 || c == 13
}

/// JavaScript's `\s`.
func isWhitespace(_ c: Int) -> Bool {
    switch c {
    case 9...13, 32, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
        true
    default:
        false
    }
}

/// JavaScript's ASCII `\w`.
@inline(__always)
func isWordChar(_ c: Int) -> Bool {
    (48...57).contains(c) || (65...90).contains(c) || (97...122).contains(c) || c == 95
}

@inline(__always)
func isDigit(_ c: Int) -> Bool {
    (48...57).contains(c)
}

@inline(__always)
func isAlpha(_ c: Int) -> Bool {
    (65...90).contains(c) || (97...122).contains(c)
}

@inline(__always)
func isAlphanumeric(_ c: Int) -> Bool {
    isAlpha(c) || isDigit(c)
}

@inline(__always)
func lowerASCII(_ c: Int) -> Int {
    (65...90).contains(c) ? c + 32 : c
}

/// Unicode punctuation or symbol (`[\p{S}\p{P}]`) for a single UTF-16 unit.
func isPunctuation(_ c: Int) -> Bool {
    if c < 0 { return false }
    if c < 128 {
        return (33...47).contains(c) || (58...64).contains(c) || (91...96).contains(c) || (123...126).contains(c)
    }
    guard let scalar = Unicode.Scalar(UInt32(c)) else { return false }
    switch scalar.properties.generalCategory {
    case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation,
        .initialPunctuation, .finalPunctuation, .otherPunctuation,
        .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol:
        return true
    default:
        return false
    }
}

func skipSpace(_ text: [UInt16], _ from: Int) -> Int {
    var i = from
    while i < text.count, isSpace(Int(text[i])) { i += 1 }
    return i
}
