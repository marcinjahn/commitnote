# commitnote for GNOME

A native GNOME client for the same encrypted notes repo the web app uses. It is a Rust, GTK 4 and
libadwaita app that runs the shared native core bundle (`commitnote-core.js`, built from
`src/native-core/`) in JavaScriptCore, so it reads and writes exactly what the web app does. It logs
in, unlocks a notes repo or sets a new one up, browses and organises the note tree, searches notes,
and edits them in a live-preview Markdown editor with autosave, sync status and conflict
resolution. It also has Preferences, a choice of note fonts, export and import, a passphrase
change, printing and an anonymous launch count.

## Overview

The app and its crates:

- **App** (`src/`, UI definitions in `data/ui/`, UI tests in `tests/ui/`) — GTK 4 and libadwaita
  pages and navigation. It talks to the core runtime and uses the three pure crates below. The
  editor widget is `src/editor/`. Preferences and the Change Passphrase dialog are in
  `src/preferences/`, printing is in `src/print/`, the bundled note fonts are registered by
  `src/fonts.rs`, and `src/file_dialogs.rs` wraps the file chooser (the testing build answers it
  from a queue). `src/export.rs` and `src/import.rs` run export and import.
- **Core runtime** (`crates/core-runtime`) — loads the core bundle into JavaScriptCore and provides
  the host services it needs: crypto, network (libsoup), the remembered session in the Secret
  Service keyring, a blob cache, device settings and the image codec. It also sends the anonymous
  launch visit (`visit.rs`).
- **Crypto** (`crates/crypto`) — the cryptographic operations behind the host crypto service.
- **Core API** (`crates/core-api`) — the typed command, event and error shapes shared with the core
  bundle, plus the fake commands the testing build uses.
- **Markdown** (`crates/markdown`, `commitnote-markdown`) — the Markdown parser, the live-preview
  renderer (style runs and placements for a selection), the Markdown commands (bold, italic,
  strikethrough, links, tasks) and the rule that places inserted image references in the text.
- **Editor text** (`crates/editor-text`, `commitnote-editor-text`) — UTF-16 text edits, the grouped
  undo history and the merge of remote text into what is being typed.
- **Interaction** (`crates/interaction`, `commitnote-interaction`) — the rules for starting a note by
  typing.
- **Image codec** (`crates/image-codec`, `commitnote-image-codec`) — decodes images, re-encodes them
  as WebP and decodes GIF frames for display. It sits behind the core runtime's `imageCodec`
  service and needs libwebp.

Every text offset between the app and the core is in UTF-16 code units, as in the web app. The
editor widget converts to and from GTK's character offsets at the edge.

The core bundle is embedded into the binary from `dist-native-core/` (`dist-native-core-fake/` for
the testing build). Build it first with `npm run build:native-core` from the repository root.

The build is meson wrapping cargo (`meson.build`, `meson.options`).

## Editing

The note view has a title field above the editor. Everything below is in the editor unless noted.

- **Live preview.** Headings, emphasis, strikethrough, inline code, code blocks, quotes, links, list
  marks, task checkboxes and horizontal rules are drawn as they will read. The Markdown markers
  (`#`, `**`, link brackets and the like) are hidden on every line the caret or selection does not
  touch. Hiding is only styling: the buffer text is always exactly the note text, so what is saved
  is what was typed. Clicking a checkbox toggles the task. Images are drawn in place of their reference (see Images).
- **Autosave.** The core saves a note about 2 s after typing stops, at most 30 s later, and also when
  you switch notes, hide the window or log out. Ctrl+S (Save Now, also in the note menu) saves at
  once. Typing keeps working offline; the edits are saved when the connection returns.
- **Sync status.** The status button in the sidebar header (in the note header when the sidebar is
  hidden or collapsed) shows one icon: offline, synced, syncing, waiting to save, failed or
  conflict. Its popover shows the status text, the notes that are not saved yet (a click opens
  one) and Retry. The banner above the note shows the most urgent of: an unresolved conflict on
  this note (with Resolve), a conflict being edited (the hint), a failed save (with Retry Now) and
  being offline. A change made to the open note on another device shows as a short toast, and the
  editor takes the merged text without moving the caret.
- **Conflicts.** The note is read-only while a conflict is unresolved. Resolve opens a dialog with
  the merged text, conflict markers dimmed, and three choices: keep this version, keep the other, or
  edit the merged text in the editor. The wording of the dialog and the choices comes from the core.
- **Formatting.** Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+K and Ctrl+Return (see Shortcuts) work on the
  selection. Ctrl+K wraps the selection in a link with an empty destination and puts the caret in it;
  pasting a URL over a selection makes a link too. Toggle Task with nothing selected in a link opens
  it. In the narrow layout a formatting bar sits at the bottom of the note, and in both layouts the
  note menu holds Save Now and the same commands, Insert Image… among them.
- **Undo.** Ctrl+Z and Ctrl+Shift+Z use the app's own history, which groups typing that is less than
  a second apart. A remote change merges into the text without becoming an undo step, so
  Ctrl+Z takes back only your own typing.
- **Vim mode.** The device setting `vimMode` (off by default) switches the editor to GtkSourceView's
  Vim emulation and shows a status line with the mode and any pending command below the note. The
  Vim mode row in Preferences (Editor) switches it, and the editor follows a change at once. In
  normal mode `u` and Ctrl+R, and `:undo`,
  `:redo` (also `:u` and `:red`), use the app's history instead of the buffer's, which is
  turned off. `:w` saves.
