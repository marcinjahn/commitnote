use std::cell::{OnceCell, RefCell};
use std::sync::OnceLock;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_core_api::commands::{SearchResults, SearchRow};
use commitnote_core_api::shapes::TagOptionView;
use glib::subclass::Signal;
use gtk4::{self as gtk, gdk, glib, pango};
use libadwaita as adw;

use super::search_logic::{name_attributes, snippet_markup};
use super::tree_logic::{note_description, tag_id, tag_label};
use crate::accent;
use crate::model::{AppModel, SearchStatus};

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct SearchView {
        pub(super) count: gtk::Label,
        pub(super) stack: gtk::Stack,
        pub(super) list: gtk::ListBox,
        pub(super) no_matches: adw::StatusPage,
        pub(super) status_box: gtk::Box,
        pub(super) status: gtk::Label,
        pub(super) still_reading: gtk::Label,
        pub(super) progress: gtk::ProgressBar,
        pub(super) hint: gtk::Label,
        pub(super) paths: RefCell<Vec<Option<Vec<String>>>>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) accent_probe: OnceCell<gtk::Label>,
        pub(super) style_handlers: RefCell<Vec<glib::SignalHandlerId>>,
        pub(super) restyle_source: RefCell<Option<glib::SourceId>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for SearchView {
        const NAME: &'static str = "CommitnoteSearchView";
        type Type = super::SearchView;
        type ParentType = adw::Bin;
    }

    impl ObjectImpl for SearchView {
        fn signals() -> &'static [Signal] {
            static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
            SIGNALS.get_or_init(|| {
                vec![
                    Signal::builder("result-activated")
                        .param_types([glib::StrV::static_type()])
                        .build(),
                ]
            })
        }

        fn constructed(&self) {
            self.parent_constructed();
            let view = self.obj();
            view.set_widget_name("search-view");

            self.count.set_widget_name("search-count");
            self.count.set_xalign(0.0);
            self.count.set_wrap(true);
            self.count.set_margin_start(12);
            self.count.set_margin_end(12);
            self.count.set_margin_top(6);
            self.count.set_margin_bottom(6);
            self.count.add_css_class("dim-label");
            self.count.add_css_class("caption");

            self.list.set_widget_name("search-results-list");
            self.list.set_selection_mode(gtk::SelectionMode::Single);
            self.list.set_activate_on_single_click(true);
            self.list.add_css_class("navigation-sidebar");
            self.list.connect_row_activated({
                let view = view.downgrade();
                move |_, row| {
                    if let Some(view) = view.upgrade() {
                        view.activate_row(row.index());
                    }
                }
            });

            let scrolled = gtk::ScrolledWindow::builder()
                .hscrollbar_policy(gtk::PolicyType::Never)
                .vexpand(true)
                .child(&self.list)
                .build();

            self.no_matches.set_widget_name("search-no-matches");
            self.no_matches
                .set_icon_name(Some("system-search-symbolic"));
            self.no_matches.add_css_class("compact");

            self.stack.add_named(&scrolled, Some("results"));
            self.stack.add_named(&self.no_matches, Some("empty"));
            self.stack.set_vexpand(true);

            self.status_box.set_widget_name("search-status");
            self.status_box.set_orientation(gtk::Orientation::Vertical);
            self.status_box.set_spacing(6);
            self.status_box.set_margin_start(12);
            self.status_box.set_margin_end(12);
            self.status_box.set_margin_top(6);
            self.status_box.set_margin_bottom(6);
            for label in [&self.status, &self.still_reading, &self.hint] {
                label.set_xalign(0.0);
                label.set_wrap(true);
                label.add_css_class("dim-label");
                label.add_css_class("caption");
            }
            self.status_box.append(&self.status);
            self.status_box.append(&self.still_reading);
            self.status_box.append(&self.progress);
            self.status_box.append(&self.hint);

            let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
            content.append(&self.count);
            content.append(&self.stack);
            content.append(&self.status_box);
            let probe = accent::probe();
            content.append(&probe);
            let _ = self.accent_probe.set(probe);
            view.set_child(Some(&content));

            let style_manager = adw::StyleManager::default();
            let handlers = vec![
                style_manager.connect_dark_notify({
                    let view = view.downgrade();
                    move |_| {
                        if let Some(view) = view.upgrade() {
                            view.queue_restyle();
                        }
                    }
                }),
                style_manager.connect_accent_color_rgba_notify({
                    let view = view.downgrade();
                    move |_| {
                        if let Some(view) = view.upgrade() {
                            view.queue_restyle();
                        }
                    }
                }),
            ];
            self.style_handlers.replace(handlers);
            view.connect_root_notify(|view| view.queue_restyle());
            view.render();
        }

        fn dispose(&self) {
            let style_manager = adw::StyleManager::default();
            for handler in self.style_handlers.take() {
                style_manager.disconnect(handler);
            }
            if let Some(source) = self.restyle_source.take() {
                source.remove();
            }
            if let (Some(model), Some(id)) = (self.model.get(), self.handler.take()) {
                model.disconnect(id);
            }
        }
    }

    impl WidgetImpl for SearchView {}
    impl BinImpl for SearchView {}
}

