use std::cell::{Cell, RefCell};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use adw::prelude::*;
use commitnote::config;
use commitnote::model::appearance::AppearanceApplier;
use commitnote::model::{AppConfig, AppModel, Appearance, ColorMode, Route};
use commitnote::window::CommitnoteWindow;
use commitnote_core_runtime::services::RememberedSessionStore;
use commitnote_core_runtime::services::remembered_session::open_remembered_session_store;
use gtk4::{self as gtk, gio, glib, graphene};
use libadwaita as adw;

pub type Case = (&'static str, fn(&mut Harness) -> Result<(), String>);

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);
const WAKE_INTERVAL: Duration = Duration::from_millis(50);
const REFRESH_GAP: Duration = Duration::from_millis(500);
const BUNDLE_RESOURCE: &str = "core/commitnote-core.js";
const SESSION_ACCENT: &str = "violet";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Width {
    Narrow,
    Wide,
}

impl Width {
    fn name(self) -> &'static str {
        match self {
            Self::Narrow => "narrow",
            Self::Wide => "wide",
        }
    }

    fn size(self) -> (i32, i32) {
        match self {
            Self::Narrow => (360, 720),
            Self::Wide => (1280, 800),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    fn name(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn color_mode(self) -> ColorMode {
        match self {
            Self::Light => ColorMode::Light,
            Self::Dark => ColorMode::Dark,
        }
    }

    fn is_dark(self) -> bool {
        self == Self::Dark
    }
}

pub const ALL_VARIANTS: &[(Width, Theme)] = &[
    (Width::Narrow, Theme::Light),
    (Width::Narrow, Theme::Dark),
    (Width::Wide, Theme::Light),
    (Width::Wide, Theme::Dark),
];
pub const NARROW_VARIANTS: &[(Width, Theme)] =
    &[(Width::Narrow, Theme::Light), (Width::Narrow, Theme::Dark)];
pub const WIDE_VARIANTS: &[(Width, Theme)] =
    &[(Width::Wide, Theme::Light), (Width::Wide, Theme::Dark)];

/// Sets the process environment the harness relies on; must run before GTK starts any thread.
pub fn prepare_environment() {
    for (key, value) in [("GSK_RENDERER", "cairo"), ("ADW_DISABLE_PORTAL", "1")] {
        if std::env::var_os(key).is_none() {
            unsafe { std::env::set_var(key, value) };
        }
    }
}

pub struct Harness {
    application: adw::Application,
    applier: Rc<AppearanceApplier>,
    bundle: String,
    run_dir: PathBuf,
    screenshot_dir: PathBuf,
    prefix: Cell<&'static str>,
    case: RefCell<String>,
    case_dir: RefCell<PathBuf>,
    model: RefCell<Option<AppModel>>,
    window: RefCell<Option<CommitnoteWindow>>,
    changes: Rc<Cell<u64>>,
    routes: Rc<RefCell<Vec<Route>>>,
    failure_saved: Cell<bool>,
}

impl Harness {
    pub fn new(application: adw::Application) -> Result<Self, String> {
        let bundle_path = format!("{}{BUNDLE_RESOURCE}", config::RESOURCE_PREFIX);
        let bundle = gio::resources_lookup_data(&bundle_path, gio::ResourceLookupFlags::NONE)
            .map_err(|error| format!("the core bundle is not embedded: {error}"))
            .and_then(|bytes| {
                String::from_utf8(bytes.to_vec())
                    .map_err(|_| "the core bundle is not UTF-8".to_owned())
            })?;
        let run_dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("commitnote-ui-{}", std::process::id()));
        let screenshot_dir = std::env::var_os("COMMITNOTE_SCREENSHOT_DIR")
            .filter(|dir| !dir.is_empty())
            .map_or_else(|| PathBuf::from("out/screenshots"), PathBuf::from);
        std::fs::create_dir_all(&screenshot_dir)
            .map_err(|error| format!("cannot create the screenshot directory: {error}"))?;
        install_app_icons(&run_dir.join("icons"))?;
        Ok(Self {
            application,
            applier: Rc::new(AppearanceApplier::new()),
            bundle,
            run_dir,
            screenshot_dir,
            prefix: Cell::new(""),
            case: RefCell::default(),
            case_dir: RefCell::default(),
            model: RefCell::default(),
            window: RefCell::default(),
            changes: Rc::default(),
            routes: Rc::default(),
            failure_saved: Cell::new(false),
        })
    }

    pub fn begin(&mut self, prefix: &'static str, case: &str) -> Result<(), String> {
        self.prefix.set(prefix);
        self.case.replace(case.to_owned());
        self.failure_saved.set(false);
        let case_dir = self.run_dir.join(case);
        std::fs::create_dir_all(&case_dir)
            .map_err(|error| format!("cannot create the case directory: {error}"))?;
        self.case_dir.replace(case_dir);
        self.applier.apply(&Appearance::default());
        self.clear_remembered_session()
    }

    pub fn finish(&mut self) {
        self.close();
        let case_dir = self.case_dir.take();
        if !case_dir.as_os_str().is_empty() {
            let _ = std::fs::remove_dir_all(case_dir);
        }
    }

    pub fn cleanup(&self) {
        let _ = std::fs::remove_dir_all(&self.run_dir);
    }

    fn clear_remembered_session(&self) -> Result<(), String> {
        let session = self.run(
            "the remembered session store to open",
            open_remembered_session_store(config::APP_ID),
        )?;
        if !session.keyring_available {
            return Err("the Secret Service keyring is unavailable".to_owned());
        }
        let store = session.store;
        self.run("the remembered session to clear", async move {
            store.clear().await
        })?
        .map_err(|error| {
            format!(
                "could not clear the remembered session: {}",
                error.message()
            )
        })
    }

    /// Starts a fresh model and window on the case's cache and config directories.
    pub fn launch(&self) -> Result<(), String> {
        self.close();
        let case_dir = self.case_dir.borrow().clone();
        let model = AppModel::new(AppConfig {
            app_id: config::APP_ID.to_owned(),
            version: config::VERSION.to_owned(),
            bundle_source: self.bundle.clone(),
            cache_dir: case_dir.join("cache"),
            config_dir: case_dir.join("config"),
            device_model: "Linux".to_owned(),
            testing: true,
        });
        self.routes.borrow_mut().clear();
        model.connect_route_changed({
            let routes = self.routes.clone();
            let changes = self.changes.clone();
            move |model| {
                routes.borrow_mut().push(model.route());
                changes.set(changes.get() + 1);
            }
        });
        model.connect_tree_changed({
            let changes = self.changes.clone();
            move |_| changes.set(changes.get() + 1)
        });
        model.connect_open_note_changed({
            let changes = self.changes.clone();
            move |_| changes.set(changes.get() + 1)
        });
        model.connect_appearance_changed({
            let applier = self.applier.clone();
            let changes = self.changes.clone();
            move |model| {
                applier.apply(&model.appearance());
                changes.set(changes.get() + 1);
            }
        });
        let window = CommitnoteWindow::new(&self.application, &model);
        let (width, height) = Width::Wide.size();
        window.set_default_size(width, height);
        window.present();
        self.model.replace(Some(model));
        self.window.replace(Some(window.clone()));
        self.wait("the window to map", || window.is_mapped())
    }

    /// Shuts the model down and destroys the window, as quitting the app would.
    pub fn close(&self) {
        if let Some(model) = self.model.take() {
            model.shutdown();
        }
        if let Some(window) = self.window.take() {
            window.destroy();
        }
        let context = glib::MainContext::default();
        while context.pending() {
            context.iteration(false);
        }
    }

    pub fn model(&self) -> Result<AppModel, String> {
        self.model
            .borrow()
            .clone()
            .ok_or_else(|| "no app model is running".to_owned())
    }

    pub fn window(&self) -> Result<CommitnoteWindow, String> {
        self.window
            .borrow()
            .clone()
            .ok_or_else(|| "no window is open".to_owned())
    }

    pub fn route(&self) -> Result<Route, String> {
        Ok(self.model()?.route())
    }

    pub fn routes_seen(&self) -> Vec<Route> {
        self.routes.borrow().clone()
    }

    pub fn wait(&self, description: &str, predicate: impl FnMut() -> bool) -> Result<(), String> {
        self.wait_until(description, DEFAULT_TIMEOUT, predicate)
    }

    /// Iterates the main context until `predicate` holds; never blocks past `timeout`.
    pub fn wait_until(
        &self,
        description: &str,
        timeout: Duration,
        mut predicate: impl FnMut() -> bool,
    ) -> Result<(), String> {
        let context = glib::MainContext::default();
        let expired = Rc::new(Cell::new(false));
        let deadline = glib::timeout_add_local_once(timeout, {
            let expired = expired.clone();
            move || expired.set(true)
        });
        let wake = glib::timeout_add_local(WAKE_INTERVAL, || glib::ControlFlow::Continue);
        let satisfied = loop {
            if predicate() {
                break true;
            }
            if expired.get() {
                break false;
            }
            context.iteration(true);
        };
        wake.remove();
        if !expired.get() {
            deadline.remove();
        }
        if satisfied {
            return Ok(());
        }
        self.save_failure();
        Err(format!(
            "timed out after {}s waiting for {description} (route: {})",
            timeout.as_secs(),
            self.model
                .borrow()
                .as_ref()
                .map_or("none", |model| route_name(&model.route()))
        ))
    }

    pub fn run<T: 'static>(
        &self,
        description: &str,
        future: impl Future<Output = T> + 'static,
    ) -> Result<T, String> {
        let slot = Rc::new(RefCell::new(None));
        glib::spawn_future_local({
            let slot = slot.clone();
            async move {
                let output = future.await;
                slot.replace(Some(output));
            }
        });
        self.wait(description, || slot.borrow().is_some())?;
        Ok(slot.take().expect("the future finished"))
    }

    pub fn wait_route(
        &self,
        description: &str,
        predicate: impl Fn(&Route) -> bool,
    ) -> Result<Route, String> {
        let model = self.model()?;
        self.wait(description, || predicate(&model.route()))?;
        Ok(model.route())
    }

    /// Waits until the window's top-level navigation shows the page tagged `tag`.
    pub fn wait_page(&self, tag: &str) -> Result<(), String> {
        self.wait_page_for(tag, DEFAULT_TIMEOUT)
    }

    pub fn wait_page_for(&self, tag: &str, timeout: Duration) -> Result<(), String> {
        self.wait_until(&format!("the {tag} page"), timeout, || {
            self.visible_page()
                .is_some_and(|page| page.tag().as_deref() == Some(tag) && page.is_mapped())
        })
    }

    pub fn visible_page(&self) -> Option<adw::NavigationPage> {
        let window = self.window.borrow().clone()?;
        descendants(window.upcast_ref())
            .into_iter()
            .find_map(|widget| widget.downcast::<adw::NavigationView>().ok())
            .and_then(|navigation| navigation.visible_page())
    }

    pub fn page(&self, tag: &str) -> Result<adw::NavigationPage, String> {
        let window = self.window()?;
        descendants(window.upcast_ref())
            .into_iter()
            .filter_map(|widget| widget.downcast::<adw::NavigationPage>().ok())
            .find(|page| page.tag().as_deref() == Some(tag))
            .ok_or_else(|| format!("no page is tagged {tag}"))
    }

    fn named(&self, name: &str) -> Vec<gtk::Widget> {
        let Some(window) = self.window.borrow().clone() else {
            return Vec::new();
        };
        descendants(window.upcast_ref())
            .into_iter()
            .filter(|widget| widget.widget_name() == name)
            .collect()
    }

    /// The widget named `name`, preferring one that is on screen.
    pub fn widget(&self, name: &str) -> Result<gtk::Widget, String> {
        let widgets = self.named(name);
        widgets
            .iter()
            .find(|widget| widget.is_mapped())
            .or_else(|| widgets.first())
            .cloned()
            .ok_or_else(|| format!("no widget is named {name}"))
    }

    pub fn widget_as<T: IsA<gtk::Widget>>(&self, name: &str) -> Result<T, String> {
        self.widget(name)?
            .downcast::<T>()
            .map_err(|_| format!("{name} is not a {}", T::static_type().name()))
    }

    pub fn shown(&self, name: &str) -> bool {
        self.named(name).iter().any(|widget| widget.is_mapped())
    }

    pub fn wait_shown(&self, name: &str) -> Result<(), String> {
        self.wait(&format!("{name} to show"), || self.shown(name))
    }

    pub fn label(&self, name: &str) -> Result<String, String> {
        Ok(self.widget_as::<gtk::Label>(name)?.label().to_string())
    }

    pub fn text(&self, name: &str) -> Result<String, String> {
        Ok(self.editable(name)?.text().to_string())
    }

    pub fn text_view_text(&self, name: &str) -> Result<String, String> {
        let buffer = self.widget_as::<gtk::TextView>(name)?.buffer();
        let (start, end) = buffer.bounds();
        Ok(buffer.text(&start, &end, false).to_string())
    }

    pub fn label_shown_with(&self, text: &str) -> bool {
        let Some(window) = self.window.borrow().clone() else {
            return false;
        };
        descendants(window.upcast_ref())
            .into_iter()
            .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
            .any(|label| label.is_mapped() && label.label() == text)
    }

    pub fn set_text(&self, name: &str, text: &str) -> Result<(), String> {
        self.editable(name)?.set_text(text);
        Ok(())
    }

    fn editable(&self, name: &str) -> Result<gtk::Editable, String> {
        self.widget(name)?
            .dynamic_cast::<gtk::Editable>()
            .map_err(|_| format!("{name} is not editable"))
    }

    pub fn set_switch(&self, name: &str, active: bool) -> Result<(), String> {
        self.widget_as::<adw::SwitchRow>(name)?.set_active(active);
        Ok(())
    }

    pub fn click(&self, name: &str) -> Result<(), String> {
        let button = self.widget_as::<gtk::Button>(name)?;
        if !button.is_sensitive() || !button.is_mapped() {
            return Err(format!("{name} cannot be clicked"));
        }
        button.emit_clicked();
        Ok(())
    }

    pub fn activate_row(&self, name: &str) -> Result<(), String> {
        let row = self.widget(name)?;
        if !row.activate() {
            return Err(format!("{name} is not activatable"));
        }
        Ok(())
    }

    pub fn activate_list_item(&self, name: &str, position: u32) -> Result<(), String> {
        self.widget_as::<gtk::ListView>(name)?
            .activate_action("list.activate-item", Some(&position.to_variant()))
            .map_err(|error| format!("cannot activate item {position} of {name}: {error}"))
    }

    pub fn list_len(&self, name: &str) -> Result<u32, String> {
        Ok(self
            .widget_as::<gtk::ListView>(name)?
            .model()
            .map_or(0, |model| model.n_items()))
    }

    pub fn stack_page(&self, name: &str) -> Result<Option<String>, String> {
        let stack = descendants(&self.widget(name)?)
            .into_iter()
            .find_map(|widget| widget.downcast::<gtk::Stack>().ok())
            .ok_or_else(|| format!("{name} holds no stack"))?;
        Ok(stack.visible_child_name().map(|name| name.to_string()))
    }

    pub fn window_action(&self, action: &str) -> Result<(), String> {
        let window = self.window()?;
        WidgetExt::activate_action(&window, &format!("win.{action}"), None)
            .map_err(|error| format!("cannot activate win.{action}: {error}"))
    }

    /// Activates the shortcut bound to `accelerator` on `widget`, as pressing the keys would.
    pub fn press_shortcut(&self, widget: &gtk::Widget, accelerator: &str) -> Result<(), String> {
        let trigger = gtk::ShortcutTrigger::parse_string(accelerator)
            .ok_or_else(|| format!("{accelerator} is not a valid accelerator"))?;
        let controllers = widget.observe_controllers();
        let shortcut = (0..controllers.n_items())
            .filter_map(|index| controllers.item(index))
            .filter_map(|controller| controller.downcast::<gtk::ShortcutController>().ok())
            .flat_map(|controller| {
                (0..controller.n_items())
                    .filter_map(|index| controller.item(index))
                    .filter_map(|item| item.downcast::<gtk::Shortcut>().ok())
                    .collect::<Vec<_>>()
            })
            .find(|shortcut| {
                shortcut
                    .trigger()
                    .is_some_and(|bound| bound.equal(&trigger))
            })
            .ok_or_else(|| format!("nothing is bound to {accelerator}"))?;
        let action = shortcut
            .action()
            .ok_or_else(|| format!("{accelerator} has no action"))?;
        if !action.activate(gtk::ShortcutActionFlags::empty(), widget, None) {
            return Err(format!("the {accelerator} shortcut did nothing"));
        }
        Ok(())
    }

    /// Refreshes repeatedly, spaced out, until `predicate` holds, so a change made on the fake
    /// forge reaches the app regardless of when the request that made it completes.
    pub fn refresh_until(
        &self,
        description: &str,
        mut predicate: impl FnMut() -> bool,
    ) -> Result<(), String> {
        let model = self.model()?;
        let in_flight = Rc::new(Cell::new(false));
        let mut last = None::<Instant>;
        self.wait(description, || {
            if predicate() {
                return true;
            }
            if !in_flight.get() && last.is_none_or(|last| last.elapsed() >= REFRESH_GAP) {
                in_flight.set(true);
                last = Some(Instant::now());
                let model = model.clone();
                let in_flight = in_flight.clone();
                glib::spawn_future_local(async move {
                    let _ = model.refresh().await;
                    in_flight.set(false);
                });
            }
            false
        })
    }

    pub fn resize(&self, width: Width) -> Result<(), String> {
        let window = self.window()?;
        let (width, height) = width.size();
        window.set_default_size(width, height);
        self.wait(&format!("the window to be {width}x{height}"), || {
            window.width() == width && window.height() == height
        })
    }

    /// Waits until two frames pass with no model or layout change, so deferred layout such as
    /// text wrapping has caught up with the last resize.
    pub fn settle(&self) -> Result<(), String> {
        let window = self.window()?;
        let ticks = Rc::new(Cell::new(0_u32));
        let layout = Rc::new(Cell::new(0_u64));
        let callback = window.add_tick_callback({
            let ticks = ticks.clone();
            let layout = layout.clone();
            move |window, _| {
                let now = layout_signature(window.upcast_ref());
                if layout.replace(now) == now {
                    ticks.set(ticks.get() + 1);
                } else {
                    ticks.set(0);
                }
                glib::ControlFlow::Continue
            }
        });
        let mut seen = self.changes.get();
        let result = self.wait("the window to settle", || {
            let now = self.changes.get();
            if now != seen {
                seen = now;
                ticks.set(0);
            }
            ticks.get() >= 2
        });
        callback.remove();
        result
    }

    /// Renders the views before a session exists, with the system accent and a forced scheme.
    pub fn screenshots(&self, view: &str, variants: &[(Width, Theme)]) -> Result<(), String> {
        let style_manager = adw::StyleManager::default();
        for &(width, theme) in variants {
            self.resize(width)?;
            self.applier.apply(&Appearance {
                color_mode: theme.color_mode(),
                accent: None,
            });
            self.wait(&format!("the {} scheme", theme.name()), || {
                style_manager.is_dark() == theme.is_dark()
            })?;
            self.settle()?;
            self.capture(view, width, theme, "system")?;
        }
        Ok(())
    }

    /// Renders session views after applying the scheme and accent through the core's settings.
    pub fn session_screenshots(
        &self,
        view: &str,
        variants: &[(Width, Theme)],
    ) -> Result<(), String> {
        for &(width, theme) in variants {
            self.resize(width)?;
            self.apply_session_appearance(theme)?;
            self.settle()?;
            self.capture(view, width, theme, SESSION_ACCENT)?;
        }
        Ok(())
    }

    fn apply_session_appearance(&self, theme: Theme) -> Result<(), String> {
        let model = self.model()?;
        for (key, value) in [("colorMode", theme.name()), ("accentColor", SESSION_ACCENT)] {
            let change = model.testing_send(
                "settings.change",
                serde_json::json!({ "key": key, "value": value }),
            );
            self.run(&format!("the {key} setting to change"), change)?
                .map_err(|error| format!("cannot change {key}: {}", error.message))?;
        }
        let style_manager = adw::StyleManager::default();
        self.wait(
            &format!(
                "the {} scheme with the {SESSION_ACCENT} accent",
                theme.name()
            ),
            || {
                let appearance = model.appearance();
                appearance.color_mode == theme.color_mode()
                    && appearance.accent.is_some()
                    && style_manager.is_dark() == theme.is_dark()
            },
        )
    }

    fn capture(&self, view: &str, width: Width, theme: Theme, accent: &str) -> Result<(), String> {
        let file = format!(
            "{}-{view}-{}-{}-{accent}.png",
            self.prefix.get(),
            width.name(),
            theme.name()
        );
        self.render(&self.screenshot_dir.join(file))
    }

    pub fn save_failure(&self) {
        if self.failure_saved.replace(true) || self.window.borrow().is_none() {
            return;
        }
        let path = self
            .screenshot_dir
            .join(format!("failure-{}.png", self.case.borrow()));
        if let Err(error) = self.render(&path) {
            eprintln!("could not save the failure screenshot: {error}");
        }
    }

    fn render(&self, path: &Path) -> Result<(), String> {
        let window = self.window()?;
        let (width, height) = (window.width(), window.height());
        let paintable = gtk::WidgetPaintable::new(Some(&window));
        let snapshot = gtk::Snapshot::new();
        paintable.snapshot(&snapshot, f64::from(width), f64::from(height));
        let node = snapshot
            .to_node()
            .ok_or_else(|| "the window rendered nothing".to_owned())?;
        let renderer = window
            .renderer()
            .ok_or_else(|| "the window has no renderer".to_owned())?;
        let viewport = graphene::Rect::new(0.0, 0.0, width as f32, height as f32);
        renderer
            .render_texture(&node, Some(&viewport))
            .save_to_png(path)
            .map_err(|error| format!("cannot save {}: {error}", path.display()))
    }
}

