use commitnote_core_api::commands::LaunchAction;
use gtk4::{gio, glib, prelude::*};

const SCHEME: &str = "commitnote";
const ACTION_OPTION: &str = "--action";
const ACTION_QUERY_KEY: &str = "action";

/// Scans the command line without the program name: the first valid action wins, whether it
/// is given as `--action <name>`, `--action=<name>` or a `commitnote:` link.
pub fn action_from_arguments<S: AsRef<str>>(
    arguments: impl IntoIterator<Item = S>,
) -> Option<LaunchAction> {
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        let argument = argument.as_ref();
        let action = if argument == ACTION_OPTION {
            arguments
                .next()
                .and_then(|value| LaunchAction::from_wire(value.as_ref()))
        } else if let Some(value) = argument
            .strip_prefix(ACTION_OPTION)
            .and_then(|rest| rest.strip_prefix('='))
        {
            LaunchAction::from_wire(value)
        } else if is_commitnote_uri(argument) {
            action_from_uri(argument)
        } else {
            None
        };
        if action.is_some() {
            return action;
        }
    }
    None
}

/// The host of a `commitnote://<action>` link, or else the first `action` query item.
pub fn action_from_uri(uri: &str) -> Option<LaunchAction> {
    let uri = glib::Uri::parse(uri, glib::UriFlags::NONE).ok()?;
    if !uri.scheme().eq_ignore_ascii_case(SCHEME) {
        return None;
    }
    let from_host = uri
        .host()
        .and_then(|host| LaunchAction::from_wire(&host.to_ascii_lowercase()));
    from_host.or_else(|| {
        let query = uri.query()?;
        let value = query.split('&').find_map(|item| {
            let (key, value) = item.split_once('=')?;
            (glib::Uri::unescape_string(key, None)? == ACTION_QUERY_KEY).then_some(value)
        })?;
        LaunchAction::from_wire(&glib::Uri::unescape_string(value, None)?)
    })
}

/// Adds the parameterless `new-note` and `search` actions that the desktop entry's actions
/// and other D-Bus callers activate.
pub fn install_actions(
    application: &impl IsA<gio::ActionMap>,
    launch: impl Fn(LaunchAction) + Clone + 'static,
) {
    for action in [LaunchAction::NewNote, LaunchAction::Search] {
        let entry = gio::SimpleAction::new(action.as_str(), None);
        let launch = launch.clone();
        entry.connect_activate(move |_, _| launch(action));
        application.add_action(&entry);
    }
}

fn is_commitnote_uri(argument: &str) -> bool {
    argument
        .split_once(':')
        .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case(SCHEME))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW_NOTE: Option<LaunchAction> = Some(LaunchAction::NewNote);
    const SEARCH: Option<LaunchAction> = Some(LaunchAction::Search);

    #[test]
    fn the_action_option_takes_the_next_argument() {
        assert_eq!(action_from_arguments(["--action", "new-note"]), NEW_NOTE);
    }

    #[test]
    fn the_action_option_takes_an_inline_value() {
        assert_eq!(action_from_arguments(["--action=search"]), SEARCH);
    }

    #[test]
    fn an_invalid_value_is_consumed_by_its_option() {
        assert_eq!(
            action_from_arguments(["--action", "bogus", "new-note"]),
            None
        );
    }

    #[test]
    fn the_first_valid_action_wins() {
        assert_eq!(
            action_from_arguments(["--action", "bogus", "--action", "search"]),
            SEARCH
        );
        assert_eq!(
            action_from_arguments(["--action=search", "--action=new-note"]),
            SEARCH
        );
    }

    #[test]
    fn unrelated_arguments_are_skipped() {
        assert_eq!(
            action_from_arguments(["--gapplication-service", "notes.md", "--action", "search"]),
            SEARCH
        );
        assert_eq!(action_from_arguments(["notes.md", "--verbose"]), None);
        assert_eq!(action_from_arguments(Vec::<&str>::new()), None);
    }

    #[test]
    fn a_trailing_action_option_has_no_value() {
        assert_eq!(action_from_arguments(["--action"]), None);
    }

    #[test]
    fn a_link_argument_names_its_action() {
        assert_eq!(action_from_arguments(["commitnote://new-note"]), NEW_NOTE);
        assert_eq!(action_from_arguments(["x", "COMMITNOTE://Search"]), SEARCH);
    }

    #[test]
    fn the_host_names_the_action() {
        assert_eq!(action_from_uri("commitnote://new-note"), NEW_NOTE);
        assert_eq!(action_from_uri("COMMITNOTE://Search"), SEARCH);
    }

    #[test]
    fn the_query_names_the_action_when_the_host_does_not() {
        assert_eq!(action_from_uri("commitnote://open?action=search"), SEARCH);
        assert_eq!(
            action_from_uri("commitnote://open?other=1&action=new-note&action=search"),
            NEW_NOTE
        );
        assert_eq!(
            action_from_uri("commitnote://open?action=new%2Dnote"),
            NEW_NOTE
        );
    }

    #[test]
    fn the_host_wins_over_the_query() {
        assert_eq!(
            action_from_uri("commitnote://search?action=new-note"),
            SEARCH
        );
    }

    #[test]
    fn anything_else_is_not_a_launch_link() {
        assert_eq!(action_from_uri("commitnote:search"), None);
        assert_eq!(action_from_uri("https://new-note"), None);
        assert_eq!(action_from_uri("commitnote://bogus"), None);
        assert_eq!(action_from_uri("commitnote://open?action=bogus"), None);
        assert_eq!(action_from_uri("not a uri"), None);
    }
}