glib::wrapper! {
    pub struct SearchView(ObjectSubclass<imp::SearchView>)
        @extends adw::Bin, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl SearchView {
    pub fn new() -> Self {
        glib::Object::new()
    }

    pub fn bind(&self, model: &AppModel) {
        let imp = self.imp();
        if imp.model.set(model.clone()).is_err() {
            return;
        }
        let id = model.connect_search_changed({
            let view = self.downgrade();
            move |_| {
                if let Some(view) = view.upgrade() {
                    view.render();
                }
            }
        });
        imp.handler.replace(Some(id));
        self.render();
    }

    pub fn connect_result_activated<F: Fn(&Self, Vec<String>) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local("result-activated", false, move |args| {
            let view = args[0].get::<Self>().ok()?;
            let path = args[1].get::<Vec<String>>().ok()?;
            f(&view, path);
            None
        })
    }

    pub fn focus_first_result(&self) -> bool {
        let imp = self.imp();
        let first = imp.paths.borrow().iter().position(Option::is_some);
        let Some(row) = first.and_then(|index| imp.list.row_at_index(index as i32)) else {
            return false;
        };
        imp.list.select_row(Some(&row));
        row.grab_focus()
    }

    pub fn activate_first_result(&self) -> bool {
        let first = self.imp().paths.borrow().iter().position(Option::is_some);
        let Some(index) = first else {
            return false;
        };
        self.activate_row(index as i32);
        true
    }

    fn activate_row(&self, index: i32) {
        let path = usize::try_from(index)
            .ok()
            .and_then(|index| self.imp().paths.borrow().get(index).cloned().flatten());
        if let Some(path) = path {
            self.emit_by_name::<()>("result-activated", &[&path]);
        }
    }

    fn queue_restyle(&self) {
        let imp = self.imp();
        if imp.restyle_source.borrow().is_some() {
            return;
        }
        let source = glib::idle_add_local_once({
            let view = self.downgrade();
            move || {
                if let Some(view) = view.upgrade() {
                    view.imp().restyle_source.take();
                    view.render();
                }
            }
        });
        imp.restyle_source.replace(Some(source));
    }

    pub fn highlight_accent(&self) -> gdk::RGBA {
        self.imp()
            .accent_probe
            .get()
            .map_or_else(|| self.color(), accent::color)
    }

    fn render(&self) {
        let imp = self.imp();
        let model = imp.model.get();
        let results = model.and_then(AppModel::search_results);
        let status = model.and_then(AppModel::search_status);
        let query_empty = model.is_none_or(|model| model.search_query().is_empty());
        let tag_options = model.map(AppModel::tag_options).unwrap_or_default();

        let selected = imp
            .list
            .selected_row()
            .and_then(|row| usize::try_from(row.index()).ok())
            .and_then(|index| imp.paths.borrow().get(index).cloned().flatten());
        let had_focus = imp.list.focus_child().is_some();

        self.render_list(results.as_ref(), &tag_options, &self.highlight_accent());
        self.render_count(results.as_ref());
        self.render_stack(results.as_ref(), query_empty);
        self.render_status(results.as_ref(), status.as_ref(), query_empty);

        if let Some(selected) = selected {
            let position = imp
                .paths
                .borrow()
                .iter()
                .position(|path| path.as_ref() == Some(&selected));
            if let Some(row) = position.and_then(|index| imp.list.row_at_index(index as i32)) {
                imp.list.select_row(Some(&row));
                if had_focus {
                    row.grab_focus();
                }
            }
        }
    }

    fn render_list(
        &self,
        results: Option<&SearchResults>,
        tag_options: &[TagOptionView],
        accent: &gdk::RGBA,
    ) {
        let imp = self.imp();
        imp.list.remove_all();
        let mut paths = Vec::new();
        if let Some(results) = results {
            if !results.recent.is_empty() {
                self.append_section(
                    &results.copy.recent_heading,
                    &results.recent,
                    None,
                    tag_options,
                    accent,
                    &mut paths,
                );
            } else {
                self.append_section(
                    &results.copy.names_heading,
                    &results.names,
                    results.names_more.as_deref(),
                    tag_options,
                    accent,
                    &mut paths,
                );
                self.append_section(
                    &results.copy.contents_heading,
                    &results.contents,
                    results.contents_more.as_deref(),
                    tag_options,
                    accent,
                    &mut paths,
                );
            }
        }
        imp.paths.replace(paths);
    }

    fn append_section(
        &self,
        heading: &str,
        rows: &[SearchRow],
        more: Option<&str>,
        tag_options: &[TagOptionView],
        accent: &gdk::RGBA,
        paths: &mut Vec<Option<Vec<String>>>,
    ) {
        if rows.is_empty() {
            return;
        }
        let list = &self.imp().list;
        list.append(&heading_row(heading));
        paths.push(None);
        for row in rows {
            list.append(&result_row(row, tag_options, accent));
            paths.push(Some(row.path.clone()));
        }
        if let Some(more) = more {
            list.append(&more_row(more));
            paths.push(None);
        }
    }

    fn render_count(&self, results: Option<&SearchResults>) {
        let count = &self.imp().count;
        let text = results.and_then(|results| results.count_text.as_deref());
        count.set_label(text.unwrap_or_default());
        count.set_visible(text.is_some());
    }

    fn render_stack(&self, results: Option<&SearchResults>, query_empty: bool) {
        let imp = self.imp();
        let no_matches = results.map_or("", |results| results.copy.no_matches.as_str());
        let empty = !no_matches.is_empty() && imp.paths.borrow().is_empty() && !query_empty;
        imp.no_matches.set_title(no_matches);
        imp.stack
            .set_visible_child_name(if empty { "empty" } else { "results" });
    }

    fn render_status(
        &self,
        results: Option<&SearchResults>,
        status: Option<&SearchStatus>,
        query_empty: bool,
    ) {
        let imp = self.imp();
        let text = status.and_then(|status| status.status.as_deref());
        let partial = status.is_some_and(|status| status.partial);
        let progress = status.and_then(|status| status.progress);

        imp.status.set_label(text.unwrap_or_default());
        imp.status.set_visible(text.is_some());

        let still_reading = results.map(|results| results.copy.still_reading.as_str());
        imp.still_reading
            .set_label(still_reading.unwrap_or_default());
        let show_still_reading = partial && still_reading.is_some();
        imp.still_reading.set_visible(show_still_reading);

        if let Some(fraction) = progress {
            imp.progress.set_fraction(fraction.clamp(0.0, 1.0));
        }
        imp.progress.set_visible(progress.is_some());

        let hint = results
            .map(|results| results.copy.hint.as_str())
            .filter(|_| query_empty);
        imp.hint.set_label(hint.unwrap_or_default());
        imp.hint.set_visible(hint.is_some());

        imp.status_box.set_visible(
            text.is_some() || show_still_reading || progress.is_some() || hint.is_some(),
        );
    }
}

