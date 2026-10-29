use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use commitnote_crypto::{KeyAlgorithm, KeyStore};
use futures_channel::oneshot;
use javascriptcore6 as jsc;

use crate::js::{self, HostError, HostResult};
use crate::services::HostServices;
use crate::services::{
    BlobCacheEntry, BlobCacheStore, DeviceSettingsStore, Http, HttpRequest, ImageCodec, LogLevel,
    Logger, RememberedSessionRecord, RememberedSessionStore, RepoCoordinates, ServiceError,
    StagedInputs, crypto,
};

const HELPERS: &str = r#"(() => ({
  deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  },
  error(message) {
    return new Error(message);
  },
}))()"#;

const MAX_TIMER_DELAY_MS: f64 = 2_147_483_647.0;
const MAX_IMAGE_DIMENSION: f64 = 16_383.0;
const STOPPED: &str = "The core runtime has stopped";
const SAVE_SESSION_FAILED: &str = "Could not save the remembered session";
const LOAD_SESSION_FAILED: &str = "Could not load the remembered session";
const CLEAR_SESSION_FAILED: &str = "Could not clear the remembered session";
const BLOB_READ_FAILED: &str = "Blob cache read failed";
const BLOB_WRITE_FAILED: &str = "Blob cache write failed";

thread_local! {
    static CURRENT: RefCell<Weak<Host>> = const { RefCell::new(Weak::new()) };
}

struct Timer {
    source: glib::Source,
    callback: jsc::Value,
}

pub(crate) struct Host {
    pub(crate) context: jsc::Context,
    main_context: glib::MainContext,
    helpers: jsc::Value,
    pub(crate) keys: RefCell<KeyStore>,
    timers: RefCell<HashMap<u64, Timer>>,
    next_timer_id: Cell<u64>,
    tasks: RefCell<HashMap<u64, glib::JoinHandle<()>>>,
    next_task_id: Cell<u64>,
    storage_tail: RefCell<Option<oneshot::Receiver<()>>>,
    stopped: Cell<bool>,
    http: Rc<dyn Http>,
    remembered_session: Arc<dyn RememberedSessionStore>,
    blob_cache: Arc<dyn BlobCacheStore>,
    device_settings: RefCell<Box<dyn DeviceSettingsStore>>,
    pub(crate) logger: Arc<dyn Logger>,
    staged_inputs: Box<dyn StagedInputs>,
    image_codec: Box<dyn ImageCodec>,
    post: Box<dyn Fn(&str) -> bool>,
}

pub(crate) type Method = fn(&Rc<Host>, &[jsc::Value]) -> HostResult;

impl Host {
    /// Must run on the core thread, with `main_context` acquired as its thread default.
    /// `post` returns whether the message ended the session, which invalidates every key handle.
    pub(crate) fn new(
        context: jsc::Context,
        main_context: glib::MainContext,
        services: HostServices,
        post: impl Fn(&str) -> bool + 'static,
    ) -> Result<Rc<Self>, String> {
        let helpers = context.evaluate(HELPERS);
        if let Some(message) = js::take_exception_message(&context) {
            return Err(message);
        }
        let helpers = helpers
            .filter(|helpers| helpers.is_object())
            .ok_or_else(|| "Could not create the host helpers".to_owned())?;
        let host = Rc::new(Self {
            context,
            main_context,
            helpers,
            keys: RefCell::new(KeyStore::new()),
            timers: RefCell::default(),
            next_timer_id: Cell::new(1),
            tasks: RefCell::default(),
            next_task_id: Cell::new(1),
            storage_tail: RefCell::default(),
            stopped: Cell::new(false),
            http: (services.http)(),
            remembered_session: services.remembered_session,
            blob_cache: services.blob_cache,
            device_settings: RefCell::new(services.device_settings),
            logger: services.logger,
            staged_inputs: services.staged_inputs,
            image_codec: services.image_codec,
            post: Box::new(post),
        });
        CURRENT.with(|current| *current.borrow_mut() = Rc::downgrade(&host));
        Ok(host)
    }

