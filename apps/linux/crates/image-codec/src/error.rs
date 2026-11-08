use std::fmt;

use image::ImageError;
use image::error::LimitErrorKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    Unsupported,
    TooLarge,
    Invalid,
    Encode,
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unsupported => "unsupported image format",
            Self::TooLarge => "image is too large",
            Self::Invalid => "invalid image",
            Self::Encode => "image encoding failed",
        })
    }
}

impl std::error::Error for CodecError {}

impl From<ImageError> for CodecError {
    fn from(error: ImageError) -> Self {
        match error {
            ImageError::Unsupported(_) => Self::Unsupported,
            ImageError::Limits(limit) => match limit.kind() {
                LimitErrorKind::DimensionError | LimitErrorKind::InsufficientMemory => {
                    Self::TooLarge
                }
                _ => Self::Unsupported,
            },
            ImageError::Decoding(_)
            | ImageError::Parameter(_)
            | ImageError::IoError(_)
            | ImageError::Encoding(_) => Self::Invalid,
        }
    }
}
