use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const MAIN_WINDOW: &str = "main";
const LAUNCH_ACTION_EVENT: &str = "desktop-launch-action";
const LAUNCH_ACTIONS: [&str; 2] = ["new-note", "search"];

fn valid_action(value: &str) -> Option<&'static str> {
    LAUNCH_ACTIONS.into_iter().find(|action| *action == value)
}

fn parse_launch_action<I, S>(args: I) -> Option<&'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let arg = arg.as_ref();
        if arg == "--action" {
            if let Some(action) = args.next().and_then(|value| valid_action(value.as_ref())) {
                return Some(action);
            }
        } else if let Some(action) = arg.strip_prefix("--action=").and_then(valid_action) {
            return Some(action);
        }
    }
    None
}

fn focus_main_window(app: &AppHandle, argv: Vec<String>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(action) = parse_launch_action(argv.iter().skip(1)) {
        let _ = app.emit_to(MAIN_WINDOW, LAUNCH_ACTION_EVENT, action);
    }
}

fn main() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let launch_action = parse_launch_action(std::env::args().skip(1));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            focus_main_window(app, argv);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            let url = match launch_action {
                Some(action) => format!("index.html?action={action}"),
                None => "index.html".to_owned(),
            };
            WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App(url.into()))
                .title("commitnote")
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 480.0)
                .resizable(true)
                .decorations(true)
                .zoom_hotkeys_enabled(false)
                .disable_drag_drop_handler()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running commitnote");
}

#[cfg(test)]
mod tests {
    use super::parse_launch_action;

    #[test]
    fn parses_separate_and_inline_action_values() {
        assert_eq!(parse_launch_action(["--action", "new-note"]), Some("new-note"));
        assert_eq!(parse_launch_action(["--action=search"]), Some("search"));
    }

    #[test]
    fn ignores_unknown_values_and_other_arguments() {
        assert_eq!(parse_launch_action(["--action", "delete"]), None);
        assert_eq!(parse_launch_action(["--action=", "file:///tmp/x.md"]), None);
        assert_eq!(
            parse_launch_action(["file:///tmp/x.md", "--action", "search"]),
            Some("search")
        );
        assert_eq!(parse_launch_action(Vec::<String>::new()), None);
    }
}
