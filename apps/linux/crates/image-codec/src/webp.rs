use std::ffi::c_int;
use std::ptr;

use libwebp_sys::{WebPEncodeRGBA, WebPFree};

/// `pixels` must hold exactly `width * height` RGBA8 pixels, and both sides must be
/// within libwebp's dimension limit.
pub(crate) fn encode_rgba(pixels: &[u8], width: u32, height: u32, quality: f32) -> Option<Vec<u8>> {
    let stride = width.checked_mul(4)?;
    if pixels.len() != usize::try_from(stride).ok()? * usize::try_from(height).ok()? {
        return None;
    }
    let width = c_int::try_from(width).ok()?;
    let height = c_int::try_from(height).ok()?;
    let stride = c_int::try_from(stride).ok()?;
    let mut output: *mut u8 = ptr::null_mut();
    // SAFETY: `pixels` is a live buffer of exactly `stride * height` bytes, checked above,
    // that libwebp only reads; `output` is a valid out-pointer that libwebp sets to a buffer
    // it allocates, or leaves null on failure.
    let size =
        unsafe { WebPEncodeRGBA(pixels.as_ptr(), width, height, stride, quality, &mut output) };
    if output.is_null() {
        return None;
    }
    let encoded = if size == 0 {
        None
    } else {
        // SAFETY: on success libwebp returns a non-null buffer of `size` initialised bytes,
        // which stays valid until it is freed below.
        Some(unsafe { std::slice::from_raw_parts(output, size) }.to_vec())
    };
    // SAFETY: `output` was allocated by libwebp, is freed exactly once, and is not used
    // afterwards.
    unsafe { WebPFree(output.cast()) };
    encoded
}
