use std::ffi::CString;
use std::panic::{AssertUnwindSafe, catch_unwind};

use glib::prelude::StaticType;
use glib::translate::{FromGlibPtrFull, FromGlibPtrNone, IntoGlib, IntoGlibPtr, ToGlibPtr};
use javascriptcore6 as jsc;
use javascriptcore6::ffi;
use zeroize::Zeroizing;

/// Its message becomes a JavaScript error message, so it must never carry note contents,
/// names or paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostError(pub String);

impl HostError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl From<crate::services::ServiceError> for HostError {
    fn from(error: crate::services::ServiceError) -> Self {
        Self(error.message().to_owned())
    }
}

impl From<commitnote_crypto::CryptoError> for HostError {
    fn from(error: commitnote_crypto::CryptoError) -> Self {
        Self(error.message().to_owned())
    }
}

pub(crate) type HostResult = Result<jsc::Value, HostError>;

type HostFunction = Box<dyn Fn(&[jsc::Value]) -> HostResult>;

unsafe extern "C" fn call_host_function(
    arguments: *mut glib::ffi::GPtrArray,
    data: glib::ffi::gpointer,
) -> *mut ffi::JSCValue {
    let function = unsafe { &*(data as *const HostFunction) };
    let values: Vec<jsc::Value> = if arguments.is_null() {
        Vec::new()
    } else {
        let arguments = unsafe { &*arguments };
        (0..arguments.len as usize)
            .map(|index| unsafe {
                jsc::Value::from_glib_none(*arguments.pdata.add(index) as *mut ffi::JSCValue)
            })
            .collect()
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| function(&values)));
    let Some(context) = jsc::Context::current() else {
        return std::ptr::null_mut();
    };
    match outcome {
        Ok(Ok(value)) => value.into_glib_ptr(),
        Ok(Err(error)) => {
            context.throw(&error.0);
            jsc::Value::new_undefined(&context).into_glib_ptr()
        }
        Err(_) => {
            context.throw("Host operation failed");
            jsc::Value::new_undefined(&context).into_glib_ptr()
        }
    }
}

unsafe extern "C" fn free_host_function(data: glib::ffi::gpointer) {
    drop(unsafe { Box::from_raw(data as *mut HostFunction) });
}

pub(crate) fn function(
    context: &jsc::Context,
    name: &str,
    body: impl Fn(&[jsc::Value]) -> HostResult + 'static,
) -> jsc::Value {
    let boxed: Box<HostFunction> = Box::new(Box::new(body));
    let name = CString::new(name).expect("function names have no NUL bytes");
    let callback: unsafe extern "C" fn(
        *mut glib::ffi::GPtrArray,
        glib::ffi::gpointer,
    ) -> *mut ffi::JSCValue = call_host_function;
    unsafe {
        jsc::Value::from_glib_full(ffi::jsc_value_new_function_variadic(
            context.to_glib_none().0,
            name.as_ptr(),
            Some(std::mem::transmute::<
                unsafe extern "C" fn(
                    *mut glib::ffi::GPtrArray,
                    glib::ffi::gpointer,
                ) -> *mut ffi::JSCValue,
                unsafe extern "C" fn(),
            >(callback)),
            Box::into_raw(boxed) as glib::ffi::gpointer,
            Some(free_host_function),
            jsc::Value::static_type().into_glib(),
        ))
    }
}

pub(crate) fn object(context: &jsc::Context, properties: &[(&str, jsc::Value)]) -> jsc::Value {
    let object = unsafe {
        jsc::Value::from_glib_full(ffi::jsc_value_new_object(
            context.to_glib_none().0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        ))
    };
    for (name, value) in properties {
        object.object_set_property(name, value);
    }
    object
}

pub(crate) fn array(context: &jsc::Context, items: &[jsc::Value]) -> jsc::Value {
    jsc::Value::new_array_from_garray(context, items)
}

pub(crate) fn string(context: &jsc::Context, value: &str) -> jsc::Value {
    jsc::Value::new_string(context, Some(value))
}

pub(crate) fn secret_string(context: &jsc::Context, value: &str) -> jsc::Value {
    debug_assert!(!value.as_bytes().contains(&0));
    let mut buffer = Zeroizing::new(Vec::with_capacity(value.len() + 1));
    buffer.extend_from_slice(value.as_bytes());
    buffer.push(0);
    // SAFETY: the buffer is NUL-terminated and outlives the call; the returned value is a full reference.
    unsafe {
        jsc::Value::from_glib_full(ffi::jsc_value_new_string(
            context.to_glib_none().0,
            buffer.as_ptr().cast(),
        ))
    }
}

pub(crate) fn number(context: &jsc::Context, value: f64) -> jsc::Value {
    jsc::Value::new_number(context, value)
}

pub(crate) fn undefined(context: &jsc::Context) -> jsc::Value {
    jsc::Value::new_undefined(context)
}

