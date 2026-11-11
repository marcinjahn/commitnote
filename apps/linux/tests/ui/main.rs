mod flows;
mod p1;
mod p2;
mod p3;
mod p4;
mod p5;
mod p6;
mod smoke;
mod support;
mod tables;

use std::process::ExitCode;
use std::time::Instant;

use adw::prelude::*;
use commitnote::config;
use gtk4::{self as gtk, gio};
use libadwaita as adw;

use support::{Case, Harness, Keyring};

struct Suite {
    prefix: &'static str,
    cases: &'static [Case],
    keyring: Keyring,
}

const fn suite(prefix: &'static str, cases: &'static [Case], keyring: Keyring) -> Suite {
    Suite {
        prefix,
        cases,
        keyring,
    }
}

const SUITES: &[Suite] = &[
    suite("p1", p1::CASES, Keyring::Provided),
    suite("p2", p2::CASES, Keyring::Provided),
    suite("p3", p3::CASES, Keyring::Provided),
    suite("p4", p4::CASES, Keyring::Provided),
    suite("p5", p5::CASES, Keyring::Provided),
    suite("p6", p6::CASES, Keyring::Provided),
    suite("tables", tables::CASES, Keyring::Provided),
    suite("smoke", smoke::CASES, Keyring::Absent),
];

/// The suites named by `COMMITNOTE_UI_SUITES`; without it, the ones that run against a keyring.
fn selected_suites() -> Result<Vec<&'static Suite>, String> {
    let Some(names) = std::env::var("COMMITNOTE_UI_SUITES")
        .ok()
        .filter(|names| !names.trim().is_empty())
    else {
        return Ok(SUITES
            .iter()
            .filter(|suite| suite.keyring == Keyring::Provided)
            .collect());
    };
    names
        .split(',')
        .map(str::trim)
        .map(|name| {
            SUITES
                .iter()
                .find(|suite| suite.prefix == name)
                .ok_or_else(|| format!("unknown suite \"{name}\""))
        })
        .collect()
}

fn main() -> ExitCode {
    support::prepare_environment();
    if let Err(error) = gtk::init() {
        eprintln!("FAILED to start GTK: {error}");
        return ExitCode::FAILURE;
    }
    commitnote::print::initialize_web_engine();
    sourceview5::init();
    commitnote::fonts::register_bundled_fonts();
    commitnote::register_resources();
    if let Some(settings) = gtk::Settings::default() {
        settings.set_gtk_enable_animations(false);
    }

    let application = adw::Application::builder()
        .application_id(config::APP_ID)
        .flags(gio::ApplicationFlags::NON_UNIQUE)
        .resource_base_path(config::RESOURCE_PREFIX.trim_end_matches('/'))
        .build();
    if let Err(error) = application.register(None::<&gio::Cancellable>) {
        eprintln!("FAILED to register the application: {error}");
        return ExitCode::FAILURE;
    }

    let mut harness = match Harness::new(application) {
        Ok(harness) => harness,
        Err(error) => {
            eprintln!("FAILED to prepare the harness: {error}");
            return ExitCode::FAILURE;
        }
    };

    let suites = match selected_suites() {
        Ok(suites) => suites,
        Err(error) => {
            eprintln!("FAILED to select the suites: {error}");
            return ExitCode::FAILURE;
        }
    };
    let filter = std::env::var("COMMITNOTE_UI_FILTER").unwrap_or_default();
    let mut ran = 0;
    let mut failed = 0;
    for suite in suites {
        for &(name, case) in suite.cases {
            if !name.contains(filter.as_str()) {
                continue;
            }
            ran += 1;
            let started = Instant::now();
            let result = harness
                .begin(suite.prefix, suite.keyring, name)
                .and_then(|()| case(&mut harness));
            if result.is_err() {
                harness.save_failure();
            }
            harness.finish();
            let seconds = started.elapsed().as_secs_f32();
            match result {
                Ok(()) => println!("ok {name} ({seconds:.1}s)"),
                Err(reason) => {
                    failed += 1;
                    println!("FAILED {name} ({seconds:.1}s): {reason}");
                }
            }
        }
    }
    harness.cleanup();

    if ran == 0 {
        println!("FAILED: no case matches \"{filter}\"");
        return ExitCode::FAILURE;
    }
    println!("{} of {ran} cases passed", ran - failed);
    if failed > 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
