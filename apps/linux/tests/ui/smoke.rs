use std::process::Command;

use adw::prelude::*;
use commitnote::editor::NoteEditor;
use gtk4::{gio, glib};
use libadwaita as adw;

use crate::flows::{
    ensure, exported_main, first_top_level_note, launch_and_log_in, open_first_note,
    wait_exported_change, wait_open_note,
};
use crate::p2::EDITOR;
use crate::p3::open_note_at;
use crate::support::{Case, Harness, descendants};

pub const CASES: &[Case] = &[
    ("smoke-launch", launch),
    ("smoke-log-in-without-keyring", log_in_without_keyring),
    ("smoke-open-edit-save", open_edit_save),
    ("smoke-decorations", decorations),
];

const NO_KEYRING_MESSAGE: &str = "No keyring is available, so this session will not be remembered.";
const TYPED: &str = "typed under sway ";

fn launch(h: &mut Harness) -> Result<(), String> {
    ensure(!secret_service_has_owner()?, || {
        "org.freedesktop.secrets has an owner on the session bus".to_owned()
    })?;
    println!("org.freedesktop.secrets has no owner on the session bus");
    h.launch()?;
    h.wait_page("token")?;
    let windows = h.application().windows();
    ensure(windows.len() == 1, || {
        format!("expected one app window, found {}", windows.len())
    })?;
    ensure(h.window()?.is_mapped(), || {
        "the app window is not mapped".to_owned()
    })
}

fn log_in_without_keyring(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    ensure(!h.model()?.keyring_available(), || {
        "the model reports a keyring".to_owned()
    })?;
    h.wait("the no-keyring message", || {
        h.label_shown_with(NO_KEYRING_MESSAGE)
    })?;

    h.launch()?;
    h.wait_page("token")
}

fn open_edit_save(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    let buffer = editor.view().buffer();
    buffer.insert(&mut buffer.end_iter(), TYPED);
    let text = editor.text();
    h.window_action("save-now")?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, &text)?;

    let (_, path) = first_top_level_note(h)?;
    let path: Vec<&str> = path.iter().map(String::as_str).collect();
    h.model()?.open_note(None);
    open_note_at(h, &path)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the saved text in the editor", || {
        editor.text().contains(TYPED)
    })
}

fn decorations(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    h.wait_page("token")?;
    let mut view = None;
    h.wait("sway to float the app window", || {
        view = sway_view(std::process::id()).filter(|view| view["type"] == "floating_con");
        view.is_some()
    })?;
    let view = view.expect("the wait succeeded, so the view was found");
    let border = view["border"].as_str();
    let title_bar_height = view["deco_rect"]["height"].as_u64();
    ensure(border == Some("csd") && title_bar_height == Some(0), || {
        format!(
            "sway reports the floating window border {border:?} with a title bar of {title_bar_height:?} px, expected \"csd\" and 0 px"
        )
    })?;
    println!("sway reports the window border \"csd\" with a 0 px title bar");
    let window = h.window()?;
    ensure(
        descendants(window.upcast_ref())
            .iter()
            .any(|widget| widget.is::<adw::HeaderBar>() && widget.is_mapped()),
        || "the window shows no header bar".to_owned(),
    )
}

fn secret_service_has_owner() -> Result<bool, String> {
    let connection = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>)
        .map_err(|error| format!("cannot reach the session bus: {error}"))?;
    let reply = connection
        .call_sync(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
            Some(&("org.freedesktop.secrets",).to_variant()),
            Some(glib::VariantTy::new("(b)").expect("a valid type")),
            gio::DBusCallFlags::NONE,
            5_000,
            None::<&gio::Cancellable>,
        )
        .map_err(|error| format!("cannot ask the bus for the Secret Service owner: {error}"))?;
    reply
        .child_value(0)
        .get::<bool>()
        .ok_or_else(|| "the bus returned no owner answer".to_owned())
}

fn sway_view(pid: u32) -> Option<serde_json::Value> {
    let output = Command::new("swaymsg")
        .args(["-t", "get_tree"])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let tree: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    find_view(&tree, u64::from(pid)).cloned()
}

fn find_view(node: &serde_json::Value, pid: u64) -> Option<&serde_json::Value> {
    if node["pid"].as_u64() == Some(pid) {
        return Some(node);
    }
    ["nodes", "floating_nodes"]
        .into_iter()
        .filter_map(|key| node[key].as_array())
        .flatten()
        .find_map(|child| find_view(child, pid))
}