    pub(crate) fn object(self: &Rc<Self>) -> jsc::Value {
        let context = &self.context;
        let group = |methods: &[(&str, Method)]| {
            let properties: Vec<(&str, jsc::Value)> = methods
                .iter()
                .map(|(name, body)| (*name, self.method(name, *body)))
                .collect();
            js::object(context, &properties)
        };
        js::object(
            context,
            &[
                ("crypto", group(crypto::METHODS)),
                ("random", group(&[("randomBytes", crypto::random_bytes)])),
                ("http", group(&[("request", http_request)])),
                (
                    "clock",
                    group(&[
                        ("now", now),
                        ("setTimeout", set_timeout),
                        ("clearTimeout", clear_timeout),
                    ]),
                ),
                (
                    "rememberedSession",
                    group(&[
                        ("save", save_remembered_session),
                        ("load", load_remembered_session),
                        ("clear", clear_remembered_session),
                    ]),
                ),
                (
                    "blobCache",
                    group(&[
                        ("get", blob_get),
                        ("put", blob_put),
                        ("touch", blob_touch),
                        ("delete", blob_delete),
                        ("list", blob_list),
                        ("listRepos", blob_list_repos),
                        ("deleteRepo", blob_delete_repo),
                    ]),
                ),
                (
                    "deviceSettings",
                    group(&[
                        ("getItem", settings_get_item),
                        ("setItem", settings_set_item),
                        ("removeItem", settings_remove_item),
                    ]),
                ),
                ("log", group(&[("log", log)])),
                ("stagedInputs", group(&[("take", take_staged_input)])),
                (
                    "imageCodec",
                    group(&[
                        ("decode", decode_image),
                        ("encodeWebp", encode_webp),
                        ("release", release_image),
                    ]),
                ),
                ("post", self.method("post", post)),
            ],
        )
    }

    /// The JS function holds the host weakly, so it never keeps the host alive.
    fn method(self: &Rc<Self>, name: &str, body: Method) -> jsc::Value {
        let host = Rc::downgrade(self);
        js::function(&self.context, name, move |arguments| {
            let host = host
                .upgrade()
                .filter(|host| !host.stopped.get())
                .ok_or_else(|| HostError::new(STOPPED))?;
            body(&host, arguments)
        })
    }

    pub(crate) fn undefined(&self) -> jsc::Value {
        js::undefined(&self.context)
    }

    pub(crate) fn bytes(&self, bytes: &[u8]) -> HostResult {
        js::uint8_array(&self.context, bytes)
    }

    fn string(&self, value: &str) -> jsc::Value {
        js::string(&self.context, value)
    }

    fn error(&self, message: &str) -> jsc::Value {
        self.helpers
            .object_invoke_methodv("error", &[self.string(message)])
            .unwrap_or_else(|| self.string(message))
    }

    pub(crate) fn log_exception(&self, during: &str) {
        if let Some(name) = js::take_exception_name(&self.context) {
            self.logger.log(
                LogLevel::Warn,
                &format!("JavaScript exception during {during}: {name}"),
            );
        }
    }

