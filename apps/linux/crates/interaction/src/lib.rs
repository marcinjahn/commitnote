#![forbid(unsafe_code)]

mod type_to_start;

pub use type_to_start::{
    KeyModifiers, TypeToStartBuffer, TypeToStartContext, TypeToStartInput, should_start,
};