/// Puts the app icons where the icon theme finds them under the app id, as installing does.
fn install_app_icons(icon_dir: &Path) -> Result<(), String> {
    let base_id = config::APP_ID.trim_end_matches(".Devel");
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("data/icons/hicolor");
    for (size, suffix) in [("scalable", ""), ("symbolic", "-symbolic")] {
        let target = icon_dir.join("hicolor").join(size).join("apps");
        std::fs::create_dir_all(&target)
            .and_then(|()| {
                std::fs::copy(
                    source
                        .join(size)
                        .join("apps")
                        .join(format!("{base_id}{suffix}.svg")),
                    target.join(format!("{}{suffix}.svg", config::APP_ID)),
                )
            })
            .map_err(|error| format!("cannot install the app icons: {error}"))?;
    }
    let display = gtk::gdk::Display::default().ok_or("there is no display")?;
    gtk::IconTheme::for_display(&display).add_search_path(icon_dir);
    Ok(())
}

fn layout_signature(root: &gtk::Widget) -> u64 {
    use std::hash::{DefaultHasher, Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    for widget in descendants(root) {
        if widget.is_mapped() {
            let bounds = widget.compute_bounds(root);
            (
                widget.width(),
                widget.height(),
                bounds.map(|rect| (rect.x() as i32, rect.y() as i32)),
            )
                .hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn descendants(root: &gtk::Widget) -> Vec<gtk::Widget> {
    let mut found = Vec::new();
    let mut pending = vec![root.clone()];
    while let Some(widget) = pending.pop() {
        let mut child = widget.last_child();
        while let Some(current) = child {
            child = current.prev_sibling();
            pending.push(current);
        }
        found.push(widget);
    }
    found
}

pub fn route_name(route: &Route) -> &'static str {
    match route {
        Route::Starting => "starting",
        Route::StartupFailed { .. } => "startup failed",
        Route::Token => "token",
        Route::RepositoryList { .. } => "repositories",
        Route::Unlock { .. } => "unlock",
        Route::Initialize { .. } => "initialize",
        Route::Unusable { .. } => "unusable",
        Route::Loading { failure: None } => "loading",
        Route::Loading { failure: Some(_) } => "loading failed",
        Route::Notes => "notes",
        Route::KeyChanged { .. } => "key changed",
    }
}