- **New notes and the title.** New Note (the sidebar button, Ctrl+N) opens a draft with the title
  field focused. A draft becomes a note when it gets a name or any text; leaving it empty discards
  it. Renaming is done in the title field; a name that cannot be used shows an error under the
  field.
- **Type to start.** With nothing open and the empty note view showing, typing a character starts
  a new note with it (the setting `typeToStart`, on by default, with a row in Preferences; it needs
  no focused text field and no dialog). The keys typed before the editor is ready are held and entered as one edit.
- **Early draft.** While the notes load after login, the loading page has a name field and a body.
  What is typed there is handed to the core as soon as the notes are ready: a body creates a note,
  a name alone opens a draft with that name. If that fails, the page stays with Try Again and the
  text is kept.
- **Close and logout guards.** Closing the window, Ctrl+W and Ctrl+Q save first. If something is
  still unsaved, "Some Changes Are Not Saved" offers Keep Trying (which retries and keeps the window
  open) and Quit Anyway. Log Out asks the same way, with Cancel, Keep Trying and Log Out Anyway.
  Text typed into the early draft on the loading page is guarded too: closing with it asks the same
  way, and Keep Trying keeps the text and lets the hand-off finish (or runs Try Again when the
  loading page shows a failure). An empty early draft closes at once. While anything is unsaved, or
  the early draft holds text, the app also holds a GNOME logout inhibit, so a session logout or
  shutdown warns first.

## Images

An image reference in the text (`![](image:<id>)`, optionally with a size) is drawn as the picture
itself, on its own line, in the editor and in the shared version. The core
keeps the pictures encrypted in the repo; the app asks it for the bytes and keeps up to 256 MiB of
decoded pictures in memory. The Markdown stays the note text, so the reference is still there to edit.

- **Inserting.** Insert Image… (the note menu, and the image button of the formatting bar in the
  narrow layout) opens a file chooser filtered to images. Pasting an image file or an image from the
  clipboard, and dropping image files or an image onto the editor, insert too. Pasting text that
  holds image references from another note gives the open note its own copies. The references go in
  where the caret or selection is, placed by the shared insertion rule: as blocks on their own lines,
  inline inside a table cell, and after a table when the caret is at the end of its last row.
  Several images keep their order. A result that arrives after you kept typing lands at the old
  spot when the text is unchanged, and at the caret otherwise.
- **What is accepted.** PNG, JPEG, GIF, WebP, BMP, TIFF and ICO, read by the image codec; HEIC and
  SVG are refused. A file over 25 MiB or a picture over 50 million pixels is refused, and so is
  anything that is not an image; the core says why in a notice, and the text stays as it was. At
  most 10 images go in at once, and more than that are all refused. A file that cannot be read shows
  the toast "Could not read the file". Pictures are shrunk to 2560 px on the long edge (smaller
  where needed to fit 2 MiB) and stored as WebP, and an animated GIF stays a GIF if it is at most
  5 MiB.
- **In the note.** An image shows at its size up to 360 px high (260 px in the narrow layout, below
  768 px wide). While it loads there is a placeholder, and a picture that cannot be read shows "Image
  unavailable"; it is read again after a save or a refresh, and when the viewer is opened.
- **Viewer.** A click on an image opens it in a dialog. The picture fits the window at first
  (zoom 1×) but is never shown larger than its natural size, and zooms up to 8× in steps of 1.25:
  Zoom In, Zoom Out and Best Fit in the header bar, the shortcuts in the table below, Ctrl and the
  scroll wheel (around the pointer), or a pinch. Best Fit returns to the 1× size once zoomed in. A
  zoomed picture is panned by dragging it. Escape closes the dialog.
- **Animation.** A GIF plays while its widget is mapped and visible, with each frame's own delay (a
  delay under 10 ms plays as 100 ms), and shows its first frame still when the GNOME setting
  `gtk-enable-animations` is off. An animation larger than 64 MiB decoded keeps only its first
  frame.

## History

History in the note menu (the open note only) saves any pending edit first, so the newest version
is the one just typed, then lists the versions of the note.

- **List.** Versions are grouped under the core's date headings, newest first; the newest carries a
  Current mark, and a version that was shared carries a Shared mark. Close-together saves are
  collapsed into one row (for example "14:02–14:31 · 18 saves") that expands to the single versions.
  A row shows the time and what the change did (and the name the note had then). Load Older Versions
  fetches more, with a spinner while it works; a failure shows its message with Retry, and the end of the history is stated.
  While the note is still saving, or cannot be saved, the dialog shows the core's message instead of
  the list.
- **Preview and restore.** A row opens the version: the change as a line diff, with the changed words
  marked and long unchanged stretches folded (the core decides what is shown, and says when the
  version is too large to show or the same as the current one). When the title changed, the heading
  names the change and a switch offers restoring the title as well. Restore (the label and whether it
  is enabled come from the core, with the reason when it is not) saves pending edits, then restores
  the version; the dialog closes and the core's notice with Undo appears as a toast. A failure shows
  as a toast and keeps the dialog.

## Sharing

A note can be shared as a link that opens a read-only copy, with an optional password.

- **Share….** The first item of the note menu opens the dialog for the open note; pending edits are
  saved first. The form has a Password (optional) and a Name (optional) field and the core's
  explanation. Create gives the link and, when there is a password, the password (hidden as dots)
  with a copy button each; a toast confirms a copy. Create Another returns to the form. A refusal
  from the core shows under the form, with a link when the core gives one. Shares the note already
  has are listed below.
