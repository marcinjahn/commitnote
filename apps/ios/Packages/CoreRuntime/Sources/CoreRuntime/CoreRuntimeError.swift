public enum CoreRuntimeError: Error, Equatable, Sendable {
    case apiVersionMismatch(expected: Int, found: Int)
    case bundleInvalid
    case bundleMissing
    case stopped
    case javaScriptException(name: String)
}
