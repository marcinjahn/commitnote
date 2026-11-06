use adw::prelude::*;
use commitnote_core_api::settings::{DataCopy, SettingsCopy};
use gtk4::glib;
use libadwaita as adw;

pub(super) struct Data {
    pub(super) group: adw::PreferencesGroup,
    export: adw::ButtonRow,
    import: adw::ButtonRow,
    copy: DataCopy,
}

impl Data {
    pub(super) fn new(copy: &SettingsCopy) -> Self {
        let group = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.sections.data_security))
            .build();
        let export = export_row(copy);
        let import = import_row(copy);
        group.add(&export);
        group.add(&import);
        Self {
            group,
            export,
            import,
            copy: copy.data.clone(),
        }
    }

    pub(super) fn show_export(&self, exporting: bool) {
        self.export.set_title(if exporting {
            &self.copy.exporting_label
        } else {
            &self.copy.export_label
        });
    }

    pub(super) fn show_import(&self, importing: bool) {
        self.import.set_title(if importing {
            &self.copy.importing_label
        } else {
            &self.copy.import_label
        });
    }
}

fn export_row(copy: &SettingsCopy) -> adw::ButtonRow {
    adw::ButtonRow::builder()
        .name("settings-export")
        .title(&copy.data.export_label)
        .action_name("win.export-notes")
        .build()
}

fn import_row(copy: &SettingsCopy) -> adw::ButtonRow {
    adw::ButtonRow::builder()
        .name("settings-import")
        .title(&copy.data.import_label)
        .action_name("win.import-notes")
        .build()
}