- **Shared Links.** The main menu lists every share: its name (the label, or the note's name), the
  note's name under a label, the date, and a lock when it has a password. When there are none it
  says so, and when the shares cannot be read it shows why.
- **Row actions.** A share's menu (here and in the Share… dialog) offers Copy Link, Copy Password,
  Update (brings the shared copy to the current version, with a spinner on the row while it runs), View (the shared
  version, read-only), Open (the note, when it still exists), Rename (the name) and Revoke. Revoke
  asks for confirmation. The labels and the confirmation texts come from the core.

## Organising notes

The sidebar tree holds folders and notes. A folder row shows the number of notes under it, a note
row shows a dot for its color tag and an icon when the note is shared. Structure changes go through
the core, so the web app sees exactly what the Linux app did.

- **New notes and folders.** New Note (the sidebar button, Ctrl+N) starts a draft at the top level.
  New Note in a row's context menu starts it in that folder, or in the folder of the note. New
  Folder… (the main menu, Ctrl+Shift+N, the context menu) asks for a name and creates the folder
  inside the selected folder, next to the selected note, or at the top level when nothing is
  selected. Where the new item lands among its siblings follows the core's `newNotePlacement` and
  `newFolderPlacement` settings, which have the New notes and New folders rows in Preferences.
- **Rename.** F2 or Rename in the context menu turns the row's name into an entry. Enter commits,
  Escape cancels, and a name that cannot be used shows an error under the entry. Moving the focus
  away commits the name. The note menu's Rename moves the focus to the title field of the open
  note instead.
- **Move.** Move To… (context menu, note menu) opens a folder picker. Move Up and Move Down (Alt+Up
  and Alt+Down in the tree, or the context menu) swap the row with its neighbour and are disabled
  at the ends. Dragging a row shows where it will land: a line before or after the row, or the row
  highlighted for dropping into a folder (a folder takes the top and bottom quarter of its height
  for before and after, a note the top and bottom half). A drop that would leave the row where it
  is, or put a folder into itself, is refused. Dropping below the last row moves the row to the end
  of the top level.
- **Trash.** Move to Trash (Delete in the tree, the context menu, the note menu) first asks the
  core what it would trash and shows its confirmation. The preview counts the shares involved, so
  trashing a shared note or a folder holding one shows the core's share warning, and the
  confirmation is asked again if the shares changed in the meantime. After
  structure changes and trashing the core's notice appears as a toast with Undo. Trash in the main
  menu opens the Trash dialog with the trashed notes and folders and the days left for each.
  Restore To… always asks for a folder, Delete Permanently and Empty Trash ask for confirmation,
  and each confirmation text comes from the core.
- **Color tags.** The Color Tag submenu of a note (context menu, note menu) sets one of six colors
  or None. It appears where the repository allows tags, and the color names come from the core.
  Once any note has a tag, the main menu gets Filter by Color Tag with All Notes and the used
  colors; a filter shows only the notes with that color, with a banner "Showing notes tagged …" and
  Show All to clear it.
- **Context menus.** A row's menu opens with a right click, a long press (touch), the Menu key or
  Shift+F10 on the selected row. It holds New Note, New Folder…, Rename, Move To…, Move Up, Move
  Down, Color Tag (notes only) and Move to Trash. The tree shortcuts act on the selected row and
  are not handled while a rename or the menu is open.

## Search

The search button in the sidebar header, Ctrl+F, and Ctrl+K outside the editor open the search bar
and replace the tree with the results. In the narrow layout they also bring the sidebar back, and
with the sidebar hidden they show it. Ctrl+K inside the editor stays Insert Link (see Shortcuts).
Typing in the tree does not start a search.

- **Recent.** With an empty query the list shows the recently opened notes, without the open one,
  and the core's hint.
- **Results.** Each keystroke searches. Matching notes are listed by name and by content, in two
  sections with the core's headings, a count, and a "more" row when a section is cut off. A name
  row bolds the matched part of the name; a content row shows a snippet with the match in bold.
  A row shows the note's folder and its color dot. When nothing matches, the core's no-match text
  replaces the list.
- **Index status.** While the core is still reading notes to build the index, the results are
  marked as partial with the core's "still reading" line, and the status text and a progress bar
  show how far it is.
- **Keys.** Down in the entry moves into the results, Enter in the entry opens the first result,
  and Escape or the search button closes search and puts the focus back in the tree. Opening a
  result closes search, reveals the note in the tree and, in the narrow layout, shows the note.

## Last view and details

- **Reopen last view.** At start the app opens the note that was open and expands the folders that
  were expanded, unless something else was opened first (an early draft, or a note chosen while the
  notes loaded) or the core's device setting is off (`lastView.setEnabled`, stored by the core as
  `commitnote.reopenLastViewOff`, the Reopen last view row in Preferences). A note or folder that no
  longer exists is skipped. The view is saved about half a second after it changes, and quitting
  saves it at once, waiting up to 2 s, so a quick quit keeps it. With the setting off nothing is
  written.
- **Caret and scroll.** The caret and scroll position of a note are remembered when you leave it
  and come back while the app runs. They are not saved across restarts. A long note scrolls to the
  caret over a few frames, so the caret stays visible.
- **Details.** Details in the note menu shows the words and tasks done of the open saved note, when
  it was created and last updated, or "Not saved yet" for a note that has not been saved, and
  whether it is shared. There is no character count. The dialog follows the open note and closes
  when it is gone.

## Preferences

