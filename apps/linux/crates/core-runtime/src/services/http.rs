use std::rc::Rc;
use std::time::Duration;

use futures_channel::oneshot;
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;
use gio::prelude::*;
use soup::prelude::*;

use super::{Http, HttpError, HttpFactory, HttpRequest, HttpResponse, ServiceError};
use crate::memory::LOG_DOMAIN;

const FAILURE: &str = "Network request failed";
const LOOPBACK_HOST: &str = "127.0.0.1";

#[derive(Debug, Clone)]
pub struct HttpPolicy {
    pub user_agent: String,
    pub allow_loopback_http: bool,
    pub timeout: Duration,
}

pub struct SoupHttp {
    session: soup::Session,
    allow_loopback_http: bool,
}

impl SoupHttp {
    /// Must be called on the thread whose default main context will drive the requests.
    pub fn new(policy: HttpPolicy) -> Self {
        let timeout = policy.timeout.as_secs() + u64::from(policy.timeout.subsec_nanos() > 0);
        let session = soup::Session::builder()
            .user_agent(policy.user_agent)
            .timeout(u32::try_from(timeout).unwrap_or(u32::MAX))
            .build();
        Self {
            session,
            allow_loopback_http: policy.allow_loopback_http,
        }
    }
}

pub fn soup_http_factory(policy: HttpPolicy) -> HttpFactory {
    Box::new(move || Rc::new(SoupHttp::new(policy)))
}

fn is_allowed(uri: &glib::Uri, allow_loopback_http: bool) -> bool {
    let host = uri.host();
    let host = host.as_deref().unwrap_or("");
    match uri.scheme().as_str() {
        "https" => !host.is_empty(),
        "http" => allow_loopback_http && host == LOOPBACK_HOST,
        _ => false,
    }
}

fn refuse(url: &str) -> HttpError {
    let scheme = glib::Uri::peek_scheme(url);
    glib::g_warning!(
        LOG_DOMAIN,
        "Refused a request with scheme {}",
        scheme.as_deref().unwrap_or("none")
    );
    ServiceError::new(FAILURE)
}

fn collect_headers(message: &soup::Message) -> Vec<(String, String)> {
    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(received) = message.response_headers() {
        received.foreach(|name, value| {
            let name = name.to_ascii_lowercase();
            match headers.iter_mut().find(|(existing, _)| *existing == name) {
                Some((_, joined)) => {
                    joined.push_str(", ");
                    joined.push_str(value);
                }
                None => headers.push((name, value.to_owned())),
            }
        });
    }
    headers
}

struct CancelOnDrop(gio::Cancellable);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl Http for SoupHttp {
    fn request(
        &self,
        request: HttpRequest,
    ) -> LocalBoxFuture<'static, Result<HttpResponse, HttpError>> {
        let allow_loopback_http = self.allow_loopback_http;
        let message = match glib::Uri::parse(&request.url, glib::UriFlags::NONE) {
            Ok(uri) if is_allowed(&uri, allow_loopback_http) => {
                soup::Message::from_uri(&request.method, &uri)
            }
            _ => return futures_util::future::ready(Err(refuse(&request.url))).boxed_local(),
        };

        if let Some(body) = request.body {
            message.set_request_body_from_bytes(None, Some(&glib::Bytes::from_owned(body)));
        }
        let request_headers = message.request_headers();
        if let Some(request_headers) = request_headers {
            for (name, value) in &request.headers {
                request_headers.append(name, value);
            }
        }

        let session = self.session.clone();
        async move {
            let cancellable = gio::Cancellable::new();
            let _cancel_on_drop = CancelOnDrop(cancellable.clone());
            message.connect_restarted({
                let cancellable = cancellable.clone();
                move |message| {
                    let allowed = message
                        .uri()
                        .is_some_and(|uri| is_allowed(&uri, allow_loopback_http));
                    if !allowed {
                        glib::g_warning!(LOG_DOMAIN, "Refused a redirect to a disallowed scheme");
                        cancellable.cancel();
                    }
                }
            });

            let (sender, receiver) = oneshot::channel();
            session.send_and_read_async(
                &message,
                glib::Priority::DEFAULT,
                Some(&cancellable),
                move |result| {
                    let _ = sender.send(result);
                },
            );
            let body = receiver
                .await
                .map_err(|_| ServiceError::new(FAILURE))?
                .map_err(|_| ServiceError::new(FAILURE))?;

            let status =
                u16::try_from(message.status_code()).map_err(|_| ServiceError::new(FAILURE))?;
            Ok(HttpResponse {
                status,
                headers: collect_headers(&message),
                body: body.to_vec(),
            })
        }
        .boxed_local()
    }
}
