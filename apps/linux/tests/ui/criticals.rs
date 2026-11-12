//! Records GLib CRITICAL messages so a case that makes GTK skip a call cannot pass silently.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use gtk4::glib;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Critical {
    domain: String,
    message: String,
}

struct Allowed {
    domain: &'static str,
    message_contains: &'static str,
    reason: &'static str,
}

/// CRITICALs that are known and tolerated. The message pattern must not contain a pointer address.
const ALLOWED: &[Allowed] = &[];

static RECORDED: Mutex<Vec<Critical>> = Mutex::new(Vec::new());

fn recorded() -> MutexGuard<'static, Vec<Critical>> {
    RECORDED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Must run before GTK starts, so that every message reaches the recorder.
pub fn install() {
    glib::log_set_writer_func(|level, fields| {
        if level == glib::LogLevel::Critical {
            let field = |key: &str| {
                fields
                    .iter()
                    .find(|field| field.key() == key)
                    .and_then(|field| field.value_str())
                    .unwrap_or_default()
                    .to_owned()
            };
            recorded().push(Critical {
                domain: field("GLIB_DOMAIN"),
                message: without_addresses(&field("MESSAGE")),
            });
        }
        glib::log_writer_default(level, fields)
    });
}

/// Pointer addresses differ per widget and run, which would keep equal messages apart.
fn without_addresses(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(start) = rest.find("0x") {
        let (before, hex) = rest.split_at(start + 2);
        out.push_str(before);
        out.push_str("...");
        rest = hex.trim_start_matches(|c: char| c.is_ascii_hexdigit());
    }
    out.push_str(rest);
    out
}

fn allowance(critical: &Critical) -> Option<&'static Allowed> {
    ALLOWED.iter().find(|allowed| {
        allowed.domain == critical.domain && critical.message.contains(allowed.message_contains)
    })
}

/// Takes the CRITICALs logged since the last call, as a failure reason unless all are allowed.
/// Allowed ones are printed with their reason, so a tolerated CRITICAL stays visible.
pub fn take_failure() -> Option<String> {
    let mut counts = BTreeMap::new();
    for critical in std::mem::take(&mut *recorded()) {
        if let Some(allowed) = allowance(&critical) {
            println!(
                "allowed {}-CRITICAL \"{}\": {}",
                allowed.domain, allowed.message_contains, allowed.reason
            );
        } else {
            *counts.entry(critical).or_insert(0_usize) += 1;
        }
    }
    if counts.is_empty() {
        return None;
    }
    let lines = counts
        .iter()
        .map(|(critical, count)| {
            format!(
                "{}-CRITICAL: {} (x{count})",
                critical.domain, critical.message
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    Some(format!("GLib CRITICALs were logged: {lines}"))
}