    /// Settles a promise on the core thread once `work` finishes. With `failure`, every
    /// rejection carries that message instead of the service's own.
    pub(crate) fn promise<T: 'static>(
        self: &Rc<Self>,
        failure: Option<&'static str>,
        work: impl Future<Output = Result<T, ServiceError>> + 'static,
        resolve: impl FnOnce(&Host, T) -> HostResult + 'static,
    ) -> HostResult {
        let deferred = self
            .helpers
            .object_invoke_methodv("deferred", &[])
            .filter(|deferred| deferred.is_object());
        if js::take_exception_name(&self.context).is_some() {
            return Err(HostError::new("Could not create a promise"));
        }
        let deferred = deferred.ok_or_else(|| HostError::new("Could not create a promise"))?;
        let part = |name| {
            js::property(&deferred, name)
                .ok_or_else(|| HostError::new("Could not create a promise"))
        };
        let (promise, on_resolve, on_reject) =
            (part("promise")?, part("resolve")?, part("reject")?);
        let task_id = self.next_task_id.get();
        self.next_task_id.set(task_id + 1);
        let weak = Rc::downgrade(self);
        let task = self.main_context.spawn_local(async move {
            let outcome = work.await;
            let Some(host) = weak.upgrade() else {
                return;
            };
            host.tasks.borrow_mut().remove(&task_id);
            if host.stopped.get() {
                return;
            }
            let settled = outcome
                .map_err(HostError::from)
                .and_then(|value| resolve(&host, value))
                .map_err(|error| failure.map(str::to_owned).unwrap_or(error.0));
            match settled {
                Ok(value) => on_resolve.function_callv(&[value]),
                Err(message) => on_reject.function_callv(&[host.error(&message)]),
            };
            host.log_exception("promise settlement");
        });
        self.tasks.borrow_mut().insert(task_id, task);
        Ok(promise)
    }

    /// Like [`Host::promise`], but storage operations run one at a time, in call order.
    fn storage<T: 'static>(
        self: &Rc<Self>,
        failure: &'static str,
        work: impl Future<Output = Result<T, ServiceError>> + 'static,
        resolve: impl FnOnce(&Host, T) -> HostResult + 'static,
    ) -> HostResult {
        let (done, finished) = oneshot::channel::<()>();
        let previous = self.storage_tail.replace(Some(finished));
        self.promise(
            Some(failure),
            async move {
                if let Some(previous) = previous {
                    let _ = previous.await;
                }
                let result = work.await;
                drop(done);
                result
            },
            resolve,
        )
    }

    fn fire_timer(&self, id: u64) {
        let timer = self.timers.borrow_mut().remove(&id);
        if let Some(timer) = timer
            && !self.stopped.get()
        {
            let _ = timer.callback.function_callv(&[]);
            self.log_exception("a timer callback");
        }
    }

    pub(crate) fn stop(&self) {
        self.stopped.set(true);
        let timers: Vec<Timer> = self
            .timers
            .borrow_mut()
            .drain()
            .map(|(_, timer)| timer)
            .collect();
        for timer in timers {
            timer.source.destroy();
        }
        let tasks: Vec<glib::JoinHandle<()>> = self
            .tasks
            .borrow_mut()
            .drain()
            .map(|(_, task)| task)
            .collect();
        for task in tasks {
            task.abort();
        }
        self.storage_tail.replace(None);
        self.keys.borrow_mut().clear();
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ServiceError> + Send + 'static,
) -> Result<T, ServiceError> {
    gio::spawn_blocking(work)
        .await
        .unwrap_or_else(|_| Err(ServiceError::new("Host operation failed")))
}

fn arg(arguments: &[jsc::Value], index: usize) -> Option<&jsc::Value> {
    arguments.get(index)
}

fn http_request(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let request = js::object_arg(arg(arguments, 0))?;
    let method = js::string_arg(js::property(&request, "method").as_ref())?;
    let url = js::string_arg(js::property(&request, "url").as_ref())?;
    let headers_value = js::object_arg(js::property(&request, "headers").as_ref())?;
    let mut headers = Vec::new();
    for name in headers_value.object_enumerate_properties() {
        let value = js::property(&headers_value, &name)
            .filter(|value| value.is_string())
            .ok_or_else(|| HostError::new("Expected string headers"))?;
        headers.push((name.to_string(), value.to_str().to_string()));
    }
    let body = js::property(&request, "body");
    let body = if js::is_absent(body.as_ref()) {
        None
    } else {
        Some(js::bytes(body.as_ref())?)
    };
    let response = host.http.request(HttpRequest {
        method,
        url,
        headers,
        body,
    });
    host.promise(None, response, |host, response| {
        let mut headers: BTreeMap<String, String> = BTreeMap::new();
        for (name, value) in response.headers {
            headers
                .entry(name.to_ascii_lowercase())
                .and_modify(|joined| {
                    joined.push_str(", ");
                    joined.push_str(&value);
                })
                .or_insert(value);
        }
        let headers: Vec<(&str, jsc::Value)> = headers
            .iter()
            .map(|(name, value)| (name.as_str(), host.string(value)))
            .collect();
        Ok(js::object(
            &host.context,
            &[
                (
                    "status",
                    js::number(&host.context, f64::from(response.status)),
                ),
                ("headers", js::object(&host.context, &headers)),
                ("body", host.bytes(&response.body)?),
            ],
        ))
    })
}

