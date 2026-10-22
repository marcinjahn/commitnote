// Hand-written equivalents of the regular expressions lezer-markdown uses.

/// `(?:#\d+|#x[a-f\d]+|\w+);` at `start`; returns the match length.
func entityLength(_ text: [UInt16], _ start: Int, hexCaseInsensitive: Bool) -> Int? {
    if text.code(start) == Ch.hash {
        var i = start + 1
        while isDigit(text.code(i)) { i += 1 }
        if i > start + 1, text.code(i) == Ch.semicolon { return i + 1 - start }
        let x = text.code(start + 1)
        if x == 120 || (hexCaseInsensitive && x == 88) {
            i = start + 2
            while isHexDigit(text.code(i), caseInsensitive: hexCaseInsensitive) { i += 1 }
            if i > start + 2, text.code(i) == Ch.semicolon { return i + 1 - start }
        }
        return nil
    }
    var i = start
    while isWordChar(text.code(i)) { i += 1 }
    return i > start && text.code(i) == Ch.semicolon ? i + 1 - start : nil
}

private func isHexDigit(_ c: Int, caseInsensitive: Bool) -> Bool {
    isDigit(c) || (97...102).contains(c) || (caseInsensitive && (65...70).contains(c))
}

// MARK: GFM autolink literals

private func isHostChar(_ c: Int) -> Bool {
    isWordChar(c) || c == Ch.dash
}

/// `[\w.+-]{1,100}@` at `start`.
func isEmailPrefix(_ text: [UInt16], _ start: Int) -> Bool {
    var i = start
    while i - start <= 100, isEmailLocalChar(text.code(i)) { i += 1 }
    return i > start && i - start <= 100 && text.code(i) == Ch.at
}

private func isEmailLocalChar(_ c: Int) -> Bool {
    isWordChar(c) || c == Ch.dot || c == Ch.plus || c == Ch.dash
}

/// End of a `www.`/`http(s)://` autolink whose host starts at `from`, or -1.
func autolinkURLEnd(_ text: [UInt16], _ from: Int) -> Int {
    var i = from
    while isHostChar(text.code(i)) { i += 1 }
    if i == from { return -1 }
    var previousLabel = from..<i
    var lastLabel = from..<i
    var groups = 0
    while text.code(i) == Ch.dot, isHostChar(text.code(i + 1)) {
        let labelStart = i + 1
        i = labelStart
        while isHostChar(text.code(i)) { i += 1 }
        previousLabel = lastLabel
        lastLabel = labelStart..<i
        groups += 1
    }
    if groups == 0 { return -1 }
    for index in previousLabel.lowerBound..<lastLabel.upperBound where text.code(index) == Ch.underscore {
        return -1
    }
    if text.code(i) == Ch.colon, isDigit(text.code(i + 1)) {
        i += 1
        while isDigit(text.code(i)) { i += 1 }
    }
    if text.code(i) == Ch.slash {
        i += 1
        while i < text.count, !isWhitespace(text.code(i)), text.code(i) != Ch.lessThan { i += 1 }
    }
    var end = i
    while end > from {
        let last = text.code(end - 1)
        if [Ch.question, Ch.bang, Ch.dot, 44, Ch.colon, Ch.asterisk, Ch.underscore, Ch.tilde].contains(last) {
            end -= 1
        } else if last == Ch.closeParen, count(text, from, end, Ch.closeParen) > count(text, from, end, Ch.openParen) {
            end -= 1
        } else if last == Ch.semicolon, let entityStart = trailingEntityStart(text, from, end) {
            end = entityStart
        } else {
            break
        }
    }
    return end
}

private func count(_ text: [UInt16], _ from: Int, _ to: Int, _ ch: Int) -> Int {
    var result = 0
    for i in from..<to where Int(text[i]) == ch { result += 1 }
    return result
}

/// Start of `&(?:#\d+|#x[a-f\d]+|\w+);` ending exactly at `end`.
private func trailingEntityStart(_ text: [UInt16], _ from: Int, _ end: Int) -> Int? {
    var i = end - 2
    while i >= from, text.code(i) != Ch.ampersand { i -= 1 }
    guard i >= from, let length = entityLength(text, i + 1, hexCaseInsensitive: false), i + 1 + length == end else {
        return nil
    }
    return i
}

/// Length of `([^\[\]]|\[[^\]]*\])*` over `text[start..<end]`.
func bracketBalancedLength(_ text: [UInt16], _ start: Int, _ end: Int) -> Int {
    var i = start
    while i < end {
        let c = Int(text[i])
        if c == Ch.closeBracket { break }
        if c == Ch.openBracket {
            var j = i + 1
            while j < end, Int(text[j]) != Ch.closeBracket { j += 1 }
            if j >= end { break }
            i = j + 1
        } else {
            i += 1
        }
    }
    return i - start
}

