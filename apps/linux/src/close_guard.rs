use commitnote_core_api::commands::FlushOutcome;

pub const UNSAVED_HEADING: &str = "Some Changes Are Not Saved";
pub const LOGOUT_INHIBIT_REASON: &str = "Notes are not saved yet";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseStep {
    CloseNow,
    Flush,
    Ignore,
    Ask { count: u32 },
    AskEarlyDraft,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseScope {
    Elsewhere,
    EarlyDraft,
    Notes,
}

/// What a close request does: a released window closes, a request during a guarded close is
/// dropped, the notes save first, text typed on the loading page asks, and anything else closes.
pub fn on_close_request(released: bool, guarding: bool, scope: CloseScope) -> CloseStep {
    if released || scope == CloseScope::Elsewhere {
        CloseStep::CloseNow
    } else if guarding {
        CloseStep::Ignore
    } else if scope == CloseScope::EarlyDraft {
        CloseStep::AskEarlyDraft
    } else {
        CloseStep::Flush
    }
}

pub fn should_inhibit_logout(unsaved_count: u32, early_draft_pending: bool) -> bool {
    unsaved_count > 0 || early_draft_pending
}

pub fn after_flush(outcome: &FlushOutcome) -> CloseStep {
    match outcome {
        FlushOutcome::Unsaved { count } if *count > 0 => CloseStep::Ask { count: *count },
        FlushOutcome::Saved | FlushOutcome::Unsaved { .. } => CloseStep::CloseNow,
    }
}

pub fn unsaved_body(count: u32) -> String {
    if count == 1 {
        "1 note is not saved yet. If you quit now, its changes are lost.".to_owned()
    } else {
        format!("{count} notes are not saved yet. If you quit now, the changes are lost.")
    }
}

pub trait Inhibitor {
    /// Returns the cookie, or 0 when nothing could take the request.
    fn inhibit(&self) -> u32;
    fn uninhibit(&self, cookie: u32);
}

/// Holds one logout inhibit while text is unsaved.
pub struct LogoutInhibit<I: Inhibitor> {
    inhibitor: I,
    held: Option<u32>,
}

impl<I: Inhibitor> LogoutInhibit<I> {
    pub fn new(inhibitor: I) -> Self {
        Self {
            inhibitor,
            held: None,
        }
    }

    pub fn update(&mut self, needed: bool) {
        if !needed {
            self.release();
        } else if self.held.is_none() {
            self.held = Some(self.inhibitor.inhibit());
        }
    }

    pub fn release(&mut self) {
        if let Some(cookie) = self.held.take()
            && cookie != 0
        {
            self.inhibitor.uninhibit(cookie);
        }
    }

    pub fn is_held(&self) -> bool {
        self.held.is_some()
    }
}

impl<I: Inhibitor> Drop for LogoutInhibit<I> {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    #[test]
    fn a_window_with_nothing_to_lose_or_a_released_window_closes_at_once() {
        use CloseScope::*;
        assert_eq!(
            on_close_request(false, false, Elsewhere),
            CloseStep::CloseNow
        );
        assert_eq!(
            on_close_request(false, true, Elsewhere),
            CloseStep::CloseNow
        );
        assert_eq!(on_close_request(true, true, Notes), CloseStep::CloseNow);
        assert_eq!(on_close_request(true, false, Notes), CloseStep::CloseNow);
        assert_eq!(
            on_close_request(true, true, EarlyDraft),
            CloseStep::CloseNow
        );
        assert_eq!(
            on_close_request(true, false, EarlyDraft),
            CloseStep::CloseNow
        );
    }

    #[test]
    fn a_session_saves_first_and_ignores_repeated_requests() {
        assert_eq!(
            on_close_request(false, false, CloseScope::Notes),
            CloseStep::Flush
        );
        assert_eq!(
            on_close_request(false, true, CloseScope::Notes),
            CloseStep::Ignore
        );
    }

    #[test]
    fn early_draft_text_asks_and_ignores_repeated_requests() {
        assert_eq!(
            on_close_request(false, false, CloseScope::EarlyDraft),
            CloseStep::AskEarlyDraft
        );
        assert_eq!(
            on_close_request(false, true, CloseScope::EarlyDraft),
            CloseStep::Ignore
        );
    }

    #[test]
    fn the_logout_is_held_back_for_unsaved_notes_or_early_draft_text() {
        assert!(!should_inhibit_logout(0, false));
        assert!(should_inhibit_logout(2, false));
        assert!(should_inhibit_logout(0, true));
        assert!(should_inhibit_logout(1, true));
    }

    #[test]
    fn a_flush_closes_when_saved_and_asks_with_the_count_otherwise() {
        assert_eq!(after_flush(&FlushOutcome::Saved), CloseStep::CloseNow);
        assert_eq!(
            after_flush(&FlushOutcome::Unsaved { count: 0 }),
            CloseStep::CloseNow
        );
        assert_eq!(
            after_flush(&FlushOutcome::Unsaved { count: 3 }),
            CloseStep::Ask { count: 3 }
        );
    }

    #[test]
    fn the_body_counts_the_notes() {
        assert_eq!(
            unsaved_body(1),
            "1 note is not saved yet. If you quit now, its changes are lost."
        );
        assert_eq!(
            unsaved_body(4),
            "4 notes are not saved yet. If you quit now, the changes are lost."
        );
    }

    #[derive(Default, Clone)]
    struct FakeInhibitor {
        cookie: u32,
        calls: Rc<RefCell<Vec<String>>>,
    }

    impl Inhibitor for FakeInhibitor {
        fn inhibit(&self) -> u32 {
            self.calls.borrow_mut().push("inhibit".to_owned());
            self.cookie
        }

        fn uninhibit(&self, cookie: u32) {
            self.calls.borrow_mut().push(format!("uninhibit {cookie}"));
        }
    }

    #[test]
    fn the_inhibit_is_held_exactly_while_it_is_needed() {
        let fake = FakeInhibitor {
            cookie: 7,
            ..FakeInhibitor::default()
        };
        let calls = fake.calls.clone();
        let mut inhibit = LogoutInhibit::new(fake);
        inhibit.update(false);
        assert!(!inhibit.is_held());
        inhibit.update(true);
        inhibit.update(true);
        assert!(inhibit.is_held());
        inhibit.update(false);
        assert!(!inhibit.is_held());
        inhibit.update(true);
        drop(inhibit);
        assert_eq!(
            *calls.borrow(),
            ["inhibit", "uninhibit 7", "inhibit", "uninhibit 7"]
        );
    }

    #[test]
    fn a_refused_request_is_not_repeated_or_released() {
        let fake = FakeInhibitor::default();
        let calls = fake.calls.clone();
        let mut inhibit = LogoutInhibit::new(fake);
        inhibit.update(true);
        inhibit.update(true);
        assert!(inhibit.is_held());
        inhibit.release();
        assert!(!inhibit.is_held());
        assert_eq!(*calls.borrow(), ["inhibit"]);
    }
}