fn now(host: &Rc<Host>, _arguments: &[jsc::Value]) -> HostResult {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(js::number(&host.context, millis))
}

fn set_timeout(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let callback = arg(arguments, 0)
        .filter(|callback| callback.is_function())
        .cloned()
        .ok_or_else(|| HostError::new("The callback must be a function"))?;
    let requested = arg(arguments, 1)
        .filter(|delay| delay.is_number())
        .map(|delay| delay.to_double())
        .unwrap_or(0.0);
    let delay = if requested.is_finite() {
        requested.clamp(0.0, MAX_TIMER_DELAY_MS)
    } else {
        0.0
    };
    let id = host.next_timer_id.get();
    host.next_timer_id.set(id + 1);
    let source = glib::timeout_source_new(
        Duration::from_millis(delay as u64),
        None,
        glib::Priority::DEFAULT,
        move || {
            if let Some(host) = CURRENT.with(|current| current.borrow().upgrade()) {
                host.fire_timer(id);
            }
            glib::ControlFlow::Break
        },
    );
    source.attach(Some(&host.main_context));
    host.timers
        .borrow_mut()
        .insert(id, Timer { source, callback });
    Ok(js::number(&host.context, id as f64))
}

fn clear_timeout(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    if let Ok(id) = js::integer_arg(arg(arguments, 0), 1.0, u64::MAX as f64) {
        let timer = host.timers.borrow_mut().remove(&(id as u64));
        if let Some(timer) = timer {
            timer.source.destroy();
        }
    }
    Ok(host.undefined())
}

fn forge_kind(name: &str) -> Result<ForgeKind, HostError> {
    match name {
        "github" => Ok(ForgeKind::Github),
        "gitlab" => Ok(ForgeKind::Gitlab),
        _ => Err(HostError::new("Unknown forge")),
    }
}

fn forge_name(forge: ForgeKind) -> &'static str {
    match forge {
        ForgeKind::Github => "github",
        ForgeKind::Gitlab => "gitlab",
    }
}

fn save_remembered_session(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let record = js::object_arg(arg(arguments, 0))?;
    let text =
        |object: &jsc::Value, name: &str| js::string_arg(js::property(object, name).as_ref());
    let coordinates = js::object_arg(js::property(&record, "coordinates").as_ref())?;
    let keys = js::object_arg(js::property(&record, "keys").as_ref())?;
    let repo_url = text(&record, "repoUrl")?;
    let forge = forge_kind(&text(&coordinates, "forge")?)?;
    let owner = text(&coordinates, "owner")?;
    let repo = text(&coordinates, "repo")?;
    let access_token = Secret::new(text(&record, "accessToken")?);
    let handles = [
        text(&keys, "contentKey")?,
        text(&keys, "nameKey")?,
        text(&keys, "nameIvKey")?,
        text(&keys, "keyCheckKey")?,
    ];
    let [content_key, name_key, name_iv_key, key_check_key] = {
        let store = host.keys.borrow();
        let [a, b, c, d] = &handles;
        [
            store.export_raw(a)?,
            store.export_raw(b)?,
            store.export_raw(c)?,
            store.export_raw(d)?,
        ]
    };
    let record = RememberedSessionRecord {
        repo_url,
        coordinates: RepoCoordinates { forge, owner, repo },
        access_token,
        content_key,
        name_key,
        name_iv_key,
        key_check_key,
    };
    let store = host.remembered_session.clone();
    host.storage(
        SAVE_SESSION_FAILED,
        async move { store.save(record).await },
        |host, ()| Ok(host.undefined()),
    )
}

