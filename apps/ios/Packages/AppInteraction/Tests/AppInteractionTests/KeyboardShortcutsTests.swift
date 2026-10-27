import AppInteraction
import XCTest

final class KeyboardShortcutsTests: XCTestCase {
    private func context(
        notesShown: Bool = true, editorFocused: Bool = false, modalPresented: Bool = false
    ) -> ShortcutContext {
        ShortcutContext(
            notesShown: notesShown, editorFocused: editorFocused, modalPresented: modalPresented)
    }

    func testKeys() {
        let expected: [ShortcutCommand: ShortcutKey] = [
            .newNote: ShortcutKey(input: "n", shift: false),
            .search: ShortcutKey(input: "f", shift: false),
            .save: ShortcutKey(input: "s", shift: false),
            .bold: ShortcutKey(input: "b", shift: false),
            .italic: ShortcutKey(input: "i", shift: false),
            .strikethrough: ShortcutKey(input: "x", shift: true),
            .link: ShortcutKey(input: "k", shift: false),
            .task: ShortcutKey(input: "\r", shift: false),
        ]
        for command in ShortcutCommand.allCases {
            XCTAssertEqual(KeyboardShortcuts.key(for: command), expected[command])
        }
    }

    func testKeysAreUnique() {
        let keys = ShortcutCommand.allCases.map { KeyboardShortcuts.key(for: $0) }
        for (index, key) in keys.enumerated() {
            XCTAssertFalse(keys[(index + 1)...].contains(key))
        }
    }

    func testCommandK() {
        XCTAssertEqual(KeyboardShortcuts.commandK(editorFocused: true), .link)
        XCTAssertEqual(KeyboardShortcuts.commandK(editorFocused: false), .search)
    }

    func testCommandGroups() {
        XCTAssertEqual(KeyboardShortcuts.menuCommands, [.newNote, .search, .save])
        XCTAssertEqual(
            KeyboardShortcuts.formatCommands, [.bold, .italic, .strikethrough, .link, .task])
        XCTAssertEqual(
            Set(KeyboardShortcuts.menuCommands + KeyboardShortcuts.formatCommands),
            Set(ShortcutCommand.allCases))
    }

    func testTitles() {
        let expected = [
            "New Note", "Search Notes", "Save", "Bold", "Italic", "Strikethrough", "Link", "Task",
        ]
        XCTAssertEqual(ShortcutCommand.allCases.map(KeyboardShortcuts.title(for:)), expected)
    }

    func testEnablement() {
        for command in KeyboardShortcuts.menuCommands {
            XCTAssertTrue(KeyboardShortcuts.isEnabled(command, in: context()))
            XCTAssertTrue(KeyboardShortcuts.isEnabled(command, in: context(editorFocused: true)))
            XCTAssertFalse(KeyboardShortcuts.isEnabled(command, in: context(notesShown: false)))
            XCTAssertFalse(KeyboardShortcuts.isEnabled(command, in: context(modalPresented: true)))
        }
        for command in KeyboardShortcuts.formatCommands {
            XCTAssertFalse(KeyboardShortcuts.isEnabled(command, in: context()))
            XCTAssertTrue(KeyboardShortcuts.isEnabled(command, in: context(editorFocused: true)))
            XCTAssertFalse(
                KeyboardShortcuts.isEnabled(
                    command, in: context(notesShown: false, editorFocused: true)))
            XCTAssertFalse(
                KeyboardShortcuts.isEnabled(
                    command, in: context(editorFocused: true, modalPresented: true)))
        }
    }
}
