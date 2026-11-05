use commitnote_core_api::Secret;
use gtk4::prelude::*;
use gtk4::{self as gtk, glib::translate::ToGlibPtr};
use zeroize::Zeroizing;

pub(crate) fn secret_text(editable: &impl IsA<gtk::Editable>) -> Secret {
    let editable = editable.as_ref();
    // SAFETY: main thread; the pointer stays valid until the next change to the text and is copied immediately.
    let text = unsafe {
        std::ffi::CStr::from_ptr(gtk::ffi::gtk_editable_get_text(editable.to_glib_none().0))
    };
    Secret::new(text.to_str().unwrap_or_default())
}

pub(crate) fn set_secret_text(editable: &impl IsA<gtk::Editable>, text: &str) {
    debug_assert!(!text.as_bytes().contains(&0));
    let mut buffer = Zeroizing::new(Vec::with_capacity(text.len() + 1));
    buffer.extend_from_slice(text.as_bytes());
    buffer.push(0);
    // SAFETY: main thread; the buffer is NUL-terminated and outlives the call, which copies it.
    unsafe {
        gtk::ffi::gtk_editable_set_text(editable.as_ref().to_glib_none().0, buffer.as_ptr().cast());
    }
}