Preferences opens from the main menu or with Ctrl+, on the notes page, once the settings have
loaded. It is one dialog at a time: opening it again shows the open one. It closes by itself when
the app leaves the notes page (for example on Log Out). Closing it stores an unsaved device name and
sends pending changes at once instead of waiting for the core's short delay.

The core supplies the dialog's title and intro, the group names, every row label and hint, the scope
labels, the colour palette, the note font names with their descriptions, and the save status, and
the app shows them as given. Settings are saved by the core: the synced ones go to the repository,
the device ones stay on this device. The groups, top to bottom:

- **Save status.** Shown only while the core reports one: its label and detail, and a Retry button
  when the last save failed.
- **Appearance.** Color mode (a choice row), Accent color (round swatches from the core's palette,
  repainted when the desktop style changes) and Note font (a choice row that shows each font in its
  own typeface with the core's description). A preview row below renders the core's sample note
  (heading, emphasis, code) in the chosen font (see Note fonts).
- **Editor.** "Start a note by typing" (see Editing) and Vim mode. Vim mode is a row only on Linux,
  where the core supplies its copy, and it has no scope toggle. The group's text, from the core,
  says the animated caret is not available on Linux and that its setting stays as it is for your
  other devices.
- **Notes.** New notes and New folders: where a new item lands among its siblings.
- **This device.** The device name (committed on Enter or when the focus leaves the row; an empty
  name goes back to the automatic one), Reopen last view (see Last view and details) and Anonymous
  usage statistics (see Usage statistics).
- **Data & security.** Export notes, Import notes and Change passphrase (see Data).

Color mode, Accent color, Note font and Start a note by typing each have a toggle between "All
devices" (the setting is synced) and "This device". It starts where the core's default puts it: the
first three are synced, Start a note by typing is for this device. The other rows have no toggle:
the placement rows apply to all devices, and Vim mode and the rows under This device are kept on the
device. In a narrow window the toggles move under their rows. A change made on another device shows
up in the open dialog.

The dialog's search (its search button, or Ctrl+F) keeps only the rows that match the typed text.

### Note fonts

The Note font row offers the core's list: Inter (the default), IBM Plex Sans, Atkinson
Hyperlegible Next, Nunito, iA Writer Quattro S, Literata, Source Serif 4, Lora, JetBrains Mono, IBM
Plex Mono, and System, which uses the desktop's document font. The setting applies to the note
editor, the preview rows (Preferences, version previews, shared versions) and printing.

The font files are not copied into the Linux app. They are the iOS app's files, installed by meson
from `apps/ios/Commitnote/Fonts/` (24 `.ttf` files) into `<datadir>/<app id>/fonts` under the
install tag `fonts`. At startup the app registers every file in the first data directory (the user's
`XDG_DATA_HOME`, then `XDG_DATA_DIRS`) that holds `<app id>/fonts`. A missing file only logs a
warning, and the text then falls back to the desktop's font. `release-check.sh` checks that a
release install holds exactly the 24 files, and the UI harness installs just the `fonts` tag
(`meson install --tags fonts`) so the testing build shows the real fonts.

Because the files live outside `apps/linux/`, a change in `apps/ios/Commitnote/Fonts/` runs the
`Linux` workflow (it is in the workflow's path filter).

## Data

Preferences > Data & security holds the three flows below. The labels and the messages come from
the core. The file chooser titles ("Export Notes", "Import Notes") are the app's own. A chooser the
user cancels changes nothing and shows no error.

- **Export.** Export notes sends the edits first, asks the core for the export and then asks where to
  save the zip (the core's file name is the suggestion). The row reads "Exporting…" while it runs, and
  only one export runs at a time. The archive holds the notes and their images. If writing the file
  fails, the core's failure message appears as a toast and only the kind of the I/O error is logged.
  The page shown when the repository's key has changed also has an export. It saves a zip without
  images that includes the edits that were not synced yet.
- **Import.** Import notes opens a chooser for `.zip` files and for Markdown or text files
  (`.md`, `.markdown`, `.txt`).
  - A zip opens the import form: the file name, a note about what is skipped, and the destination, either a
    new folder (with a suggested name) or an existing one (the top level first). A preview line
    shows what the import will do and updates a moment after each change. Import runs the import and
    stops on conflicts; the conflicts stage then shows the core's text and offers Rename, which
    imports again with the conflicting names changed. When the repository cannot take the import until atomic commits are enabled, the
    form shows the set-up step with an action that enables them and carries on. Cancel closes the
    form and discards the zip. The wording of every stage is the core's.
  - Markdown and text files go in without a form, one note each. They can also be dropped onto the
    note tree from another app: a drop on the middle of a folder imports into it, a drop on a note or
    on the edge of a row imports into that row's folder, and a drop below the last row imports at the
    top level. A line in the tree shows where the files will land. If the repository first needs
    atomic commits, an alert offers to enable them and the files are imported afterwards; when
    atomic commits are blocked, an alert that cannot be dismissed offers to enable them or to save
    without them.
  - An archive may be up to 200 MiB and a note file up to 1 MiB. Every picked file is read before
    any is imported, and a file that cannot be read shows the toast "Could not read the file".
    Import notes is disabled while an import runs and when the repository does not allow importing.
- **Change passphrase.** The dialog opens over Preferences and follows the core's stages:
  1. The form has the current passphrase, the new one with a strength meter, the new one repeated and,
     where the repository supports it, a switch to remove the version history. Empty current
     passphrase and a mismatch are caught in the form; for a wrong current passphrase the core's
     error is shown and the current field is emptied.
  2. Working: a progress bar with the core's message while it prepares the change.
  3. Review: a summary of what changes, what is carried over, the warning about version history
     and the notices about other devices. Confirm commits the change; Cancel goes back to the form.
  4. Set-up: when atomic commits must be enabled first, a message with an action that enables
     them and tries again.
  5. Unsettled: when it is unclear whether the change landed, the dialog stays and offers Check
     Again or Log Out.
  The dialog cannot be closed while the change is working or unsettled, and the passphrases are
  held as `Secret`s. When the change succeeds, the dialog closes.

## Printing

Print… in the note menu and Ctrl+P print the open note or draft, when one is open and no print is
already running. The app sends the edits, asks the core to render the note to an HTML document and
lays it out in an offscreen WebKit view (`webkit6`), then shows GTK's print dialog and prints that
view with it. A cancelled dialog prints nothing and is not an error. A failure shows the toast
"Could not print the note" and logs only the step and the error's domain.

The view is locked down, because it renders note content: a Content-Security-Policy of
`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'`, JavaScript off, no
network, a navigation gate that lets through only the document's own load, and an ephemeral
session that stores nothing. Images go in as `data:` URIs. The WebKit sandbox stays on in the app.
`print::initialize_web_engine()` runs on the main thread at startup, before the core runtime starts.

The printout uses the note font: the two faces (regular and italic) of the chosen font are embedded
into the document, so it prints in that font even where the font is not installed. With System
nothing is embedded and the document's own default font stack applies.

CI checks the document and the print dialog, not a printout: the tests read back the HTML the view
loaded and check the policy, the font face and an inline image in it, that the system font embeds no
face, and that the print dialog opens and closes (Ctrl+P, Escape) without an error toast. No page is
sent to a printer or a PDF.

## Usage statistics

The app counts launches with one anonymous request, the Linux visit:

- One `GET` per process start with exactly `p=%2Fapp%2Flinux` and `t=App%20(Linux)`, sent after the
  first core start. It uses a libsoup session of its own: no cookies, cache, `Referer`,
  `Authorization`, body, identifiers or other parameters, only `https`, a 30 s timeout. It is never
  awaited or retried, the URL is never logged, and logging out and in again, or a later core start,
  sends nothing more.
- The endpoint comes from `GOATCOUNTER_SITE_CODE` in `analytics.config.ts`, like on iOS: the
  production bundle uses GoatCounter, and the fake core of the testing build uses
  `https://analytics.invalid/count`. While the site code is `null`, nothing is sent.
- Opt out in Preferences > This device > "Anonymous usage statistics". The choice is stored as
  `commitnote.analyticsOptOut = "1"` in the device settings, and while it is set nothing is sent.
- The testing build never sends: it records the URL the app would have sent, and the tests read it
  back.

## Shortcuts

| Shortcut         | Where                          | What it does                                                                            |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| Ctrl+S           | anywhere in the window         | Save Now: sends the edits and saves them.                                               |
| Ctrl+N           | notes and loading pages        | New note at the top level; on the loading page it focuses the early draft's name field. |
| Ctrl+Shift+N     | notes page                     | New Folder….                                                                            |
| Ctrl+W           | anywhere in the window         | Closes the window, through the close guard.                                             |
| Ctrl+Q           | anywhere in the window         | Quits, through the close guard.                                                         |
| Ctrl+R           | notes page                     | Refresh. With Vim mode on and the editor focused, Vim's redo instead.                   |
| Ctrl+F           | notes page                     | Opens search, or selects the text of the search entry.                                  |
| Ctrl+K           | notes page, outside the editor | Same as Ctrl+F.                                                                         |
| Ctrl+,           | notes page                     | Preferences.                                                                            |
| Ctrl+P           | notes page                     | Print…: prints the open note or draft.                                                  |
| F9               | notes page                     | Shows or hides the sidebar.                                                             |
| Escape           | search                         | Closes search.                                                                          |
| Down             | search entry                   | Moves into the results.                                                                 |
| Enter            | search entry                   | Opens the first result.                                                                 |
| Left, Right      | note tree                      | Collapse or expand a folder; move to the parent or the first child.                     |
| F2               | note tree                      | Renames the selected row in place.                                                      |
| Enter, Escape    | rename entry                   | Commits or cancels the rename.                                                          |
| Delete           | note tree                      | Move to Trash, after the confirmation.                                                  |
| Alt+Up, Alt+Down | note tree                      | Move Up or Move Down among the siblings.                                                |
| Menu, Shift+F10  | note tree                      | Opens the context menu of the selected row.                                             |
| Ctrl+Z           | editor                         | Undo.                                                                                   |
| Ctrl+Shift+Z     | editor                         | Redo.                                                                                   |
| Ctrl+B           | editor                         | Bold.                                                                                   |
| Ctrl+I           | editor                         | Italic.                                                                                 |
| Ctrl+Shift+X     | editor                         | Strikethrough.                                                                          |
| Ctrl+K           | editor                         | Insert link.                                                                            |
| Ctrl+Return      | editor                         | Toggle task; with nothing selected inside a link, open it.                              |
| Ctrl+click       | a link in the editor           | Opens the link.                                                                         |
| Ctrl+plus        | image viewer                   | Zoom in. Ctrl+equals and Ctrl+keypad plus work too.                                     |
| Ctrl+minus       | image viewer                   | Zoom out. Ctrl+keypad minus works too.                                                  |
| Ctrl+0           | image viewer                   | Best fit. Ctrl+keypad 0 works too.                                                      |
| Ctrl+scroll      | image viewer                   | Zooms around the pointer.                                                               |
| `u`              | editor, Vim normal mode        | Undo through the app's history.                                                         |
| `:undo`, `:redo` | editor, Vim command line       | Undo and redo through the app's history.                                                |
| `:w`             | editor, Vim command line       | Save Now.                                                                               |

The editor shortcuts work while the editor has focus. Ctrl+KP_Enter also toggles the task. The tree
shortcuts need the tree focused and a row selected; the keypad Delete, Up and Down work like the
main keys. Ctrl+F, Ctrl+K (outside the editor), Ctrl+Shift+N, Ctrl+P and F9 work anywhere on the notes
page.

## Build on the host (Fedora 43)

Install the build and run packages:

<!-- packages: build+run -->

```sh
sudo dnf install \
  appstream \
  blueprint-compiler \
  desktop-file-utils \
  gcc \
  glib2 \
  glib2-devel \
  gtk4 \
  gtk4-devel \
  gtksourceview5 \
  gtksourceview5-devel \
  javascriptcoregtk6.0 \
  javascriptcoregtk6.0-devel \
  libadwaita \
  libadwaita-devel \
  libsoup3 \
  libsoup3-devel \
  libwebp \
  libwebp-devel \
  meson \
  ninja-build \
  pkgconf-pkg-config \
  webkitgtk6.0 \
  webkitgtk6.0-devel
```

Node.js and npm are needed for the core bundle, and rustup for the Rust toolchain. rustup reads
`rust-toolchain.toml` and installs the pinned toolchain with clippy and rustfmt on the first cargo
command inside `apps/linux/`. Fedora packages it as `rustup`; run `rustup-init` once after
installing it.

From the repository root:

```sh
npm ci
npm run build:native-core
apps/linux/scripts/run-host.sh
```

`run-host.sh` configures meson in `apps/linux/_build`, builds, installs into
`apps/linux/out/host-prefix` and starts the installed binary from there, so nothing is installed
system-wide. `apps/linux/scripts/run-host.sh --testing` builds and runs the testing build instead
(see below).

## Run without development packages

`install-prefix.sh` builds the app in the Docker build container and installs it into
`apps/linux/out/prefix`; `run-installed.sh` starts it on the host. This needs Docker (or Podman's
Docker API) and only the run packages on the host. Most of them are on a default Fedora
Workstation.

<!-- packages: run -->

```sh
sudo dnf install \
  glib2 \
  gtk4 \
  gtksourceview5 \
  javascriptcoregtk6.0 \
  libadwaita \
  libsoup3 \
  libwebp \
  webkitgtk6.0
```

From the repository root:

```sh
npm ci
npm run build:native-core
apps/linux/scripts/install-prefix.sh
apps/linux/scripts/run-installed.sh
```

`install-prefix.sh` takes `--release` (the release profile) or `--testing` (the testing build);
without an option it installs the development profile. Each run replaces `out/prefix`.
`run-installed.sh [<prefix>]` runs `<prefix>/usr/bin/commitnote` with the prefix's schemas and data
directories; without an argument it uses `apps/linux/out/prefix`. Extra arguments are passed to the
app.

## Testing build

The testing build (`-Dtesting=true`, development profile only) embeds the fake core bundle
(`dist-native-core-fake/`) and serves the sample notes repo from a fake forge, so the app works
without a network or an account: any token logs in, and the passphrase of the sample repo is
`sample notes repo passphrase`. It also adds a Testing section to the notes view's main menu with
Remote Edit, Fail Next Request, Change Passphrase Elsewhere and Hold Loading, which change the fake
forge's state so the app's reaction can be seen. Remote Edit replaces the first line of the open
note (or of the first note) with a commit from another device. Hold Loading makes the fake forge
hold back the repository inspection of the sample repositories, so the loading page stays up: type
there to try the early draft, then press Finish Loading, a button the loading page shows only in this
build. Starting the app with `COMMITNOTE_TESTING_HOLD_LOADING=1` holds loading from the start. It also
answers the file chooser from a queue instead of showing it, and records the usage-statistics visit
instead of sending it. The UI tests run against this build.

```sh
apps/linux/scripts/install-prefix.sh --testing
apps/linux/scripts/run-installed.sh
```

or, with the development packages installed, `apps/linux/scripts/run-host.sh --testing`.

## Checks and tests

Nothing needs GTK on the machine: these scripts run inside the Docker build container
(`ci/Dockerfile`, Fedora 43 plus the three package lists in `ci/` and the pinned Rust toolchain).
The image is built on first use and rebuilt when the Dockerfile, a package list or
`rust-toolchain.toml` changes. Run them from the repository root, after
`npm run build:native-core`:

| Script                                   | What it does                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/linux/scripts/build.sh`            | `cargo build` of the crates, then the meson testing build of the app.                                                                              |
| `apps/linux/scripts/lint.sh`             | The static checks below.                                                                                                                           |
| `apps/linux/scripts/test.sh`             | Crate tests, the app's unit tests, the UI suite and the read-back.                                                                                 |
| `apps/linux/scripts/ui-test.sh [filter]` | Only the UI suite. The optional filter runs the cases whose name contains it; with no match it fails.                                              |
| `apps/linux/scripts/release-check.sh`    | Builds the release profile and checks that the binary holds no fake command, that its embedded bundle equals `dist-native-core/` and not the fake. |

`release-check.sh` also installs the release build into a scratch prefix and checks that it holds
exactly the 24 note font files (`.ttf`) under `<datadir>/io.github.marcinjahn.commitnote/fonts`.

The static checks (`lint.sh`) are:

- the check that the package lists in this README match `ci/*-packages.txt`
  (`scripts/check-package-lists.sh`, which also runs on the host with plain `sh`),
- `cargo fmt --all --check`,
- `cargo clippy` with `-D warnings` on the crates and, through meson, on the app with and without
  the testing build,
- Blueprint compilation of `data/ui/`, which happens when meson builds the app for clippy,
- the meson `static` suite: `desktop-file-validate`, `appstreamcli validate` on the metainfo, and a
  strict compile of the GSettings schema,
- on the host, `npx tsx apps/linux/markdown-vectors/generate.ts --check`, which fails when the
  Markdown vectors are stale (see below).

The tests (`test.sh`) run, in this order:

1. The crate tests (`cargo test --workspace`) inside a D-Bus session with an unlocked
   gnome-keyring, because the remembered-session store uses the Secret Service. The visit test
   (`crates/core-runtime/tests/visit.rs`) checks that the core builds the Linux visit, that an
   opt-out sends nothing, that the sender makes one anonymous `GET` to a local server and that it
   refuses anything but `https` in production. One more test checks
   that the app copes with no Secret Service at all. The image codec tests run here, in the
   container, because they need libwebp. The core runtime runs every file of `apps/test-vectors/`,
   including the shared image vectors (`image-pipeline.json`, `images.json`) and the insertion
   vectors (`image-insertion.json`, also run by the Markdown crate).
2. The app's own unit tests (meson `cargo` suite).
3. The UI suite (`ci/steps/ui-test.sh`): the testing build at 1280x800 under headless mutter
   (a 1920x1200 virtual monitor, so the window is never maximised) with an unlocked keyring, driving real pages and saving screenshots to
   `apps/linux/out/screenshots/p<phase>-<view>-<narrow|wide>-<light|dark>-<accent>.png`. The `p1`
   cases cover login, unlocking and reading; the `p2` cases cover the editor, Vim mode, drafts,
   sync feedback, conflicts, the close guard and the early draft; the `p3` cases cover new folders,
   Move To…, inline rename, the context menu and its keys, drag and drop, Move Up and Down, color
   tags and the filter, the note menu, Undo, the Trash dialog and its confirmations, search, the
   Details dialog and the last view. `p3-shot-tree-context-menu`, `p3-shot-trash-dialog` and
   `p3-search-shot` also save the `p3-tree-context-menu`, `p3-trash-dialog` and `p3-search`
   screenshots, each narrow and wide, light and dark, with the violet accent. The `p4` cases cover
   inserting images (the file chooser, paste of a file, a texture and references, drop, the limit of
   ten, a file that is not an image), the inline loading and unavailable states, the viewer's keys,
   GIF animation, History (open, the shared mark, the unsaved state, preview and restore, restoring
   the title, keys) and sharing (create, Create Another, saving first, an error, the Shared Links
   actions and Revoke). `p4-shot-note-images`, `p4-shot-history` and `p4-shot-shared-links` save
   `p4-note-images`, `p4-history` and `p4-shared-links`, narrow and wide, light and dark;
   `p4-shot-image-viewer`, `p4-shot-version-preview` and `p4-shot-share-dialog` save
   `p4-image-viewer`, `p4-version-preview` and `p4-share-dialog`, wide and light only. All use the
   violet accent. The `p5` cases cover Preferences (the shortcut and the menu, color mode, accent,
   scope toggles, note font, Vim mode, type to start, device name, placement, a change from another
   device, a failed save with Retry, search, and the dialog closing on Log Out), export (from
   Preferences, a cancelled chooser, a failed write, the key-changed page with and without unsynced
   edits), import (a zip into a new or an existing folder, conflicts and Rename, Cancel, Markdown
   files picked or dropped on the tree, the disabled action, and the atomic-commits prompts), Change
   passphrase (the change itself, a mismatch, a wrong current passphrase, Cancel in the review, and
   that the dialog cannot be closed while working) and printing (`p5-print-loads` reads back the
   document the offscreen view loaded, `p5-print-dialog` opens the print dialog with Ctrl+P and
   closes it, `p5-print-system-font` and `p5-print-menu`). `p5-preferences-screenshots` saves
   `p5-preferences`, `p5-import-screenshots` saves `p5-import` and `p5-import-conflicts` and
   `p5-change-passphrase-screenshots` saves `p5-change-passphrase`, each narrow and wide, light and
   dark except `p5-import-conflicts` (wide, light); `p5-note-font-screenshot` saves `p5-note-font`
   (wide, light, with the Lora font). All use the violet accent. The UI harness runs with
   `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` (set in `ci/steps/ui-test.sh`), because WebKit's
   bubblewrap sandbox cannot create the namespaces it needs inside the build container; the app
   itself keeps the sandbox. The step also installs the `fonts` tag of the meson install into a
   scratch directory that it adds to `XDG_DATA_DIRS`, so the tests see the bundled fonts. A
   failing case saves
   `failure-<case>.png` there. Logs go to `apps/linux/out/logs/`, with per-case timings in
   `ui-testlog.txt`. The filter of `ui-test.sh` matches case names only. The harness sends real key
   events through mutter's remote desktop virtual keyboard: `press_keys("<Control>r")` presses one
   accelerator and `type_keys("text")` types ASCII text, both into the focused widget of the
   active window; older cases still drive some keys by calling the controllers and the Vim input
   method directly. The container has the Noto Color Emoji font, so screenshots show emoji.
4. On the host, the read-back: the crate tests and the UI case `editor_read_back` write scenarios
   (a repo made by the Rust runtime and what a reader should find in it) into `apps/linux/out/read-back`, and
   `npx tsx scripts/read-back-native-repo.ts apps/linux/out/read-back` has the shared TypeScript
   reader open every scenario there, so this step needs `npm ci` but no container. It proves the
   TypeScript side can read what the Linux app wrote, including a note typed in the editor and a
   note with images inserted through the Linux runtime (a large JPEG stored as WebP and a GIF kept as
   a GIF). The `linux data` scenario is a repository after an import, a note edit, a change of
   passphrase and an export, and the reader finds the notes, folder, images and device name in it;
   the crate test `key_changed_export_keeps_unsynced_edits` checks that the key-changed export keeps
   unsynced edits.

The crates that need no GTK (`commitnote-markdown`, `commitnote-editor-text`,
`commitnote-interaction` and `commitnote-core-api`) also build and test on a machine without the
development packages. From `apps/linux`, run `cargo test -p <crate> --locked` for a quick loop. The
container scripts stay the check that counts.

### Markdown vectors

The live-preview editor decides what to hide and style from the Markdown syntax tree. The web app
gets that tree from its CodeMirror editor (a lezer parser); the Linux app parses with
`pulldown-cmark`. `apps/linux/markdown-vectors/` proves the Rust renderer treats both the same way:
`corpus.json` holds sample Markdown documents, and `generate.ts` parses each one with the web
editor's real Markdown configuration and records the resulting syntax nodes in `vectors.json`.
`crates/markdown/tests/vectors.rs` renders every entry twice, from the web nodes and from the Rust
parse, for no selection and for a caret at the start of each line, and requires the same style runs
and placements. The differences the two parsers cannot avoid are listed in that test as allowed,
each with a reason, and each must still differ, so a fix that removes one has to remove it from the
list.

After changing the Markdown configuration of the web editor, or the corpus, regenerate the file from
the repository root and commit it:

```sh
npx tsx apps/linux/markdown-vectors/generate.ts
```

`lint.sh` runs the generator with `--check` and fails when `vectors.json` is stale.

`ui-test.sh` needs the packages that the container adds for tests, listed here for running the UI
tests on the host. They are needed only for that; the container has them already, and building and
running the app does not.

<!-- packages: test -->

```sh
sudo dnf install \
  adwaita-icon-theme \
  adwaita-mono-fonts \
  adwaita-sans-fonts \
  dbus-daemon \
  gnome-keyring \
  google-noto-color-emoji-fonts \
  mesa-dri-drivers \
  mutter
```

### Caches and resources

- Cargo's registry and git caches and the build output (`apps/linux/target`) live in Docker named
  volumes, so repeated runs are incremental. The registry and git volumes are shared; the target
  volume is per workspace (`commitnote-linux-target-<hash of the workspace path>`).
  `apps/linux/scripts/container.sh --remove-target-volume` deletes this workspace's target volume.
- `COMMITNOTE_LINUX_CACHE_DIR` replaces the three named volumes with `registry`, `git` and
  `target` directories under the given path (CI uses this to cache them).
- The container runs with 4 CPUs and 8 GB of memory. Override with `COMMITNOTE_DOCKER_CPUS` and
  `COMMITNOTE_DOCKER_MEMORY` (for example `COMMITNOTE_DOCKER_MEMORY=12g`).
- `apps/linux/scripts/container.sh <command...>` runs any command in the container from
  `apps/linux/`. `--print-image-tag` prints the image tag and `--write-context <dir>` writes the
  files the image is built from; CI uses both.
- Everything the scripts write for you to look at is under `apps/linux/out/` (`screenshots/`,
  `logs/`, `prefix/`, `host-prefix/`, `read-back/`), which git ignores.

## Profiles

| Profile       | App id                                  | Differences                                                                                                                      |
| ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `development` | `io.github.marcinjahn.commitnote.Devel` | The default. Name "commitnote (Devel)", a striped header bar, and a GSettings path, keyring item and XDG directories of its own. |
| `release`     | `io.github.marcinjahn.commitnote`       | The name "commitnote", the plain header bar, the production core bundle and no testing code.                                     |

The development build can run next to an installed release build without sharing settings, the
remembered session or cached data. The `testing` option is a development-only switch on top of the
profile (`-Dprofile=development -Dtesting=true`); the release profile rejects it.

## CI

The `Linux` workflow (`.github/workflows/linux.yml`) builds the container image and runs `build.sh`,
`lint.sh`, `test.sh` and `release-check.sh` in that order. It runs on:

- pushes to `main` and to `linux-ci/**` branches that touch the Linux app, the test vectors, the
  shared web sources and build configuration the core bundle is built from, the note font files in
  `apps/ios/Commitnote/Fonts/`, or the workflow itself (it is path-filtered; see `on.push.paths` in
  the workflow),
- manual dispatch (`workflow_dispatch`).

Push to a `linux-ci/**` branch to prove a build without touching `main`. A run is limited to 45
minutes. The cargo cache makes a warm run take about 3 minutes against about 15 for a cold one.

Every run uploads two artifacts, even when a step failed:

- `linux-screenshots` — the UI screenshots, including `failure-*.png` for failed cases,
- `linux-logs` — the mutter log (`mutter.log`) and the UI test log.

Both are kept for 30 days. To fetch them, name them, because a bare `gh run download` fails on the
`*.dockerbuild` artifact that the image build adds:

```sh
gh run download <run-id> -n linux-screenshots -n linux-logs
```
