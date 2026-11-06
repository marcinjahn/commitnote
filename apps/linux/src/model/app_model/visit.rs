use std::cell::Cell;

use super::AppModel;

thread_local! {
    static LAUNCH_COUNTED: Cell<bool> = const { Cell::new(false) };
}

impl AppModel {
    /// Counts the launch once per process: a later core start, log-out or repository change
    /// sends nothing. The request is never awaited by a user-facing flow.
    pub(super) fn count_launch(&self) {
        if LAUNCH_COUNTED.replace(true) {
            return;
        }
        let Some(client) = self.client() else {
            return;
        };
        self.spawn(async move {
            let sender = launch_sender();
            client.run_visit(&sender).await;
        });
    }
}

#[cfg(not(feature = "testing"))]
fn launch_sender() -> commitnote_core_runtime::SoupVisitSender {
    commitnote_core_runtime::SoupVisitSender::new()
}

#[cfg(feature = "testing")]
fn launch_sender() -> testing::RecordingSender {
    testing::RecordingSender
}

#[cfg(feature = "testing")]
mod testing {
    use std::cell::RefCell;

    use commitnote_core_runtime::VisitSender;

    use super::AppModel;

    thread_local! {
        static SENT: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

    pub(super) struct RecordingSender;

    impl VisitSender for RecordingSender {
        fn send(&self, url: &str) {
            SENT.with_borrow_mut(|sent| sent.push(url.to_owned()));
        }
    }

    impl AppModel {
        /// The visit URLs the app asked to send on this thread, in order.
        pub fn testing_visits(&self) -> Vec<String> {
            SENT.with_borrow(Clone::clone)
        }
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use super::super::Route;
    use super::super::tests::{Session, fake_bundle, run};

    const LINUX_VISIT: &str = "https://analytics.invalid/count?p=%2Fapp%2Flinux&t=App%20(Linux)";

    #[test]
    fn two_logins_in_one_process_record_one_visit() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            session
                .wait_until("the visit", |model| !model.testing_visits().is_empty())
                .await;
            assert_eq!(session.model.testing_visits(), [LINUX_VISIT]);

            session.model.log_out().await.expect("the session logs out");
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            session.log_in().await;

            assert_eq!(session.model.testing_visits(), [LINUX_VISIT]);
        });
    }
}
