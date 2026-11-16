import EditorText
import NativeCoreAPI

struct EarlyDraftState: Equatable {
    var name = ""
    var body = ""
    var nameConfirmed = false

    var isEmpty: Bool { name.isEmpty && body.isEmpty }
}

enum NoteRenameResult: Equatable {
    case none
    case restore
    case error(String)
    case renamed
}

struct NoteDetails: Equatable {
    var words: DetailItemText?
    var tasks: DetailItemText?
    var notSaved = false
    var created: DetailItemText?
    var updated: DetailItemText?
    var shared = false

    static let draft = NoteDetails(notSaved: true)
}

struct NotePosition: Equatable {
    var selection: TextSelection
    var contentOffsetY: Double
}
