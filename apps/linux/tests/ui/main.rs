mod flows;
mod p1;
mod p2;
mod support;

use std::process::ExitCode;
use std::time::Instant;

use adw::prelude::*;
use commitnote::config;
use gtk4::{self as gtk, gio};
use libadwaita as adw;

use support::{Case, Harness};

const SUITES: &[(&str, &[Case])] = &[("p1", p1::CASES), ("p2", p2::CASES)];

fn main() -> ExitCode {
    support::prepare_environment();
    if let Err(error) = gtk::init() {
        eprintln!("FAILED to start GTK: {error}");
        return ExitCode::FAILURE;
    }
    sourceview5::init();
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

    let filter = std::env::var("COMMITNOTE_UI_FILTER").unwrap_or_default();
    let mut ran = 0;
    let mut failed = 0;
    for &(prefix, cases) in SUITES {
        for &(name, case) in cases {
            if !name.contains(filter.as_str()) {
                continue;
            }
            ran += 1;
            let started = Instant::now();
            let result = harness
                .begin(prefix, name)
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
