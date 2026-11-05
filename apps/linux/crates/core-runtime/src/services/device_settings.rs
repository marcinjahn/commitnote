use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use super::blob_cache::write_atomically;
use super::{DeviceSettingsStore, LogLevel, Logger, ServiceError};
use crate::memory::GLibLogger;

const SAVE_FAILED: &str = "Device settings could not be saved";

pub struct FileDeviceSettingsStore {
    path: PathBuf,
    items: BTreeMap<String, String>,
}

impl FileDeviceSettingsStore {
    pub fn new(path: PathBuf) -> Self {
        let items = match fs::read(&path) {
            Ok(data) => serde_json::from_slice(&data).unwrap_or_else(|_| {
                GLibLogger.log(
                    LogLevel::Warn,
                    "Device settings file is invalid and will be replaced",
                );
                BTreeMap::new()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(_) => {
                GLibLogger.log(
                    LogLevel::Warn,
                    "Device settings file is unreadable and will be replaced",
                );
                BTreeMap::new()
            }
        };
        Self { path, items }
    }

    fn save(&self) -> Result<(), ServiceError> {
        let data = serde_json::to_vec(&self.items).map_err(|_| ServiceError::new(SAVE_FAILED))?;
        write_atomically(&self.path, &data).map_err(|_| ServiceError::new(SAVE_FAILED))
    }
}

impl DeviceSettingsStore for FileDeviceSettingsStore {
    fn get_item(&mut self, key: &str) -> Option<String> {
        self.items.get(key).cloned()
    }

    fn set_item(&mut self, key: &str, value: &str) -> Result<(), ServiceError> {
        self.items.insert(key.to_owned(), value.to_owned());
        self.save()
    }

    fn remove_item(&mut self, key: &str) -> Result<(), ServiceError> {
        self.items.remove(key);
        self.save()
    }
}
