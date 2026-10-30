use std::cell::{Cell, OnceCell, RefCell};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, gio, glib};
use libadwaita as adw;

use crate::close_guard::{
    CloseScope, CloseStep, Inhibitor, LOGOUT_INHIBIT_REASON, LogoutInhibit, UNSAVED_HEADING,
    after_flush, on_close_request, should_inhibit_logout, unsaved_body,
};
use crate::config;
use crate::model::lifecycle::Lifecycle;
use crate::model::{
    AppModel, DraftFocus, LoadingFailure, LogOutResult, NoticeView, Route, UserError,
};
use crate::pages::StartupErrorPage;
use crate::pages::login::{RepositoryListPage, TokenPage, UnusableRepositoryPage};
use crate::pages::notes::NotesPage;
use crate::pages::unlock::{InitializePage, KeyChangedPage, LoadingPage, UnlockPage};

const SPINNER_DELAY: Duration = Duration::from_millis(300);
const NOTICE_TIMEOUT_SECONDS: u32 = 4;

mod imp {
    use super::*;

    #[derive(Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/window.ui")]
    pub struct CommitnoteWindow {
        #[template_child]
        pub(super) toast_overlay: TemplateChild<adw::ToastOverlay>,
        #[template_child]
        pub(super) navigation_view: TemplateChild<adw::NavigationView>,
        #[template_child]
        pub(super) starting_page: TemplateChild<adw::NavigationPage>,
        #[template_child]
        pub(super) starting_spinner: TemplateChild<adw::Spinner>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) toasts: RefCell<HashMap<String, adw::Toast>>,
        pub(super) applying_route: Cell<bool>,
        pub(super) lifecycle: RefCell<Option<Lifecycle>>,
        pub(super) close_released: Cell<bool>,
        pub(super) guarding_close: Cell<bool>,
        pub(super) logging_out: Cell<bool>,
        pub(super) logout_inhibit: RefCell<Option<LogoutInhibit<WindowInhibitor>>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for CommitnoteWindow {
        const NAME: &'static str = "CommitnoteWindow";
        type Type = super::CommitnoteWindow;
        type ParentType = adw::ApplicationWindow;

        fn class_init(klass: &mut Self::Class) {
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for CommitnoteWindow {
        fn constructed(&self) {
            self.parent_constructed();
            let window = self.obj();
            if config::is_development() {
                window.add_css_class("devel");
            }
            window.restore_state();
        }

        fn dispose(&self) {
            self.lifecycle.take();
            self.logout_inhibit.take();
        }
    }

    impl WidgetImpl for CommitnoteWindow {}

    impl WindowImpl for CommitnoteWindow {
        fn close_request(&self) -> glib::Propagation {
            let window = self.obj();
            window.save_state();
            let scope =
                self.model
                    .get()
                    .map_or(CloseScope::Elsewhere, |model| match model.route() {
                        Route::Notes => CloseScope::Notes,
                        Route::Loading { .. } if model.has_early_draft_text() => {
                            CloseScope::EarlyDraft
                        }
                        _ => CloseScope::Elsewhere,
                    });
            match on_close_request(self.close_released.get(), self.guarding_close.get(), scope) {
                CloseStep::CloseNow => {
                    self.close_released.set(true);
                    self.logout_inhibit.take();
                    self.parent_close_request()
                }
                CloseStep::Flush => {
                    window.flush_and_close();
                    glib::Propagation::Stop
                }
                CloseStep::AskEarlyDraft => {
                    window.ask_to_quit_early_draft();
                    glib::Propagation::Stop
                }
                CloseStep::Ignore | CloseStep::Ask { .. } => glib::Propagation::Stop,
            }
        }
    }

    impl ApplicationWindowImpl for CommitnoteWindow {}
    impl AdwApplicationWindowImpl for CommitnoteWindow {}
}

glib::wrapper! {
    pub struct CommitnoteWindow(ObjectSubclass<imp::CommitnoteWindow>)
        @extends adw::ApplicationWindow, gtk::ApplicationWindow, gtk::Window, gtk::Widget,
        @implements gio::ActionGroup, gio::ActionMap, gtk::Accessible, gtk::Buildable,
            gtk::ConstraintTarget, gtk::Native, gtk::Root, gtk::ShortcutManager;
}

impl CommitnoteWindow {
    pub fn new(application: &adw::Application, model: &AppModel) -> Self {
        let window: Self = glib::Object::builder()
            .property("application", application)
            .build();
        let imp = window.imp();
        let _ = imp.model.set(model.clone());
        window.setup_actions();
        window.setup_type_to_start();
        application.set_accels_for_action("win.save-now", &["<Control>s"]);
        application.set_accels_for_action("win.new-note", &["<Control>n"]);
        application.set_accels_for_action("window.close", &["<Control>w"]);
        application.set_accels_for_action("win.quit", &["<Control>q"]);
        imp.logout_inhibit
            .replace(Some(LogoutInhibit::new(WindowInhibitor {
                application: application.clone().upcast(),
                window: window.downgrade(),
            })));
        window.connect_model();
        window.update_logout_inhibit();
        imp.lifecycle
            .replace(Some(Lifecycle::attach(&window, model)));
        imp.navigation_view.connect_popped({
            let window = window.downgrade();
            move |_, _| {
                if let Some(window) = window.upgrade()
                    && !window.imp().applying_route.get()
                {
                    window.model().navigated_back();
                }
            }
        });
        if model.route() == Route::Starting {
            glib::timeout_add_local_once(SPINNER_DELAY, {
                let window = window.downgrade();
                move || {
                    if let Some(window) = window.upgrade()
                        && window.model().route() == Route::Starting
                    {
                        window.imp().starting_spinner.set_visible(true);
                    }
                }
            });
        }
        window.apply_route();
        window
    }

    fn model(&self) -> &AppModel {
        self.imp()
            .model
            .get()
            .expect("the window is created with a model")
    }

    fn setup_actions(&self) {
        let log_out = gio::ActionEntry::builder("log-out")
            .activate(|window: &Self, _, _| window.log_out())
            .build();
        let quit = gio::ActionEntry::builder("quit")
            .activate(|window: &Self, _, _| window.close())
            .build();
        let refresh = gio::ActionEntry::builder("refresh")
            .activate(|window: &Self, _, _| {
                let model = window.model().clone();
                window.run_reporting(async move {
                    let result = model.refresh().await;
                    if matches!(model.route(), Route::KeyChanged { .. }) {
                        return Ok(());
                    }
                    result
                });
            })
            .build();
        let save_now = gio::ActionEntry::builder("save-now")
            .activate(|window: &Self, _, _| {
                let model = window.model().clone();
                glib::spawn_future_local(async move { model.save_now().await });
            })
            .build();
        let new_note = gio::ActionEntry::builder("new-note")
            .activate(|window: &Self, _, _| {
                let model = window.model().clone();
                if matches!(model.route(), Route::Loading { .. }) {
                    window.focus_early_draft();
                    return;
                }
                window.run_reporting(model.start_draft(Vec::new(), DraftFocus::Name));
            })
            .build();
        self.add_action_entries([log_out, quit, refresh, save_now, new_note]);
        #[cfg(feature = "testing")]
        self.setup_testing_actions();
    }

    #[cfg(feature = "testing")]
    fn setup_testing_actions(&self) {
        fn entry<F, Fut>(name: &str, run: F) -> gio::ActionEntry<CommitnoteWindow>
        where
            F: Fn(AppModel) -> Fut + 'static,
            Fut: Future<Output = Result<(), UserError>> + 'static,
        {
            gio::ActionEntry::builder(name)
                .activate(move |window: &CommitnoteWindow, _, _| {
                    window.run_reporting(run(window.model().clone()));
                })
                .build()
        }

        self.add_action_entries([
            entry("testing-remote-edit", |model| async move {
                model.testing_remote_edit().await
            }),
            entry("testing-fail-next", |model| async move {
                model.testing_fail_next().await
            }),
            entry("testing-change-passphrase", |model| async move {
                model.testing_change_passphrase().await
            }),
            entry("testing-hold-loading", |model| async move {
                model.testing_hold_loading().await
            }),
            entry("testing-finish-loading", |model| async move {
                model.testing_finish_loading().await
            }),
        ]);
    }

    fn run_reporting(&self, future: impl Future<Output = Result<(), UserError>> + 'static) {
        let window = self.downgrade();
        glib::spawn_future_local(async move {
            if let Err(error) = future.await
                && let Some(window) = window.upgrade()
            {
                window.show_toast(&error.message);
            }
        });
    }

    fn connect_model(&self) {
        let model = self.model();
        model.connect_route_changed({
            let window = self.downgrade();
            move |_| {
                if let Some(window) = window.upgrade() {
                    window.apply_route();
                }
            }
        });
        model.connect_sync_state_changed({
            let window = self.downgrade();
            move |_| {
                if let Some(window) = window.upgrade() {
                    window.update_logout_inhibit();
                }
            }
        });
        model.connect_early_draft_presence_changed({
            let window = self.downgrade();
            move |_| {
                if let Some(window) = window.upgrade() {
                    window.update_logout_inhibit();
                }
            }
        });
        model.connect_notice({
            let window = self.downgrade();
            move |_, notice| {
                if let Some(window) = window.upgrade() {
                    window.show_notice(notice);
                }
            }
        });
        model.connect_notice_cleared({
            let window = self.downgrade();
            move |_, id| {
                if let Some(window) = window.upgrade() {
                    let toast = window.imp().toasts.borrow_mut().remove(id);
                    if let Some(toast) = toast {
                        toast.dismiss();
                    }
                }
            }
        });
        model.connect_toast({
            let window = self.downgrade();
            move |_, message| {
                if let Some(window) = window.upgrade() {
                    window.show_toast(message);
                }
            }
        });
    }

    fn flush_and_close(&self) {
        self.imp().guarding_close.set(true);
        let model = self.model().clone();
        let window = self.downgrade();
        glib::spawn_future_local(async move {
            let outcome = model.flush_for_close().await;
            if let Some(window) = window.upgrade() {
                match after_flush(&outcome) {
                    CloseStep::Ask { count } => window.ask_to_quit(count),
                    _ => window.close_now(),
                }
            }
        });
    }

    fn close_now(&self) {
        let imp = self.imp();
        imp.guarding_close.set(false);
        imp.close_released.set(true);
        self.close();
    }

    fn ask_to_quit(&self, count: u32) {
        self.present_close_dialog(count, |window| {
            let model = window.model().clone();
            glib::spawn_future_local(async move { model.retry_sync().await });
        });
    }

    fn ask_to_quit_early_draft(&self) {
        self.imp().guarding_close.set(true);
        let window = self.clone();
        glib::idle_add_local_once(move || window.present_early_draft_dialog());
    }

    fn present_early_draft_dialog(&self) {
        self.present_close_dialog(1, |window| {
            let model = window.model();
            if matches!(
                model.route(),
                Route::Loading {
                    failure: Some(LoadingFailure {
                        can_retry: true,
                        ..
                    })
                }
            ) {
                model.retry_resume();
            }
        });
    }

    fn present_close_dialog(&self, count: u32, keep_trying: fn(&Self)) {
        let dialog = adw::AlertDialog::new(Some(UNSAVED_HEADING), Some(&unsaved_body(count)));
        dialog.set_widget_name("close-unsaved-dialog");
        dialog.add_responses(&[
            ("keep-trying", "_Keep Trying"),
            ("quit-anyway", "_Quit Anyway"),
        ]);
        dialog.set_response_appearance("quit-anyway", adw::ResponseAppearance::Destructive);
        dialog.set_default_response(Some("keep-trying"));
        dialog.set_close_response("keep-trying");
        dialog.connect_response(None, {
            let window = self.downgrade();
            move |_, response| {
                let Some(window) = window.upgrade() else {
                    return;
                };
                if response == "quit-anyway" {
                    glib::idle_add_local_once(move || window.close_now());
                    return;
                }
                window.imp().guarding_close.set(false);
                keep_trying(&window);
            }
        });
        dialog.present(Some(self));
    }

    fn log_out(&self) {
        if self.imp().logging_out.replace(true) {
            return;
        }
        let model = self.model().clone();
        let window = self.downgrade();
        glib::spawn_future_local(async move {
            let result = model.log_out().await;
            let Some(window) = window.upgrade() else {
                return;
            };
            match result {
                Ok(LogOutResult::Unsaved { message }) => window.ask_to_log_out(&message),
                Ok(LogOutResult::LoggedOut) => window.imp().logging_out.set(false),
                Err(error) => {
                    window.imp().logging_out.set(false);
                    window.show_toast(&error.message);
                }
            }
        });
    }

    fn ask_to_log_out(&self, message: &str) {
        let dialog = adw::AlertDialog::new(Some(UNSAVED_HEADING), Some(message));
        dialog.set_widget_name("logout-unsaved-dialog");
        dialog.add_responses(&[
            ("cancel", "_Cancel"),
            ("keep-trying", "_Keep Trying"),
            ("log-out-anyway", "_Log Out Anyway"),
        ]);
        dialog.set_response_appearance("log-out-anyway", adw::ResponseAppearance::Destructive);
        dialog.set_default_response(Some("cancel"));
        dialog.set_close_response("cancel");
        dialog.connect_response(None, {
            let window = self.downgrade();
            move |_, response| {
                let Some(window) = window.upgrade() else {
                    return;
                };
                window.imp().logging_out.set(false);
                match response {
                    "keep-trying" => window.log_out(),
                    "log-out-anyway" => {
                        let model = window.model().clone();
                        window.run_reporting(async move { model.log_out_anyway().await });
                    }
                    _ => {}
                }
            }
        });
        dialog.present(Some(self));
    }

    fn update_logout_inhibit(&self) {
        let model = self.model();
        let needed = should_inhibit_logout(model.unsaved_count(), model.has_early_draft_text());
        if let Some(inhibit) = self.imp().logout_inhibit.borrow_mut().as_mut() {
            inhibit.update(needed);
        }
    }

    pub fn holds_logout_inhibit(&self) -> bool {
        self.imp()
            .logout_inhibit
            .borrow()
            .as_ref()
            .is_some_and(LogoutInhibit::is_held)
    }

    fn apply_route(&self) {
        let imp = self.imp();
        imp.applying_route.set(true);
        let model = self.model();
        match model.route() {
            Route::Starting => self.replace_with(&imp.starting_page.get()),
            Route::StartupFailed { message } => {
                self.replace_with(StartupErrorPage::new(&message).upcast_ref());
            }
            Route::Token => self.replace_unless::<TokenPage>(|| TokenPage::new(model).upcast()),
            Route::RepositoryList { repositories } => {
                self.push_at(1, RepositoryListPage::new(model, repositories).upcast_ref());
            }
            Route::Unlock { repository } => {
                self.push_at(2, UnlockPage::new(model, repository).upcast_ref());
            }
            Route::Initialize {
                repository,
                set_up_description,
            } => {
                self.push_at(
                    2,
                    InitializePage::new(model, repository, set_up_description).upcast_ref(),
                );
            }
            Route::Unusable { outcome } => {
                self.push_at(2, UnusableRepositoryPage::new(model, outcome).upcast_ref());
            }
            Route::Loading { .. } => {
                self.replace_unless::<LoadingPage>(|| LoadingPage::new(model).upcast());
            }
            Route::Notes => self.replace_unless::<NotesPage>(|| NotesPage::new(model).upcast()),
            Route::KeyChanged { .. } => {
                self.replace_unless::<KeyChangedPage>(|| KeyChangedPage::new(model).upcast());
            }
        }
        if let Some(action) = self
            .lookup_action("new-note")
            .and_downcast::<gio::SimpleAction>()
        {
            action.set_enabled(matches!(
                model.route(),
                Route::Notes | Route::Loading { .. }
            ));
        }
        imp.applying_route.set(false);
    }

    fn focus_early_draft(&self) {
        if let Some(page) = self
            .stack()
            .iter()
            .find_map(|page| page.downcast_ref::<LoadingPage>())
        {
            page.focus_name();
        }
    }

    pub fn notes_placeholder_visible(&self) -> bool {
        self.stack()
            .iter()
            .find_map(|page| page.downcast_ref::<NotesPage>())
            .is_some_and(NotesPage::placeholder_visible)
    }

    fn setup_type_to_start(&self) {
        let controller = gtk::EventControllerKey::new();
        controller.set_propagation_phase(gtk::PropagationPhase::Bubble);
        let held = Rc::new(RefCell::new(HashSet::<u32>::new()));
        controller.connect_key_pressed({
            let window = self.downgrade();
            let held = held.clone();
            move |_, keyval, keycode, state| {
                let Some(window) = window.upgrade() else {
                    return glib::Propagation::Proceed;
                };
                let is_repeat = !held.borrow_mut().insert(keycode);
                crate::type_to_start::handle_type_to_start_key(
                    window.model(),
                    &window,
                    keyval,
                    state,
                    is_repeat,
                )
            }
        });
        controller.connect_key_released(move |_, _, keycode, _| {
            held.borrow_mut().remove(&keycode);
        });
        self.add_controller(controller);
    }

    fn stack(&self) -> Vec<adw::NavigationPage> {
        self.imp()
            .navigation_view
            .navigation_stack()
            .iter::<adw::NavigationPage>()
            .filter_map(Result::ok)
            .collect()
    }

    fn replace_with(&self, page: &adw::NavigationPage) {
        let stack = self.stack();
        if stack.len() == 1 && &stack[0] == page {
            return;
        }
        self.imp()
            .navigation_view
            .replace(std::slice::from_ref(page));
    }

    fn replace_unless<P: IsA<adw::NavigationPage>>(
        &self,
        create: impl FnOnce() -> adw::NavigationPage,
    ) {
        let stack = self.stack();
        if stack.len() == 1 && stack[0].is::<P>() {
            return;
        }
        self.imp().navigation_view.replace(&[create()]);
    }

    fn push_at(&self, depth: usize, page: &adw::NavigationPage) {
        let navigation_view = &self.imp().navigation_view;
        let mut stack = self.stack();
        if stack.len() > depth {
            stack.truncate(depth);
            stack.push(page.clone());
            navigation_view.replace(&stack);
        } else {
            navigation_view.push(page);
        }
    }

    fn show_notice(&self, notice: &NoticeView) {
        let toast = adw::Toast::new(&notice.message);
        let model = self.model();
        if let Some(label) = &notice.action_label {
            toast.set_button_label(Some(label));
            toast.connect_button_clicked({
                let window = self.downgrade();
                let model = model.downgrade();
                let id = notice.id.clone();
                move |_| {
                    if let Some(window) = window.upgrade() {
                        window.imp().toasts.borrow_mut().remove(&id);
                    }
                    if let Some(model) = model.upgrade() {
                        model.perform_notice(&id);
                    }
                }
            });
        } else {
            toast.set_timeout(NOTICE_TIMEOUT_SECONDS);
        }
        if notice.persistent {
            toast.set_timeout(0);
        }
        toast.connect_dismissed({
            let window = self.downgrade();
            let model = model.downgrade();
            let id = notice.id.clone();
            let persistent = notice.persistent;
            move |toast| {
                let Some(window) = window.upgrade() else {
                    return;
                };
                let tracked = {
                    let mut toasts = window.imp().toasts.borrow_mut();
                    if toasts.get(&id) == Some(toast) {
                        toasts.remove(&id);
                        true
                    } else {
                        false
                    }
                };
                if tracked
                    && persistent
                    && let Some(model) = model.upgrade()
                {
                    model.dismiss_notice(&id);
                }
            }
        });
        let previous = self
            .imp()
            .toasts
            .borrow_mut()
            .insert(notice.id.clone(), toast.clone());
        if let Some(previous) = previous {
            previous.dismiss();
        }
        self.imp().toast_overlay.add_toast(toast);
    }

    fn show_toast(&self, message: &str) {
        let toast = adw::Toast::new(message);
        toast.set_timeout(NOTICE_TIMEOUT_SECONDS);
        self.imp().toast_overlay.add_toast(toast);
    }

    fn restore_state(&self) {
        let settings = gio::Settings::new(config::APP_ID);
        self.set_default_size(settings.int("window-width"), settings.int("window-height"));
        if settings.boolean("is-maximized") {
            self.maximize();
        }
    }

    fn save_state(&self) {
        let settings = gio::Settings::new(config::APP_ID);
        let (width, height) = self.default_size();
        let _ = settings.set_int("window-width", width);
        let _ = settings.set_int("window-height", height);
        let _ = settings.set_boolean("is-maximized", self.is_maximized());
    }
}

pub struct WindowInhibitor {
    application: gtk::Application,
    window: glib::WeakRef<CommitnoteWindow>,
}

impl Inhibitor for WindowInhibitor {
    fn inhibit(&self) -> u32 {
        let window = self.window.upgrade();
        self.application.inhibit(
            window.as_ref(),
            gtk::ApplicationInhibitFlags::LOGOUT,
            Some(LOGOUT_INHIBIT_REASON),
        )
    }

    fn uninhibit(&self, cookie: u32) {
        self.application.uninhibit(cookie);
    }
}

#[cfg(feature = "testing")]
pub fn testing_menu() -> gio::Menu {
    let section = gio::Menu::new();
    section.append(Some("Remote Edit"), Some("win.testing-remote-edit"));
    section.append(Some("Fail Next Request"), Some("win.testing-fail-next"));
    section.append(
        Some("Change Passphrase Elsewhere"),
        Some("win.testing-change-passphrase"),
    );
    section.append(Some("Hold Loading"), Some("win.testing-hold-loading"));
    let menu = gio::Menu::new();
    menu.append_section(Some("Testing"), &section);
    menu
}
