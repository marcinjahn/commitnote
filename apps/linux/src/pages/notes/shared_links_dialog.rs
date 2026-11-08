use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
#[cfg(feature = "testing")]
use commitnote_core_api::commands::ShareActionId;
use commitnote_core_api::events::SharesChanged;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use super::share_actions::ShareActions;
use super::share_row;
use crate::model::AppModel;
use crate::window::host_dialog_toasts;

const SHARED_LINKS: &str = "Shared links";

#[cfg(feature = "testing")]
pub struct SharedLinksDialog;

struct Dialog {
    model: AppModel,
    dialog: adw::Dialog,
    actions: Rc<ShareActions>,
    stack: gtk::Stack,
    unreadable: adw::StatusPage,
    empty: adw::StatusPage,
    list: gtk::ListBox,
    scroller: gtk::ScrolledWindow,
    seen_view: Cell<bool>,
}

pub fn present(model: &AppModel, anchor: &impl IsA<gtk::Widget>) -> adw::Dialog {
    let unreadable = adw::StatusPage::builder()
        .name("shared-links-unreadable")
        .icon_name("dialog-warning-symbolic")
        .build();
    let empty = adw::StatusPage::builder()
        .name("shared-links-empty")
        .icon_name("emblem-shared-symbolic")
        .build();
    let list = gtk::ListBox::builder()
        .name("shared-links-list")
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    let clamp = adw::Clamp::builder()
        .maximum_size(600)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .child(&list)
        .build();
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .child(&clamp)
        .build();

    let stack = gtk::Stack::new();
    stack.add_named(&empty, Some("empty"));
    stack.add_named(&unreadable, Some("unreadable"));
    stack.add_named(&scroller, Some("list"));

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&stack));
    let page = adw::NavigationPage::builder()
        .title(SHARED_LINKS)
        .tag("shared-links")
        .child(&toolbar)
        .build();
    let navigation = adw::NavigationView::new();
    navigation.add(&page);
    let toasts = adw::ToastOverlay::new();
    toasts.set_child(Some(&navigation));

    let dialog = adw::Dialog::builder()
        .name("shared-links-dialog")
        .title(SHARED_LINKS)
        .content_width(520)
        .content_height(600)
        .child(&toasts)
        .build();

    let state = Rc::new(Dialog {
        model: model.clone(),
        dialog: dialog.clone(),
        actions: ShareActions::new(model, &dialog, &navigation, &toasts),
        stack,
        unreadable,
        empty,
        list,
        scroller,
        seen_view: Cell::new(false),
    });

    let handler = Rc::new(RefCell::new(Some(model.connect_shares_changed({
        let state = state.clone();
        move |_| state.refresh()
    }))));
    dialog.connect_closed({
        let model = model.clone();
        move |_| {
            if let Some(handler) = handler.take() {
                model.disconnect(handler);
            }
        }
    });

    host_dialog_toasts(anchor, &dialog, &toasts);
    state.refresh();
    dialog.present(Some(anchor));
    dialog
}

impl Dialog {
    fn refresh(self: &Rc<Self>) {
        let Some(view) = self.model.shares_view() else {
            if self.seen_view.get() {
                self.dialog.force_close();
            }
            return;
        };
        self.seen_view.set(true);
        self.dialog.set_title(&view.copy.shared_links_title);
        self.empty.set_title(&view.copy.shared_links_empty);
        if let Some(message) = &view.unreadable {
            self.unreadable.set_description(Some(message));
            self.stack.set_visible_child_name("unreadable");
        } else if view.shares.is_empty() {
            self.stack.set_visible_child_name("empty");
        } else {
            self.rebuild(&view);
            self.stack.set_visible_child_name("list");
        }
    }

    fn rebuild(self: &Rc<Self>, view: &SharesChanged) {
        let scroll = self.scroller.vadjustment();
        let position = scroll.value();
        self.list.remove_all();
        let on_action = self.actions.handler();
        for share in &view.shares {
            let updating = view.updating_id.as_deref() == Some(share.id.as_str());
            self.list.append(&share_row::row(
                share,
                &view.copy,
                updating,
                on_action.clone(),
            ));
        }
        scroll.set_value(position);
        glib::idle_add_local_once(move || scroll.set_value(position));
    }
}

#[cfg(feature = "testing")]
impl SharedLinksDialog {
    pub fn testing_activate(
        dialog: &adw::Dialog,
        share_id: &str,
        action: ShareActionId,
    ) -> Result<(), String> {
        let name = format!("share-row-{share_id}");
        let row = descendants(dialog.upcast_ref())
            .into_iter()
            .find(|widget| widget.widget_name() == name)
            .ok_or_else(|| format!("no row for share {share_id}"))?;
        row.activate_action(
            &format!(
                "{}.{}",
                share_row::ACTION_GROUP,
                share_row::action_name(action)
            ),
            None,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(feature = "testing")]
fn descendants(root: &gtk::Widget) -> Vec<gtk::Widget> {
    let mut found = Vec::new();
    let mut pending = vec![root.clone()];
    while let Some(widget) = pending.pop() {
        let mut child = widget.first_child();
        while let Some(next) = child {
            pending.push(next.clone());
            child = next.next_sibling();
        }
        found.push(widget);
    }
    found
}