fn load_remembered_session(host: &Rc<Host>, _arguments: &[jsc::Value]) -> HostResult {
    let store = host.remembered_session.clone();
    host.storage(
        LOAD_SESSION_FAILED,
        async move { store.load().await },
        |host, record| {
            let Some(record) = record else {
                return Ok(js::null(&host.context));
            };
            let handles = {
                let mut keys = host.keys.borrow_mut();
                [
                    keys.import(&record.content_key, KeyAlgorithm::AesGcm)?,
                    keys.import(&record.name_key, KeyAlgorithm::AesGcm)?,
                    keys.import(&record.name_iv_key, KeyAlgorithm::HmacSha256)?,
                    keys.import(&record.key_check_key, KeyAlgorithm::HmacSha256)?,
                ]
            };
            let [content_key, name_key, name_iv_key, key_check_key] = handles;
            Ok(js::object(
                &host.context,
                &[
                    ("repoUrl", host.string(&record.repo_url)),
                    (
                        "coordinates",
                        js::object(
                            &host.context,
                            &[
                                ("forge", host.string(forge_name(record.coordinates.forge))),
                                ("owner", host.string(&record.coordinates.owner)),
                                ("repo", host.string(&record.coordinates.repo)),
                            ],
                        ),
                    ),
                    ("accessToken", host.string(record.access_token.expose())),
                    (
                        "keys",
                        js::object(
                            &host.context,
                            &[
                                ("contentKey", host.string(&content_key)),
                                ("nameKey", host.string(&name_key)),
                                ("nameIvKey", host.string(&name_iv_key)),
                                ("keyCheckKey", host.string(&key_check_key)),
                            ],
                        ),
                    ),
                ],
            ))
        },
    )
}

fn clear_remembered_session(host: &Rc<Host>, _arguments: &[jsc::Value]) -> HostResult {
    let store = host.remembered_session.clone();
    host.storage(
        CLEAR_SESSION_FAILED,
        async move { store.clear().await },
        |host, ()| Ok(host.undefined()),
    )
}

fn blob_key(arguments: &[jsc::Value]) -> Result<(String, String), HostError> {
    Ok((
        js::string_arg(arg(arguments, 0))?,
        js::string_arg(arg(arguments, 1))?,
    ))
}

fn blob_get(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let (repo_key, blob_sha) = blob_key(arguments)?;
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_READ_FAILED,
        blocking(move || store.get(&repo_key, &blob_sha)),
        |host, entry| {
            let Some(entry) = entry else {
                return Ok(js::null(&host.context));
            };
            Ok(js::object(
                &host.context,
                &[
                    ("bytes", host.bytes(&entry.bytes)?),
                    ("text", jsc::Value::new_boolean(&host.context, entry.text)),
                    ("lastUsedAt", js::number(&host.context, entry.last_used_at)),
                ],
            ))
        },
    )
}

fn blob_put(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let (repo_key, blob_sha) = blob_key(arguments)?;
    let entry = js::object_arg(arg(arguments, 2))?;
    let entry = BlobCacheEntry {
        bytes: js::bytes(js::property(&entry, "bytes").as_ref())?,
        text: js::bool_arg(js::property(&entry, "text").as_ref())?,
        last_used_at: js::number_arg(js::property(&entry, "lastUsedAt").as_ref())?,
    };
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_WRITE_FAILED,
        blocking(move || store.put(&repo_key, &blob_sha, entry)),
        |host, ()| Ok(host.undefined()),
    )
}

fn blob_touch(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let (repo_key, blob_sha) = blob_key(arguments)?;
    let last_used_at = js::number_arg(arg(arguments, 2))?;
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_WRITE_FAILED,
        blocking(move || store.touch(&repo_key, &blob_sha, last_used_at)),
        |host, ()| Ok(host.undefined()),
    )
}

fn blob_delete(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let (repo_key, blob_sha) = blob_key(arguments)?;
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_WRITE_FAILED,
        blocking(move || store.delete(&repo_key, &blob_sha)),
        |host, ()| Ok(host.undefined()),
    )
}