pub(crate) fn null(context: &jsc::Context) -> jsc::Value {
    jsc::Value::new_null(context)
}

pub(crate) fn uint8_array(context: &jsc::Context, bytes: &[u8]) -> HostResult {
    let array = jsc::Value::new_typed_array(context, jsc::TypedArrayType::Uint8, bytes.len());
    if bytes.is_empty() {
        return Ok(array);
    }
    let mut length = 0usize;
    let data = unsafe { ffi::jsc_value_typed_array_get_data(array.to_glib_none().0, &mut length) };
    if data.is_null() || length != bytes.len() {
        return Err(HostError::new("Could not allocate a Uint8Array"));
    }
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), data as *mut u8, bytes.len()) };
    Ok(array)
}

fn expected_bytes() -> HostError {
    HostError::new("Expected a Uint8Array")
}

pub(crate) fn bytes(value: Option<&jsc::Value>) -> Result<Vec<u8>, HostError> {
    let value = value.ok_or_else(expected_bytes)?;
    if !value.is_typed_array() || value.typed_array_get_type() != jsc::TypedArrayType::Uint8 {
        return Err(expected_bytes());
    }
    let size = value.typed_array_get_size();
    if size == 0 {
        return Ok(Vec::new());
    }
    let offset = value.typed_array_get_offset();
    let buffer = value.typed_array_get_buffer().ok_or_else(expected_bytes)?;
    let mut buffer_size = 0usize;
    let base =
        unsafe { ffi::jsc_value_array_buffer_get_data(buffer.to_glib_none().0, &mut buffer_size) };
    let end = offset.checked_add(size).ok_or_else(expected_bytes)?;
    if base.is_null() || end > buffer_size {
        return Err(expected_bytes());
    }
    Ok(unsafe { std::slice::from_raw_parts((base as *const u8).add(offset), size) }.to_vec())
}

pub(crate) fn is_absent(value: Option<&jsc::Value>) -> bool {
    value.is_none_or(|value| value.is_undefined() || value.is_null())
}

pub(crate) fn string_arg(value: Option<&jsc::Value>) -> Result<String, HostError> {
    match value {
        Some(value) if value.is_string() => Ok(value.to_str().to_string()),
        _ => Err(HostError::new("Expected a string")),
    }
}

pub(crate) fn number_arg(value: Option<&jsc::Value>) -> Result<f64, HostError> {
    let value = value
        .filter(|value| value.is_number())
        .ok_or_else(|| HostError::new("Expected a number"))?;
    let number = value.to_double();
    if !number.is_finite() {
        return Err(HostError::new("Expected a finite number"));
    }
    Ok(number)
}

pub(crate) fn integer_arg(
    value: Option<&jsc::Value>,
    min: f64,
    max: f64,
) -> Result<f64, HostError> {
    let number = match value {
        Some(value) if value.is_number() => value.to_double(),
        _ => return Err(HostError::new("Expected an integer")),
    };
    if !number.is_finite() || number.trunc() != number || number < min || number > max {
        return Err(HostError::new("Integer out of range"));
    }
    Ok(number)
}

pub(crate) fn bool_arg(value: Option<&jsc::Value>) -> Result<bool, HostError> {
    match value {
        Some(value) if value.is_boolean() => Ok(value.to_boolean()),
        _ => Err(HostError::new("Expected a boolean")),
    }
}

pub(crate) fn object_arg(value: Option<&jsc::Value>) -> Result<jsc::Value, HostError> {
    match value {
        Some(value) if value.is_object() && !value.is_null() => Ok(value.clone()),
        _ => Err(HostError::new("Expected an object")),
    }
}

pub(crate) fn property(object: &jsc::Value, name: &str) -> Option<jsc::Value> {
    object.object_get_property(name)
}

/// Takes the pending exception, reporting only its name: messages can quote note data.
pub(crate) fn take_exception_name(context: &jsc::Context) -> Option<String> {
    let exception = context.exception()?;
    context.clear_exception();
    Some(
        exception
            .name()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "unknown".to_owned()),
    )
}

pub(crate) fn take_exception_message(context: &jsc::Context) -> Option<String> {
    let exception = context.exception()?;
    context.clear_exception();
    Some(
        exception
            .message()
            .map(|message| message.to_string())
            .unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_string_round_trips_non_ascii_json() {
        let context = jsc::Context::new();
        let json = r#"{"passphrase":"zażółć gęślą jaźń ✓"}"#;
        let value = secret_string(&context, json);
        assert!(value.is_string());
        assert_eq!(value.to_str().as_str(), json);
    }

    #[test]
    fn secret_string_round_trips_empty_string() {
        let context = jsc::Context::new();
        let value = secret_string(&context, "");
        assert!(value.is_string());
        assert_eq!(value.to_str().as_str(), "");
    }
}
