use crate::flows::{ensure, launch_and_log_in};
use crate::p2::{save_now, set_note_text, wait_echo};
use crate::p3::action_enabled;
use crate::p4::{WHITEBOARD, open_editor, references, wait_images_ready};
use crate::p5::{PRINT_NOTE, close_print_dialog, print_note, printed_document, wait_print_dialog};
use crate::support::Harness;

const PRINTED_NAME: &str = "Whiteboard";
const HEADER_CELLS: [&str; 3] = ["Item", "Qty", "Note"];
const BODY_CELLS: [&str; 3] = ["tea", "2", "kettle"];

fn note(image: &str) -> String {
    format!(
        "Before the table.\n\n| Item | Qty | Note |\n| :-- | :-: | --: |\n| tea | 2 | kettle |\n\
         | {image} | 1 | picture |\n\nAfter the table."
    )
}

pub(super) fn print(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WHITEBOARD)?;
    wait_images_ready(h, &editor, 1)?;
    let [image]: [String; 1] = references(&editor.text())
        .try_into()
        .map_err(|found| format!("the whiteboard holds the references {found:?}"))?;
    let note = note(&image);
    set_note_text(&editor, &note, 0, 0);
    wait_echo(h, &note)?;
    save_now(h)?;
    h.wait("printing to be enabled", || {
        action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;

    print_note(h)?;
    let dialog = wait_print_dialog(h)?;
    let document = printed_document(PRINTED_NAME)?;
    close_print_dialog(h, &dialog)?;
    let table = document
        .find("<table")
        .map(|start| &document[start..])
        .ok_or("the print document holds no table")?;
    for cell in HEADER_CELLS.iter().chain(&BODY_CELLS) {
        ensure(table.contains(&format!(">{cell}<")), || {
            format!("the printed table has no {cell:?} cell")
        })?;
    }
    ensure(table.contains("data:image/"), || {
        "the printed table holds no inline image".to_owned()
    })
}
