use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{
    NoteFontCopy, ScopedSettingKey, SettingKeyView, SettingOptionView, SettingsCopy, SettingsView,
};
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::binding::Binding;
use super::rows::Choice;
use super::scope;
use super::swatches::Swatches;
use crate::editor::MarkdownView;
use crate::fonts::NoteFont;

pub(super) struct Appearance {
    pub(super) group: adw::PreferencesGroup,
    color_mode: Choice,
    color_mode_scope: adw::ToggleGroup,
    swatches: Swatches,
    accent_scope: adw::ToggleGroup,
    note_font: Choice,
    note_font_scope: adw::ToggleGroup,
    preview: MarkdownView,
}

impl Appearance {
    pub(super) fn new(binding: &Rc<Binding>, copy: &SettingsCopy) -> Self {
        let group = adw::PreferencesGroup::builder()
            .title(glib::markup_escape_text(&copy.sections.appearance))
            .build();

        let color_mode = Choice::new(
            binding,
            SettingKeyView::ColorMode,
            &copy.color_mode.label,
            &copy.color_mode.options,
            "settings-color-mode",
        );
        color_mode.row.set_use_subtitle(true);
        let color_mode_scope =
            scope::toggles(binding, &copy.scope_labels, ScopedSettingKey::ColorMode);
        color_mode.row.add_suffix(&color_mode_scope);
        group.add(&color_mode.row);

        let swatches = Swatches::new(binding, &copy.accent_color.options);
        let accent_scope =
            scope::toggles(binding, &copy.scope_labels, ScopedSettingKey::AccentColor);
        group.add(&wide_row(
            &copy.accent_color.label,
            &accent_scope,
            &swatches.wrap,
        ));

        let note_font = Choice::new(
            binding,
            SettingKeyView::NoteFont,
            &copy.note_font.label,
            &copy.note_font.options,
            "settings-note-font",
        );
        note_font.row.set_use_subtitle(true);
        note_font
            .row
            .set_list_factory(Some(&font_list_factory(&copy.note_font.options)));
        let note_font_scope =
            scope::toggles(binding, &copy.scope_labels, ScopedSettingKey::NoteFont);
        note_font.row.add_suffix(&note_font_scope);
        group.add(&note_font.row);

        let preview = font_preview(&copy.note_font);
        let preview_frame = gtk::Box::builder()
            .css_classes(["font-preview"])
            .margin_top(12)
            .margin_bottom(12)
            .margin_start(12)
            .margin_end(12)
            .build();
        preview_frame.append(&preview);
        group.add(
            &adw::PreferencesRow::builder()
                .title(&copy.note_font.label)
                .use_markup(false)
                .activatable(false)
                .focusable(false)
                .child(&preview_frame)
                .build(),
        );

        Self {
            group,
            color_mode,
            color_mode_scope,
            swatches,
            accent_scope,
            note_font,
            note_font_scope,
            preview,
        }
    }

    pub(super) fn show(&self, view: &SettingsView) {
        self.color_mode.show(&view.values.color_mode);
        scope::show(&self.color_mode_scope, view.scopes.color_mode);
        self.swatches.show(&view.values.accent_color);
        scope::show(&self.accent_scope, view.scopes.accent_color);
        self.note_font.show(&view.values.note_font);
        scope::show(&self.note_font_scope, view.scopes.note_font);
        self.preview
            .set_note_font(NoteFont::from_id(&view.values.note_font));
    }

    /// Repaints the swatches after the desktop's style or accent colour changes.
    pub(super) fn follow_style(&self) {
        self.swatches.paint();
    }

    /// Scope toggles that stack their two choices on narrow dialogs, where side by side they
    /// would squeeze the row's title.
    pub(super) fn inline_scopes(&self) -> [&adw::ToggleGroup; 2] {
        [&self.color_mode_scope, &self.note_font_scope]
    }
}

/// A row whose title line carries the scope toggles, with its wide content on the lines below.
fn wide_row(
    title: &str,
    scope: &adw::ToggleGroup,
    content: &impl IsA<gtk::Widget>,
) -> adw::PreferencesRow {
    let header = gtk::Box::builder().spacing(12).build();
    header.append(
        &gtk::Label::builder()
            .label(title)
            .xalign(0.0)
            .hexpand(true)
            .wrap(true)
            .css_classes(["title"])
            .build(),
    );
    header.append(scope);
    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    body.append(&header);
    body.append(content);
    adw::PreferencesRow::builder()
        .title(title)
        .use_markup(false)
        .activatable(false)
        .focusable(false)
        .child(&body)
        .build()
}

/// Lists each note font in its own typeface, with the core's description below it.
fn font_list_factory(options: &[SettingOptionView]) -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, item| {
        let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        let label = gtk::Label::builder().xalign(0.0).build();
        let description = gtk::Label::builder()
            .xalign(0.0)
            .wrap(true)
            .css_classes(["caption", "dim-label"])
            .build();
        let lines = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .spacing(2)
            .build();
        lines.append(&label);
        lines.append(&description);
        item.set_child(Some(&lines));
    });
    let options = options.to_vec();
    factory.connect_bind(move |_, item| {
        let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        let option = usize::try_from(item.position())
            .ok()
            .and_then(|position| options.get(position));
        let lines = item.child();
        let label = lines.as_ref().and_then(gtk::Widget::first_child);
        let description = label.as_ref().and_then(gtk::Widget::next_sibling);
        let (Some(option), Some(label), Some(description)) = (
            option,
            label.and_downcast::<gtk::Label>(),
            description.and_downcast::<gtk::Label>(),
        ) else {
            return;
        };
        label.set_label(&option.label);
        NoteFont::from_id(&option.id).apply_to(&label);
        description.set_label(option.description.as_deref().unwrap_or_default());
        description.set_visible(option.description.is_some());
    });
    factory
}

/// The editor's own rendering of the core's sample note, in the chosen note font. The caret rests
/// on the blank second line, so no paragraph reveals its markdown markers.
fn font_preview(copy: &NoteFontCopy) -> MarkdownView {
    let preview = MarkdownView::new();
    preview.set_widget_name("settings-font-preview");
    preview.set_can_focus(false);
    preview.set_can_target(false);
    preview.set_hexpand(true);
    let buffer = preview.source_buffer();
    buffer.set_text(&preview_text(copy));
    if let Some(blank) = buffer.iter_at_line(1) {
        buffer.place_cursor(&blank);
    }
    preview
}

fn preview_text(copy: &NoteFontCopy) -> String {
    format!(
        "# {}\n\n{}\n\n{}",
        copy.preview_heading, copy.preview_body, copy.preview_code
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_text_puts_heading_body_and_code_in_separate_paragraphs() {
        let copy = NoteFontCopy {
            label: "Note font".to_owned(),
            options: Vec::new(),
            preview_heading: "Weekly notes".to_owned(),
            preview_body: "A **clear** list.".to_owned(),
            preview_code: "Run `cargo clippy`.".to_owned(),
        };
        assert_eq!(
            preview_text(&copy),
            "# Weekly notes\n\nA **clear** list.\n\nRun `cargo clippy`."
        );
    }
}
