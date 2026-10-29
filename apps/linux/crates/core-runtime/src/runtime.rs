use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle, ThreadId};

use commitnote_core_api::{
    Command, CoreError, CoreErrorKind, CoreEvent, Incoming, NATIVE_CORE_API_VERSION,
    NATIVE_CORE_MARKER, Request, decode_result, parse_incoming,
};
use futures_channel::oneshot;
use javascriptcore6 as jsc;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::host::Host;
use crate::js;
use crate::services::{HostServices, LogLevel, Logger};

const THREAD_NAME: &str = "commitnote-core";
const PLATFORM: &str = "linux";
const GLOBAL_NAME: &str = "CommitnoteNativeCore";

pub struct RuntimeConfig {
    pub bundle: String,
    pub device_model: String,
    pub services: HostServices,
}

impl RuntimeConfig {
    pub fn new(bundle: impl Into<String>, device_model: impl Into<String>) -> Self {
        Self {
            bundle: bundle.into(),
            device_model: device_model.into(),
            services: HostServices::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartError {
    BundleInvalid,
    ApiVersionMismatch { expected: u32, found: i64 },
    JavaScriptException(String),
    ThreadFailed,
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BundleInvalid => f.write_str("the core bundle is invalid"),
            Self::ApiVersionMismatch { expected, found } => write!(
                f,
                "the core bundle has API version {found}, expected {expected}"
            ),
            Self::JavaScriptException(message) => {
                write!(f, "the core bundle threw an exception: {message}")
            }
            Self::ThreadFailed => f.write_str("the core thread could not start"),
        }
    }
}

impl std::error::Error for StartError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestError {
    Core(CoreError),
    Stopped,
    Decode(String),
}

impl fmt::Display for RequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Core(error) => write!(f, "the core answered with an error: {error}"),
            Self::Stopped => f.write_str("the core runtime has stopped"),
            Self::Decode(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for RequestError {}

type Pending = oneshot::Sender<Result<Value, RequestError>>;

#[derive(Default)]
struct RouterState {
    stopped: bool,
    last_id: i64,
    pending: HashMap<i64, Pending>,
}

struct Router {
    state: Mutex<RouterState>,
    subscribers: Mutex<Vec<async_channel::Sender<CoreEvent>>>,
    logger: Arc<dyn Logger>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Router {
    fn register(&self) -> Option<(i64, oneshot::Receiver<Result<Value, RequestError>>)> {
        let mut state = lock(&self.state);
        if state.stopped {
            return None;
        }
        state.last_id += 1;
        let id = state.last_id;
        let (sender, receiver) = oneshot::channel();
        state.pending.insert(id, sender);
        Some((id, receiver))
    }

    fn forget(&self, id: i64) {
        lock(&self.state).pending.remove(&id);
    }

    fn settle(&self, id: i64, result: Result<Value, RequestError>) -> bool {
        let pending = lock(&self.state).pending.remove(&id);
        match pending {
            Some(sender) => {
                let _ = sender.send(result);
                true
            }
            None => false,
        }
    }

    fn is_stopped(&self) -> bool {
        lock(&self.state).stopped
    }

    /// Returns whether the message announced the end of the session.
    fn receive(&self, message: &str) -> bool {
        match parse_incoming(message) {
            Err(error) => {
                self.logger
                    .log(LogLevel::Warn, &format!("Ignored a core message: {error}"));
                false
            }
            Ok(Incoming::Response { id, result }) => {
                let kind = result
                    .as_ref()
                    .err()
                    .map(|error| error.kind.as_str().to_owned());
                if !self.settle(id, result.map_err(RequestError::Core)) && !self.is_stopped() {
                    let detail = kind.as_deref().unwrap_or("ok");
                    self.logger.log(
                        LogLevel::Warn,
                        &format!("Ignored a core response for unknown request {id} ({detail})"),
                    );
                }
                false
            }
            Ok(Incoming::Event(event)) => {
                lock(&self.subscribers)
                    .retain(|subscriber| subscriber.try_send(event.clone()).is_ok());
                matches!(event, CoreEvent::SessionEnded { .. })
            }
        }
    }

    fn stop(&self) {
        let pending = {
            let mut state = lock(&self.state);
            state.stopped = true;
            std::mem::take(&mut state.pending)
        };
        for sender in pending.into_values() {
            let _ = sender.send(Err(RequestError::Stopped));
        }
        lock(&self.subscribers).clear();
    }
}

struct CoreState {
    host: Rc<Host>,
    handle: jsc::Value,
    main_loop: glib::MainLoop,
}

thread_local! {
    static CORE: RefCell<Option<CoreState>> = const { RefCell::new(None) };
}

fn core_parts() -> Option<(Rc<Host>, jsc::Value, glib::MainLoop)> {
    CORE.with(|core| {
        core.borrow().as_ref().map(|state| {
            (
                state.host.clone(),
                state.handle.clone(),
                state.main_loop.clone(),
            )
        })
    })
}

pub struct CoreRuntime {
    router: Arc<Router>,
    context: glib::MainContext,
    thread: Mutex<Option<JoinHandle<()>>>,
    thread_id: ThreadId,
}

impl CoreRuntime {
    /// Blocks until the bundle has started.
    pub fn start(config: RuntimeConfig) -> Result<Self, StartError> {
        let router = Arc::new(Router {
            state: Mutex::default(),
            subscribers: Mutex::default(),
            logger: config.services.logger.clone(),
        });
        let context = glib::MainContext::new();
        let (ready, started) = mpsc::channel();
        let thread = thread::Builder::new()
            .name(THREAD_NAME.to_owned())
            .spawn({
                let context = context.clone();
                let router = router.clone();
                move || run(context, router, config, ready)
            })
            .map_err(|_| StartError::ThreadFailed)?;
        let outcome = started.recv().unwrap_or(Err(StartError::ThreadFailed));
        if let Err(error) = outcome {
            let _ = thread.join();
            return Err(error);
        }
        Ok(Self {
            router,
            context,
            thread_id: thread.thread().id(),
            thread: Mutex::new(Some(thread)),
        })
    }

    /// The request is registered before it reaches the core, so its response can never be missed.
    pub fn send(
        &self,
        command: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, RequestError>> + Send + use<> {
        response(
            self.dispatch(|id| Ok(Zeroizing::new(Request::new(id, command, params).to_json()))),
        )
    }

    pub fn request<C: Command>(
        &self,
        params: C::Params,
    ) -> impl Future<Output = Result<C::Result, RequestError>> + Send + use<C> {
        let response = response(self.dispatch(|id| {
            Request::command_json::<C>(id, &params)
                .map_err(|error| RequestError::Decode(error.to_string()))
        }));
        async move {
            let value = response.await?;
            decode_result::<C>(value).map_err(|error| RequestError::Decode(error.to_string()))
        }
    }

    fn dispatch(
        &self,
        build: impl FnOnce(i64) -> Result<Zeroizing<String>, RequestError>,
    ) -> Result<oneshot::Receiver<Result<Value, RequestError>>, RequestError> {
        let (id, receiver) = self.router.register().ok_or(RequestError::Stopped)?;
        let json = match build(id) {
            Ok(json) => json,
            Err(error) => {
                self.router.forget(id);
                return Err(error);
            }
        };
        let router = self.router.clone();
        self.context.invoke(move || deliver(&router, id, json));
        Ok(receiver)
    }

    /// Every subscriber receives every event emitted after it subscribed.
    pub fn subscribe(&self) -> async_channel::Receiver<CoreEvent> {
        let (sender, receiver) = async_channel::unbounded();
        if !self.router.is_stopped() {
            lock(&self.router.subscribers).push(sender);
        }
        receiver
    }

    pub fn stop(&self) {
        let first = !self.router.is_stopped();
        self.router.stop();
        if first {
            self.context.invoke(stop_core);
        }
        if thread::current().id() == self.thread_id {
            return;
        }
        let thread = lock(&self.thread).take();
        if let Some(thread) = thread {
            let _ = thread.join();
        }
    }
}

impl Drop for CoreRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(
    context: glib::MainContext,
    router: Arc<Router>,
    config: RuntimeConfig,
    ready: mpsc::Sender<Result<(), StartError>>,
) {
    let _ = context.clone().with_thread_default(move || {
        let main_loop = glib::MainLoop::new(Some(&context), false);
        match boot(&context, &router, config) {
            Ok((host, handle)) => {
                CORE.with(|core| {
                    *core.borrow_mut() = Some(CoreState {
                        host,
                        handle,
                        main_loop: main_loop.clone(),
                    })
                });
                let _ = ready.send(Ok(()));
                main_loop.run();
                if let Some(state) = CORE.with(|core| core.borrow_mut().take()) {
                    state.host.stop();
                }
            }
            Err(error) => {
                let _ = ready.send(Err(error));
            }
        }
    });
}

fn boot(
    context: &glib::MainContext,
    router: &Arc<Router>,
    config: RuntimeConfig,
) -> Result<(Rc<Host>, jsc::Value), StartError> {
    let post_router = router.clone();
    let host = Host::new(
        jsc::Context::new(),
        context.clone(),
        config.services,
        move |message| post_router.receive(message),
    )
    .map_err(StartError::JavaScriptException)?;
    match start_bundle(&host, &config.bundle, &config.device_model) {
        Ok(handle) => Ok((host, handle)),
        Err(error) => {
            host.stop();
            Err(error)
        }
    }
}

fn start_bundle(
    host: &Rc<Host>,
    bundle: &str,
    device_model: &str,
) -> Result<jsc::Value, StartError> {
    let context = &host.context;
    let thrown = |context: &jsc::Context| {
        js::take_exception_message(context).map(StartError::JavaScriptException)
    };
    context.evaluate(bundle);
    if let Some(error) = thrown(context) {
        return Err(error);
    }
    let global = context
        .value(GLOBAL_NAME)
        .filter(|global| global.is_object())
        .ok_or(StartError::BundleInvalid)?;
    let marker = js::property(&global, "marker").filter(|marker| marker.is_string());
    if marker.is_none_or(|marker| marker.to_str() != NATIVE_CORE_MARKER) {
        return Err(StartError::BundleInvalid);
    }
    let version = js::property(&global, "apiVersion")
        .filter(|version| version.is_number())
        .map(|version| version.to_double())
        .filter(|version| version.is_finite() && version.fract() == 0.0)
        .ok_or(StartError::BundleInvalid)?;
    if version != f64::from(NATIVE_CORE_API_VERSION) {
        return Err(StartError::ApiVersionMismatch {
            expected: NATIVE_CORE_API_VERSION,
            found: version as i64,
        });
    }
    if !js::property(&global, "start").is_some_and(|start| start.is_function()) {
        return Err(StartError::BundleInvalid);
    }
    let options = js::object(
        context,
        &[
            ("deviceModel", js::string(context, device_model)),
            ("platform", js::string(context, PLATFORM)),
        ],
    );
    let handle = global.object_invoke_methodv("start", &[host.object(), options]);
    if let Some(error) = thrown(context) {
        return Err(error);
    }
    handle
        .filter(|handle| handle.is_object())
        .ok_or(StartError::BundleInvalid)
}

async fn response(
    receiver: Result<oneshot::Receiver<Result<Value, RequestError>>, RequestError>,
) -> Result<Value, RequestError> {
    receiver?.await.unwrap_or(Err(RequestError::Stopped))
}

fn deliver(router: &Router, id: i64, json: Zeroizing<String>) {
    let Some((host, handle, _)) = core_parts() else {
        router.settle(id, Err(RequestError::Stopped));
        return;
    };
    if router.is_stopped() {
        return;
    }
    let _ = handle.object_invoke_methodv("send", &[js::secret_string(&host.context, &json)]);
    if let Some(name) = js::take_exception_name(&host.context) {
        host.logger.log(
            LogLevel::Error,
            &format!("The core threw {name} while handling request {id}"),
        );
        router.settle(
            id,
            Err(RequestError::Core(CoreError::new(
                CoreErrorKind::Internal,
                "The core threw an exception",
                false,
            ))),
        );
    }
}

fn stop_core() {
    let Some((host, handle, main_loop)) = core_parts() else {
        return;
    };
    let _ = handle.object_invoke_methodv("stop", &[]);
    host.log_exception("stop");
    host.stop();
    main_loop.quit();
}
