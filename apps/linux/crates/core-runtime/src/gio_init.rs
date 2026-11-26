use std::sync::Once;

use glib::object::IsClass;
use glib::prelude::*;
use javascriptcore6 as jsc;

/// Initializes, once and on the calling thread, the process-wide GLib state the runtime uses from
/// other threads. Call it before any thread may create a runtime or an HTTP session.
///
/// GLib and GIO build their types and default singletons lazily, and some of those initializers
/// deadlock when two threads run them for the first time at once:
/// - the `SoupSession` class initializer waits for `GInetSocketAddress` to register while holding
///   the lock that registration needs;
/// - the default VFS (first used by a JavaScriptCore context) loads GIO modules while holding its
///   once, and the default proxy resolver holds the GIO module lock while its settings wait for
///   that VFS.
pub fn init_gio() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        gio::SocketAddress::static_type();
        gio::InetSocketAddress::static_type();
        gio::InetAddress::static_type();
        keep_class::<soup::Session>();
        keep_class::<jsc::Context>();
        gio::Vfs::default();
        gio::ProxyResolver::default();
        gio::TlsBackend::default();
        gio::Resolver::default();
    });
}

/// Holds a class reference for the life of the process, so its class is initialized exactly once.
fn keep_class<T: IsClass>() {
    let class = glib::Class::<T>::from_type(T::static_type()).expect("a classed type");
    std::mem::forget(class);
}