/// End of `[\w.+-]+@[\w-]+(\.[\w.-]+)+` at `from` with lezer's trailing rules, or -1.
func autolinkEmailEnd(_ text: [UInt16], _ from: Int) -> Int {
    var i = from
    while isEmailLocalChar(text.code(i)) { i += 1 }
    if i == from || text.code(i) != Ch.at { return -1 }
    i += 1
    let domain = i
    while isHostChar(text.code(i)) { i += 1 }
    if i == domain || text.code(i) != Ch.dot { return -1 }
    i += 1
    let rest = i
    while isHostChar(text.code(i)) || text.code(i) == Ch.dot { i += 1 }
    if i == rest { return -1 }
    let last = text.code(i - 1)
    if last == Ch.underscore || last == Ch.dash { return -1 }
    return last == Ch.dot ? i - 1 : i
}

// MARK: Inline HTML

/// `<scheme:…>` or `<email>` after the `<` at `start`; returns the length including `>`.
func autolinkLength(_ text: [UInt16], _ start: Int) -> Int? {
    if isAlpha(text.code(start)) {
        var i = start + 1
        while isWordChar(text.code(i)) || [Ch.dash, Ch.plus, Ch.dot].contains(text.code(i)) { i += 1 }
        if i > start + 1, text.code(i) == Ch.colon {
            let body = i + 1
            i = body
            while i < text.count, !isWhitespace(text.code(i)), text.code(i) != Ch.greaterThan { i += 1 }
            if i > body, text.code(i) == Ch.greaterThan { return i + 1 - start }
        }
    }
    var i = start
    while isEmailAutolinkLocalChar(text.code(i)) { i += 1 }
    if i == start || text.code(i) != Ch.at { return nil }
    i += 1
    while true {
        let label = i
        while isAlphanumeric(text.code(i)) || text.code(i) == Ch.dash { i += 1 }
        let length = i - label
        if length == 0 || length > 63 || !isAlphanumeric(text.code(label)) || !isAlphanumeric(text.code(i - 1)) {
            return nil
        }
        if text.code(i) == Ch.dot {
            i += 1
            continue
        }
        return text.code(i) == Ch.greaterThan ? i + 1 - start : nil
    }
}

private let emailAutolinkLocalSymbols = Set(".!#$%&'*+/=?^_`{|}~-".utf16.map { Int($0) })

private func isEmailAutolinkLocalChar(_ c: Int) -> Bool {
    isAlphanumeric(c) || emailAutolinkLocalSymbols.contains(c)
}

/// `!--[^>](?:-[^-]|[^-])*?-->` after `<`.
func htmlCommentLength(_ text: [UInt16], _ start: Int) -> Int? {
    guard text.hasPrefix("!--", at: start), start + 3 < text.count, text.code(start + 3) != Ch.greaterThan else {
        return nil
    }
    var i = start + 4
    while i <= text.count {
        if text.hasPrefix("-->", at: i) { return i + 3 - start }
        if i >= text.count { return nil }
        if text.code(i) == Ch.dash {
            let following = text.code(i + 1)
            if following < 0 || following == Ch.dash { return nil }
            i += 2
        } else {
            i += 1
        }
    }
    return nil
}

/// `\?[^]*?\?>` after `<`.
func processingInstructionLength(_ text: [UInt16], _ start: Int) -> Int? {
    guard text.code(start) == Ch.question else { return nil }
    var i = start + 1
    while i + 1 < text.count {
        if text.code(i) == Ch.question, text.code(i + 1) == Ch.greaterThan { return i + 2 - start }
        i += 1
    }
    return nil
}

/// The declaration, CDATA, closing and opening tag forms of lezer's inline HTML tag after `<`.
func inlineHTMLTagLength(_ text: [UInt16], _ start: Int) -> Int? {
    if text.code(start) == Ch.bang, (65...90).contains(text.code(start + 1)) {
        var i = start + 2
        while i < text.count {
            if text.code(i) == Ch.greaterThan { return i + 1 - start }
            i += 1
        }
        return nil
    }
    if text.hasPrefix("![CDATA[", at: start) {
        var i = start + 8
        while i + 2 < text.count {
            if text.hasPrefix("]]>", at: i) { return i + 3 - start }
            i += 1
        }
        return nil
    }
    if text.code(start) == Ch.slash {
        var i = start + 1
        while isWhitespace(text.code(i)) { i += 1 }
        guard let end = closingTagEnd(text, i) else { return nil }
        return end - start
    }
    var i = start
    while isWhitespace(text.code(i)) { i += 1 }
    guard let end = openTagEnd(text, i, attributeColon: true, allowSelfClose: true) else { return nil }
    return end - start
}

/// `[a-z][\w-]*\s*>` at `start`; returns the index after `>`.
private func closingTagEnd(_ text: [UInt16], _ start: Int) -> Int? {
    guard isAlpha(text.code(start)) else { return nil }
    var i = start + 1
    while isHostChar(text.code(i)) { i += 1 }
    while isWhitespace(text.code(i)) { i += 1 }
    return text.code(i) == Ch.greaterThan ? i + 1 : nil
}