fn blob_list(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let repo_key = js::string_arg(arg(arguments, 0))?;
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_READ_FAILED,
        blocking(move || store.list(&repo_key)),
        |host, listings| {
            let items: Vec<jsc::Value> = listings
                .iter()
                .map(|listing| {
                    js::object(
                        &host.context,
                        &[
                            ("blobSha", host.string(&listing.blob_sha)),
                            ("size", js::number(&host.context, listing.size as f64)),
                            (
                                "lastUsedAt",
                                js::number(&host.context, listing.last_used_at),
                            ),
                        ],
                    )
                })
                .collect();
            Ok(js::array(&host.context, &items))
        },
    )
}

fn blob_list_repos(host: &Rc<Host>, _arguments: &[jsc::Value]) -> HostResult {
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_READ_FAILED,
        blocking(move || store.list_repos()),
        |host, repos| {
            let items: Vec<jsc::Value> = repos.iter().map(|repo| host.string(repo)).collect();
            Ok(js::array(&host.context, &items))
        },
    )
}

fn blob_delete_repo(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let repo_key = js::string_arg(arg(arguments, 0))?;
    let store = host.blob_cache.clone();
    host.storage(
        BLOB_WRITE_FAILED,
        blocking(move || store.delete_repo(&repo_key)),
        |host, ()| Ok(host.undefined()),
    )
}

fn settings_get_item(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let key = js::string_arg(arg(arguments, 0))?;
    let value = host.device_settings.borrow_mut().get_item(&key);
    Ok(match value {
        Some(value) => host.string(&value),
        None => js::null(&host.context),
    })
}

fn settings_set_item(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let key = js::string_arg(arg(arguments, 0))?;
    let value = js::string_arg(arg(arguments, 1))?;
    host.device_settings.borrow_mut().set_item(&key, &value)?;
    Ok(host.undefined())
}

fn settings_remove_item(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let key = js::string_arg(arg(arguments, 0))?;
    host.device_settings.borrow_mut().remove_item(&key)?;
    Ok(host.undefined())
}

fn log(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let level = match js::string_arg(arg(arguments, 0))?.as_str() {
        "debug" => LogLevel::Debug,
        "info" => LogLevel::Info,
        "warn" => LogLevel::Warn,
        _ => LogLevel::Error,
    };
    let message = js::string_arg(arg(arguments, 1))?;
    host.logger.log(level, &message);
    Ok(host.undefined())
}

fn take_staged_input(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let id = js::string_arg(arg(arguments, 0))?;
    match host.staged_inputs.take(&id)? {
        None => Ok(js::null(&host.context)),
        Some(input) => Ok(js::object(
            &host.context,
            &[
                ("bytes", host.bytes(&input.bytes)?),
                ("type", host.string(&input.mime_type)),
            ],
        )),
    }
}

fn decode_image(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let bytes = js::bytes(arg(arguments, 0))?;
    let decoded = host.image_codec.decode(bytes);
    host.promise(None, decoded, |host, image| {
        Ok(js::object(
            &host.context,
            &[
                ("handle", host.string(&image.handle)),
                ("width", js::number(&host.context, f64::from(image.width))),
                ("height", js::number(&host.context, f64::from(image.height))),
            ],
        ))
    })
}

fn encode_webp(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let handle = js::string_arg(arg(arguments, 0))?;
    let width = js::integer_arg(arg(arguments, 1), 1.0, MAX_IMAGE_DIMENSION)? as u32;
    let height = js::integer_arg(arg(arguments, 2), 1.0, MAX_IMAGE_DIMENSION)? as u32;
    let quality = js::number_arg(arg(arguments, 3))?;
    let encoded = host
        .image_codec
        .encode_webp(&handle, width, height, quality);
    host.promise(None, encoded, |host, bytes| host.bytes(&bytes))
}

fn release_image(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    host.image_codec
        .release(&js::string_arg(arg(arguments, 0))?);
    Ok(host.undefined())
}

fn post(host: &Rc<Host>, arguments: &[jsc::Value]) -> HostResult {
    let message = js::string_arg(arg(arguments, 0))?;
    if (host.post)(&message) {
        host.keys.borrow_mut().clear();
    }
    Ok(host.undefined())
}
