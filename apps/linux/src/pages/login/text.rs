use commitnote_core_api::shapes::ForgeKind;

use crate::model::TokenError;

pub const BLANK_TOKEN_MESSAGE: &str = "Enter the access token.";
pub const LISTING_MESSAGE: &str = "Loading repositories…";
pub const CHECKING_MESSAGE: &str = "Checking repository…";
pub const NEW_REPOSITORY_NOTE: &str = "No notes repo yet? Create an empty private repository first, then give the token access to it.";
pub const NEW_REPOSITORY_PHRASE: &str = "Create an empty private repository";
pub const FOREIGN_HINT_PHRASE: &str = "create an empty private repository";

pub fn forge_id(forge: ForgeKind) -> &'static str {
    match forge {
        ForgeKind::Github => "github",
        ForgeKind::Gitlab => "gitlab",
    }
}

pub fn token_link_text(forge_name: &str) -> String {
    format!(
        "Create a token on {forge_name} with these settings filled in, then choose the repository there."
    )
}

pub fn token_error_text(error: &TokenError, forge_name: &str) -> String {
    match error {
        TokenError::NoRepositories => format!(
            "This access token has no access to any repository. Edit it on {forge_name} and add your notes repository."
        ),
        TokenError::Message(message) => message.clone(),
    }
}

pub fn is_blank(token: &str) -> bool {
    token.trim().is_empty()
}

pub fn visibility_label(private: bool) -> &'static str {
    if private { "Private" } else { "Public" }
}

pub fn progress_message(message: Option<String>, fallback: &str) -> String {
    message
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

pub fn preferred_forge_index(ids: &[&str], candidates: [Option<&str>; 2]) -> Option<usize> {
    candidates
        .into_iter()
        .flatten()
        .find_map(|wanted| ids.iter().position(|id| *id == wanted))
}

pub fn draft_token<'a>(
    draft_forge: Option<&str>,
    draft_token: Option<&'a str>,
    forge: &str,
) -> &'a str {
    match (draft_forge, draft_token) {
        (Some(draft_forge), Some(token)) if draft_forge == forge => token,
        _ => "",
    }
}

pub fn linked_markup(text: &str, phrase: &str, url: &str) -> String {
    let span = if phrase.is_empty() || url.is_empty() {
        None
    } else {
        text.find(phrase).map(|start| (start, start + phrase.len()))
    };
    match span {
        Some((start, end)) => format!(
            "{}<a href=\"{}\">{}</a>{}",
            escape(&text[..start]),
            escape(url),
            escape(phrase),
            escape(&text[end..]),
        ),
        None => escape(text),
    }
}

