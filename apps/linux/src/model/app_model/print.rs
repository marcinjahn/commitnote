use commitnote_core_api::commands::{PrintRender, PrintRenderParams};
use commitnote_core_api::shapes::OpenNote;

use super::{AppModel, EditorTarget, State, UserError, warn};

impl AppModel {
    /// Whether the editor holds a saved note or a draft that can be printed.
    pub fn can_print(&self) -> bool {
        print_source(&self.state()).is_some()
    }

    /// Sends the pending edits, then renders the note or draft in the editor to a printable HTML
    /// document; `None` when nothing printable is open.
    pub async fn render_print_document(&self) -> Result<Option<String>, UserError> {
        self.flush_edits().await;
        let Some(params) = print_source(&self.state()) else {
            return Ok(None);
        };
        match self.request::<PrintRender>(params).await {
            Ok(result) => Ok(Some(result.html)),
            Err(error) => {
                warn("could not render a note for printing", &error);
                Err(UserError::from(error))
            }
        }
    }
}

fn print_source(state: &State) -> Option<PrintRenderParams> {
    match &state.editor_target {
        EditorTarget::None => None,
        EditorTarget::Draft(_) => Some(PrintRenderParams {
            name: state.draft_name.clone(),
            text: state.draft_body.clone(),
        }),
        EditorTarget::Note(path) => match &state.open_note {
            Some(OpenNote::Loaded {
                path: loaded,
                content,
                ..
            }) if loaded == path => Some(PrintRenderParams {
                name: path.last()?.clone(),
                text: content.clone(),
            }),
            _ => None,
        },
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use super::super::DraftFocus;
    use super::super::tests::{Session, fake_bundle, open_and_read, run};

    #[test]
    fn a_saved_note_prints_its_name_and_edited_text() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            assert!(!session.model.can_print());
            assert_eq!(session.model.render_print_document().await, Ok(None));
            let path = vec!["Welcome".to_owned()];
            open_and_read(&session, &path).await;
            assert!(session.model.can_print());

            session.model.edit("Printed paragraph\n".to_owned());
            let html = session
                .model
                .render_print_document()
                .await
                .expect("the note renders")
                .expect("the note is printable");

            assert!(html.contains("<title>Welcome</title>"), "{html}");
            assert!(html.contains("Printed paragraph"), "{html}");
        });
    }

    #[test]
    fn a_draft_prints_its_draft_name() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session
                .model
                .start_draft(Vec::new(), DraftFocus::Name)
                .await
                .expect("a draft starts at the root");
            session.model.set_draft_name("Unsaved plan".to_owned());
            assert!(session.model.can_print());

            let html = session
                .model
                .render_print_document()
                .await
                .expect("the draft renders")
                .expect("the draft is printable");

            assert!(html.contains("<title>Unsaved plan</title>"), "{html}");
        });
    }
}
