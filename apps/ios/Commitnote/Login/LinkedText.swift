import Foundation

func linkedText(_ text: String, link phrase: String, url: String) -> AttributedString {
    var attributed = AttributedString(text)
    if let range = attributed.range(of: phrase), let destination = URL(string: url) {
        attributed[range].link = destination
    }
    return attributed
}