/// A tag name, attributes and `>` at `start`; returns the index after `>`.
private func openTagEnd(_ text: [UInt16], _ start: Int, attributeColon: Bool, allowSelfClose: Bool) -> Int? {
    guard isAlpha(text.code(start)) else { return nil }
    var i = start + 1
    while isHostChar(text.code(i)) { i += 1 }
    while true {
        var j = i
        while isWhitespace(text.code(j)) { j += 1 }
        let first = text.code(j)
        if j == i || !(isAlpha(first) || first == Ch.colon || first == Ch.underscore) { break }
        j += 1
        while true {
            let c = text.code(j)
            guard isHostChar(c) || c == Ch.dot || (attributeColon && c == Ch.colon) else { break }
            j += 1
        }
        i = j
        var k = i
        while isWhitespace(text.code(k)) { k += 1 }
        if text.code(k) == Ch.equals {
            k += 1
            while isWhitespace(text.code(k)) { k += 1 }
            if let valueEnd = attributeValueEnd(text, k) { i = valueEnd }
        }
    }
    while isWhitespace(text.code(i)) { i += 1 }
    if allowSelfClose, text.code(i) == Ch.slash {
        i += 1
        while isWhitespace(text.code(i)) { i += 1 }
    }
    return text.code(i) == Ch.greaterThan ? i + 1 : nil
}

private func attributeValueEnd(_ text: [UInt16], _ start: Int) -> Int? {
    let first = text.code(start)
    if first == Ch.singleQuote || first == Ch.doubleQuote {
        var i = start + 1
        while i < text.count {
            if text.code(i) == first { return i + 1 }
            i += 1
        }
        return nil
    }
    var i = start
    while i < text.count {
        let c = text.code(i)
        if isWhitespace(c) || [Ch.doubleQuote, Ch.singleQuote, Ch.equals, Ch.lessThan, Ch.greaterThan, Ch.backtick]
            .contains(c)
        {
            break
        }
        i += 1
    }
    return i > start ? i : nil
}

// MARK: HTML blocks

private let rawTextTags: Set<String> = ["script", "pre", "style"]

private let blockTags: Set<String> = [
    "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col",
    "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure",
    "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html",
    "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option",
    "p", "param", "section", "source", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr",
    "track", "ul",
]

private func tagName(_ text: [UInt16], _ start: Int) -> (name: String, end: Int) {
    var i = start
    var name = ""
    while isAlphanumeric(text.code(i)) {
        name.unicodeScalars.append(Unicode.Scalar(UInt8(lowerASCII(text.code(i)))))
        i += 1
    }
    return (name, i)
}

/// The kind of HTML block starting with `rest` (which begins with `<`), or -1.
func htmlBlockStart(_ rest: [UInt16], breaking: Bool) -> Int {
    let raw = tagName(rest, 1)
    if rawTextTags.contains(raw.name) {
        let after = rest.code(raw.end)
        if after < 0 || isWhitespace(after) || after == Ch.greaterThan { return 0 }
    }
    if rest.hasPrefix("<!--", at: 0) { return 1 }
    if rest.hasPrefix("<?", at: 0) { return 2 }
    if rest.code(1) == Ch.bang, isAlpha(rest.code(2)) { return 3 }
    if rest.hasPrefix("<![CDATA[", at: 0, caseInsensitive: true) { return 4 }
    let nameStart = rest.code(1) == Ch.slash ? 2 : 1
    let block = tagName(rest, nameStart)
    if blockTags.contains(block.name) {
        let after = rest.code(block.end)
        if after < 0 || isWhitespace(after) || after == Ch.greaterThan
            || (after == Ch.slash && rest.code(block.end + 1) == Ch.greaterThan)
        {
            return 5
        }
    }
    if breaking { return -1 }
    let tagEnd =
        rest.code(1) == Ch.slash
        ? closingTagEnd(rest, 2) : openTagEnd(rest, 1, attributeColon: false, allowSelfClose: false)
    guard var i = tagEnd else { return -1 }
    while isWhitespace(rest.code(i)) { i += 1 }
    return i == rest.count ? 6 : -1
}

func htmlBlockEndsAtEmptyLine(_ kind: Int) -> Bool {
    kind >= 5
}

func htmlBlockEnds(_ kind: Int, _ line: [UInt16]) -> Bool {
    switch kind {
    case 0:
        for tag in rawTextTags where line.contains("</\(tag)>", caseInsensitive: true) {
            return true
        }
        return false
    case 1: return line.contains("-->")
    case 2: return line.contains("?>")
    case 3: return line.contains(">")
    case 4: return line.contains("]]>")
    default: return line.allSatisfy { $0 == UInt16(Ch.space) || $0 == UInt16(Ch.tab) }
    }
}
