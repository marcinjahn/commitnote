use std::fs;
use std::os::unix::fs::PermissionsExt;

use commitnote_core_runtime::services::DeviceSettingsStore;
use commitnote_core_runtime::services::device_settings::FileDeviceSettingsStore;

fn mode(path: &std::path::Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn items_survive_a_new_instance() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("config").join("device-settings.json");
    let mut store = FileDeviceSettingsStore::new(path.clone());
    assert_eq!(store.get_item("commitnote.theme"), None);

    store.set_item("commitnote.theme", "dark").unwrap();
    store.set_item("commitnote.sort", "name").unwrap();
    store.set_item("commitnote.theme", "light").unwrap();
    store.remove_item("commitnote.sort").unwrap();
    store.remove_item("commitnote.missing").unwrap();

    let mut reopened = FileDeviceSettingsStore::new(path.clone());
    assert_eq!(
        reopened.get_item("commitnote.theme").as_deref(),
        Some("light")
    );
    assert_eq!(reopened.get_item("commitnote.sort"), None);
    let stored: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(stored, serde_json::json!({"commitnote.theme": "light"}));
}

#[test]
fn invalid_json_yields_empty_and_is_replaced_on_write() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("device-settings.json");
    fs::write(&path, b"{not json").unwrap();

    let mut store = FileDeviceSettingsStore::new(path.clone());
    assert_eq!(store.get_item("anything"), None);
    assert_eq!(fs::read(&path).unwrap(), b"{not json");

    store.set_item("key", "value").unwrap();

    let mut reopened = FileDeviceSettingsStore::new(path);
    assert_eq!(reopened.get_item("key").as_deref(), Some("value"));
}

#[test]
fn json_of_the_wrong_shape_yields_empty() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("device-settings.json");
    fs::write(&path, br#"{"key": 5}"#).unwrap();

    let mut store = FileDeviceSettingsStore::new(path);

    assert_eq!(store.get_item("key"), None);
}

#[test]
fn file_is_owner_only_in_a_private_directory() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("app");
    let path = directory.join("device-settings.json");
    let previous = unsafe { libc::umask(0) };
    let mut store = FileDeviceSettingsStore::new(path.clone());
    store.set_item("key", "value").unwrap();
    unsafe { libc::umask(previous) };

    assert_eq!(mode(&directory), 0o700);
    assert_eq!(mode(&path), 0o600);
    let names: Vec<_> = fs::read_dir(&directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, vec!["device-settings.json"]);
}