impl Default for SearchView {
    fn default() -> Self {
        Self::new()
    }
}

fn heading_row(text: &str) -> gtk::ListBoxRow {
    let label = gtk::Label::new(Some(text));
    label.set_xalign(0.0);
    label.set_ellipsize(pango::EllipsizeMode::End);
    label.set_margin_start(6);
    label.set_margin_end(6);
    label.set_margin_top(6);
    label.set_margin_bottom(2);
    label.add_css_class("heading");
    label.add_css_class("dim-label");
    inert_row(&label)
}

fn more_row(text: &str) -> gtk::ListBoxRow {
    let label = gtk::Label::new(Some(text));
    label.set_xalign(0.0);
    label.set_wrap(true);
    label.set_margin_start(6);
    label.set_margin_end(6);
    label.set_margin_top(2);
    label.set_margin_bottom(6);
    label.add_css_class("dim-label");
    label.add_css_class("caption");
    inert_row(&label)
}

fn inert_row(child: &impl IsA<gtk::Widget>) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    row.set_activatable(false);
    row.set_selectable(false);
    row.set_child(Some(child));
    row
}

fn result_row(
    result: &SearchRow,
    tag_options: &[TagOptionView],
    accent: &gdk::RGBA,
) -> gtk::ListBoxRow {
    let name = gtk::Label::new(Some(&result.name));
    name.set_xalign(0.0);
    name.set_hexpand(true);
    name.set_ellipsize(pango::EllipsizeMode::End);
    name.set_attributes(Some(&name_attributes(&result.name, &result.name_ranges)));

    let top = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    top.append(&name);
    if let Some(tag) = result.color_tag {
        let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        dot.add_css_class("tag-dot");
        dot.add_css_class(&format!("tag-{}", tag_id(tag)));
        dot.set_size_request(10, 10);
        dot.set_valign(gtk::Align::Center);
        top.append(&dot);
    }

    let body = gtk::Box::new(gtk::Orientation::Vertical, 2);
    body.set_margin_top(4);
    body.set_margin_bottom(4);
    body.append(&top);

    let mut description = Vec::new();
    if let Some(tag) = result.color_tag {
        description.push(note_description(Some(&tag_label(tag, tag_options)), false));
    }
    if let Some(folder) = &result.folder {
        let label = gtk::Label::new(Some(folder));
        label.set_xalign(0.0);
        label.set_ellipsize(pango::EllipsizeMode::End);
        label.add_css_class("dim-label");
        label.add_css_class("caption");
        body.append(&label);
        description.push(folder.clone());
    }
    if let Some(parts) = &result.snippet {
        let (text, attrs) = snippet_markup(parts, accent);
        let label = gtk::Label::new(Some(&text));
        label.set_attributes(Some(&attrs));
        label.set_xalign(0.0);
        label.set_ellipsize(pango::EllipsizeMode::End);
        label.add_css_class("caption");
        body.append(&label);
        description.push(text);
    }

    let row = gtk::ListBoxRow::new();
    row.set_child(Some(&body));
    row.update_property(&[
        gtk::accessible::Property::Label(&result.name),
        gtk::accessible::Property::Description(&description.join(", ")),
    ]);
    row
}