fn escape(text: &str) -> String {
    text.chars()
        .fold(String::with_capacity(text.len()), |mut out, c| {
            match c {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&apos;"),
                c => out.push(c),
            }
            out
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://github.com/new";

    #[test]
    fn links_the_exact_phrase_and_keeps_the_rest_as_text() {
        let markup = linked_markup(NEW_REPOSITORY_NOTE, NEW_REPOSITORY_PHRASE, URL);
        assert_eq!(
            markup,
            "No notes repo yet? <a href=\"https://github.com/new\">Create an empty private repository</a> first, then give the token access to it."
        );
    }

    #[test]
    fn links_only_the_first_occurrence() {
        let markup = linked_markup("make it, then make it again", "make it", URL);
        assert_eq!(
            markup,
            "<a href=\"https://github.com/new\">make it</a>, then make it again"
        );
    }

    #[test]
    fn escapes_markup_characters_in_text_phrase_and_url() {
        let markup = linked_markup(
            "Use <b> & \"quotes\": go there",
            "go there",
            "https://example.com/?a=1&b=<2>",
        );
        assert_eq!(
            markup,
            "Use &lt;b&gt; &amp; &quot;quotes&quot;: <a href=\"https://example.com/?a=1&amp;b=&lt;2&gt;\">go there</a>"
        );
    }

    #[test]
    fn escapes_markup_characters_inside_the_linked_phrase() {
        let markup = linked_markup("see a<b & c now", "a<b & c", URL);
        assert_eq!(
            markup,
            "see <a href=\"https://github.com/new\">a&lt;b &amp; c</a> now"
        );
    }

    #[test]
    fn a_missing_phrase_falls_back_to_plain_escaped_text() {
        let markup = linked_markup("Nothing <to> link & more", "create an empty", URL);
        assert_eq!(markup, "Nothing &lt;to&gt; link &amp; more");
    }

    #[test]
    fn the_phrase_match_is_case_sensitive() {
        let markup = linked_markup(NEW_REPOSITORY_NOTE, FOREIGN_HINT_PHRASE, URL);
        assert!(!markup.contains("<a "));
    }

    #[test]
    fn an_empty_phrase_or_url_gives_plain_text() {
        assert_eq!(linked_markup("a & b", "", URL), "a &amp; b");
        assert_eq!(linked_markup("a & b", "a", ""), "a &amp; b");
    }

    #[test]
    fn the_whole_text_can_be_the_link() {
        let text = token_link_text("Git<Lab>");
        assert_eq!(
            linked_markup(&text, &text, URL),
            "<a href=\"https://github.com/new\">Create a token on Git&lt;Lab&gt; with these settings filled in, then choose the repository there.</a>"
        );
    }

    #[test]
    fn no_repositories_names_the_forge() {
        assert_eq!(
            token_error_text(&TokenError::NoRepositories, "GitLab"),
            "This access token has no access to any repository. Edit it on GitLab and add your notes repository."
        );
    }

    #[test]
    fn core_messages_are_shown_verbatim() {
        let error = TokenError::Message("  The token <was> rejected & expired.  ".to_owned());
        assert_eq!(
            token_error_text(&error, "GitHub"),
            "  The token <was> rejected & expired.  "
        );
    }

    #[test]
    fn blank_tokens_are_detected() {
        assert!(is_blank(""));
        assert!(is_blank(" \t "));
        assert!(!is_blank(" ghp_x "));
    }

    #[test]
    fn progress_falls_back_when_there_is_no_message() {
        assert_eq!(progress_message(None, LISTING_MESSAGE), LISTING_MESSAGE);
        assert_eq!(
            progress_message(Some(String::new()), CHECKING_MESSAGE),
            CHECKING_MESSAGE
        );
        assert_eq!(
            progress_message(Some("Reading".to_owned()), CHECKING_MESSAGE),
            "Reading"
        );
    }

    #[test]
    fn forge_preference_follows_the_candidate_order() {
        let ids = ["github", "gitlab"];
        assert_eq!(
            preferred_forge_index(&ids, [Some("gitlab"), Some("github")]),
            Some(1)
        );
        assert_eq!(preferred_forge_index(&ids, [None, Some("gitlab")]), Some(1));
        assert_eq!(
            preferred_forge_index(&ids, [Some("bitbucket"), Some("gitlab")]),
            Some(1)
        );
        assert_eq!(preferred_forge_index(&ids, [None, None]), None);
        assert_eq!(preferred_forge_index(&[], [Some("github"), None]), None);
    }

    #[test]
    fn the_draft_token_applies_only_to_its_own_forge() {
        assert_eq!(draft_token(Some("github"), Some("t"), "github"), "t");
        assert_eq!(draft_token(Some("github"), Some("t"), "gitlab"), "");
        assert_eq!(draft_token(Some("github"), None, "github"), "");
        assert_eq!(draft_token(None, Some("t"), "github"), "");
    }

    #[test]
    fn forge_ids_match_the_model() {
        assert_eq!(forge_id(ForgeKind::Github), "github");
        assert_eq!(forge_id(ForgeKind::Gitlab), "gitlab");
    }

    #[test]
    fn visibility_labels() {
        assert_eq!(visibility_label(true), "Private");
        assert_eq!(visibility_label(false), "Public");
    }
}
