use std::io::Cursor;
use std::path::Path;

use ::image::{DynamicImage, GenericImageView, ImageFormat, RgbaImage};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use fast_image_resize as fir;
use fast_image_resize::images::Image;

use crate::image::{self, DecodeImageError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbnailData {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

pub fn generate_thumbnail(
    path: &Path,
    logical_size: u32,
) -> Result<ThumbnailData, DecodeImageError> {
    if logical_size == 0 {
        return Err(DecodeImageError {
            code: "decode_failed",
            message: "thumbnail size must be greater than zero".to_string(),
        });
    }

    let loaded = image::load_supported_image_path(path)?;
    let (width, height) = target_dimensions(&loaded.image, logical_size);
    let resized = resize_image(&loaded.image, width, height)?;
    let png_bytes = encode_png(&resized)?;

    Ok(ThumbnailData {
        data_url: format!("data:image/png;base64,{}", STANDARD.encode(png_bytes)),
        width,
        height,
    })
}

fn target_dimensions(image: &DynamicImage, logical_size: u32) -> (u32, u32) {
    let max_edge = logical_size.saturating_mul(2);
    let (source_width, source_height) = image.dimensions();

    if source_width == 0 || source_height == 0 {
        return (max_edge.max(1), max_edge.max(1));
    }

    if source_width >= source_height {
        let height =
            ((u64::from(source_height) * u64::from(max_edge)) / u64::from(source_width)).max(1);
        (max_edge, u32::try_from(height).unwrap_or(1))
    } else {
        let width =
            ((u64::from(source_width) * u64::from(max_edge)) / u64::from(source_height)).max(1);
        (u32::try_from(width).unwrap_or(1), max_edge)
    }
}

fn resize_image(
    image: &DynamicImage,
    width: u32,
    height: u32,
) -> Result<RgbaImage, DecodeImageError> {
    let source = image.to_rgba8();
    let source_image = Image::from_vec_u8(
        source.width(),
        source.height(),
        source.into_raw(),
        fir::PixelType::U8x4,
    )
    .map_err(|err| DecodeImageError {
        code: "decode_failed",
        message: format!("failed to prepare thumbnail source buffer: {err}"),
    })?;

    let mut destination_image = Image::new(width, height, fir::PixelType::U8x4);
    let mut resizer = fir::Resizer::new();

    resizer
        .resize(
            &source_image,
            &mut destination_image,
            &fir::ResizeOptions::new()
                .resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Lanczos3)),
        )
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("failed to resize thumbnail: {err}"),
        })?;

    RgbaImage::from_vec(width, height, destination_image.into_vec()).ok_or_else(|| {
        DecodeImageError {
            code: "decode_failed",
            message: "resizer returned an invalid RGBA thumbnail buffer".to_string(),
        }
    })
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, DecodeImageError> {
    let mut cursor = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|err| DecodeImageError {
            code: "encode_failed",
            message: format!("failed to encode thumbnail PNG: {err}"),
        })?;

    Ok(cursor.into_inner())
}
