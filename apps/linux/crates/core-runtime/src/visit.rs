use std::future::Future;

use commitnote_core_api::commands::{AnalyticsVisit, AnalyticsVisitParams, AnalyticsVisitResult};
use soup::prelude::*;

use crate::runtime::CoreRuntime;
use crate::services::http::is_allowed;

const TIMEOUT_SECONDS: u32 = 30;

/// Delivers the anonymous launch count request. Implementations never report a result.
pub trait VisitSender {
    fn send(&self, url: &str);
}

/// Sends the visit with a session of its own: no cookie jar, no cache and no user agent of ours.
pub struct SoupVisitSender {
    session: soup::Session,
    allow_loopback_http: bool,
}

impl SoupVisitSender {
    /// Must be called on the thread whose default main context will drive the request.
    pub fn new() -> Self {
        Self::with_policy(false)
    }

    /// Also accepts plain `http` to `127.0.0.1`, for tests that run a local server.
    pub fn allowing_loopback_http() -> Self {
        Self::with_policy(true)
    }

    fn with_policy(allow_loopback_http: bool) -> Self {
        Self {
            session: soup::Session::builder().timeout(TIMEOUT_SECONDS).build(),
            allow_loopback_http,
        }
    }
}

impl Default for SoupVisitSender {
    fn default() -> Self {
        Self::new()
    }
}

impl VisitSender for SoupVisitSender {
    fn send(&self, url: &str) {
        // Keeps the query exactly as the core encoded it instead of re-encoding it.
        let Ok(uri) = glib::Uri::parse(url, glib::UriFlags::ENCODED) else {
            return;
        };
        if !is_allowed(&uri, self.allow_loopback_http) {
            return;
        }
        let message = soup::Message::from_uri("GET", &uri);
        let session = self.session.clone();
        glib::spawn_future_local(async move {
            let _ = session
                .send_and_read_future(&message, glib::Priority::DEFAULT)
                .await;
        });
    }
}

/// Asks the core for the visit URL and, when it returns one, hands it to `sender` once. Nothing
/// is awaited beyond the core's answer and failures are dropped without logging the URL.
pub fn run_visit<'a>(
    runtime: &CoreRuntime,
    sender: &'a dyn VisitSender,
) -> impl Future<Output = ()> + use<'a> {
    let pending = runtime.request::<AnalyticsVisit>(AnalyticsVisitParams {});
    async move {
        if let Ok(AnalyticsVisitResult { url: Some(url) }) = pending.await {
            sender.send(&url);
        }
    }
}

#[cfg(test)]
mod tests {
    use glib::prelude::StaticType;

    use super::*;

    #[test]
    fn the_session_keeps_no_cookies_and_no_cache() {
        let sender = SoupVisitSender::new();

        assert!(!sender.session.has_feature(soup::CookieJar::static_type()));
        assert!(!sender.session.has_feature(soup::Cache::static_type()));
    }
}
