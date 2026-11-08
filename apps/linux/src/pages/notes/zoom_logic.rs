pub const MIN_ZOOM: f64 = 1.0;
pub const MAX_ZOOM: f64 = 8.0;
pub const ZOOM_STEP: f64 = 1.25;
const EPSILON: f64 = 1e-9;

pub fn clamp_zoom(zoom: f64) -> f64 {
    if zoom.is_nan() {
        MIN_ZOOM
    } else {
        zoom.clamp(MIN_ZOOM, MAX_ZOOM)
    }
}

/// The zoom `steps` steps away; fractional steps follow smooth scrolling and pinching.
pub fn zoom_by(zoom: f64, steps: f64) -> f64 {
    clamp_zoom(zoom * ZOOM_STEP.powf(steps))
}

pub fn can_zoom_in(zoom: f64) -> bool {
    zoom < MAX_ZOOM - EPSILON
}

pub fn can_zoom_out(zoom: f64) -> bool {
    zoom > MIN_ZOOM + EPSILON
}

/// The largest size with the image's ratio that fits the viewport without exceeding the image's
/// natural size (its pixels over the display scale factor); (0, 0) while either is empty.
pub fn fit_size(image: (f64, f64), viewport: (f64, f64), scale_factor: f64) -> (f64, f64) {
    if image.0 <= 0.0 || image.1 <= 0.0 || viewport.0 <= 0.0 || viewport.1 <= 0.0 {
        return (0.0, 0.0);
    }
    let scale_factor = if scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let natural = (image.0 / scale_factor, image.1 / scale_factor);
    let scale = (viewport.0 / natural.0)
        .min(viewport.1 / natural.1)
        .min(1.0);
    (natural.0 * scale, natural.1 * scale)
}

pub fn content_size(fit: (f64, f64), zoom: f64) -> (f64, f64) {
    (fit.0 * zoom, fit.1 * zoom)
}

fn origin(content: f64, viewport: f64) -> f64 {
    ((viewport - content) / 2.0).max(0.0)
}

/// The scroll offset along one axis that keeps the content point under `anchor` (a position in
/// the viewport) still when the content changes size. Content smaller than the viewport is
/// centred in it.
pub fn anchored_offset(
    offset: f64,
    anchor: f64,
    old_content: f64,
    new_content: f64,
    viewport: f64,
) -> f64 {
    if old_content <= 0.0 {
        return 0.0;
    }
    let point = (anchor + offset - origin(old_content, viewport)).clamp(0.0, old_content);
    let wanted = origin(new_content, viewport) + point / old_content * new_content - anchor;
    wanted.clamp(0.0, (new_content - viewport).max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_stays_between_fit_and_eight_times() {
        assert_eq!(clamp_zoom(0.2), MIN_ZOOM);
        assert_eq!(clamp_zoom(100.0), MAX_ZOOM);
        assert_eq!(clamp_zoom(f64::NAN), MIN_ZOOM);
        assert_eq!(clamp_zoom(3.0), 3.0);
    }

    #[test]
    fn a_step_scales_by_a_quarter_and_stops_at_the_limits() {
        assert_eq!(zoom_by(1.0, 1.0), 1.25);
        assert_eq!(zoom_by(2.0, -1.0), 1.6);
        assert_eq!(zoom_by(1.0, -1.0), MIN_ZOOM);
        let mut zoom = MIN_ZOOM;
        for _ in 0..20 {
            zoom = zoom_by(zoom, 1.0);
        }
        assert_eq!(zoom, MAX_ZOOM);
        assert!(zoom_by(1.0, 0.5) > 1.0 && zoom_by(1.0, 0.5) < 1.25);
    }

    #[test]
    fn the_limits_disable_their_direction() {
        assert!(can_zoom_in(MIN_ZOOM) && !can_zoom_out(MIN_ZOOM));
        assert!(can_zoom_in(2.0) && can_zoom_out(2.0));
        assert!(!can_zoom_in(MAX_ZOOM) && can_zoom_out(MAX_ZOOM));
    }

    #[test]
    fn a_small_image_keeps_its_natural_size() {
        assert_eq!(fit_size((64.0, 48.0), (900.0, 700.0), 1.0), (64.0, 48.0));
        assert_eq!(fit_size((64.0, 48.0), (900.0, 700.0), 2.0), (32.0, 24.0));
    }

    #[test]
    fn a_large_image_fits_the_viewport_by_its_tighter_side() {
        assert_eq!(
            fit_size((4000.0, 2000.0), (800.0, 800.0), 1.0),
            (800.0, 400.0)
        );
        assert_eq!(
            fit_size((2000.0, 4000.0), (800.0, 800.0), 1.0),
            (400.0, 800.0)
        );
        assert_eq!(fit_size((400.0, 200.0), (100.0, 100.0), 1.0), (100.0, 50.0));
        assert_eq!(
            fit_size((4000.0, 2000.0), (800.0, 800.0), 2.0),
            (800.0, 400.0)
        );
    }

    #[test]
    fn an_image_larger_on_one_side_only_is_limited_by_that_side() {
        assert_eq!(
            fit_size((1000.0, 100.0), (500.0, 500.0), 1.0),
            (500.0, 50.0)
        );
        assert_eq!(
            fit_size((100.0, 1000.0), (500.0, 500.0), 1.0),
            (50.0, 500.0)
        );
    }

    #[test]
    fn an_empty_image_or_viewport_has_no_fit() {
        assert_eq!(fit_size((400.0, 200.0), (0.0, 100.0), 1.0), (0.0, 0.0));
        assert_eq!(fit_size((400.0, 200.0), (100.0, 0.0), 1.0), (0.0, 0.0));
        assert_eq!(fit_size((0.0, 200.0), (100.0, 100.0), 1.0), (0.0, 0.0));
        assert_eq!(fit_size((400.0, 0.0), (100.0, 100.0), 1.0), (0.0, 0.0));
    }

    #[test]
    fn a_non_positive_scale_factor_counts_as_one() {
        assert_eq!(fit_size((64.0, 48.0), (900.0, 700.0), 0.0), (64.0, 48.0));
        assert_eq!(fit_size((64.0, 48.0), (900.0, 700.0), -2.0), (64.0, 48.0));
    }

    #[test]
    fn content_scales_the_fit_size() {
        assert_eq!(content_size((100.0, 50.0), 4.0), (400.0, 200.0));
    }

    #[test]
    fn zooming_keeps_the_anchored_point_still() {
        let (viewport, old, new) = (400.0, 800.0, 1000.0);
        let (offset, anchor) = (100.0, 150.0);
        let before = (anchor + offset) / old;
        let moved = anchored_offset(offset, anchor, old, new, viewport);
        assert_eq!((anchor + moved) / new, before);
    }

    #[test]
    fn zooming_at_the_centre_keeps_the_middle_in_the_middle() {
        let moved = anchored_offset(0.0, 200.0, 400.0, 500.0, 400.0);
        assert_eq!(moved, 50.0);
        assert_eq!(anchored_offset(50.0, 200.0, 500.0, 400.0, 400.0), 0.0);
    }

    #[test]
    fn offsets_stay_inside_the_content() {
        assert_eq!(anchored_offset(0.0, 0.0, 400.0, 3200.0, 400.0), 0.0);
        assert_eq!(
            anchored_offset(2800.0, 400.0, 3200.0, 4000.0, 400.0),
            3600.0
        );
        assert_eq!(anchored_offset(300.0, 100.0, 800.0, 400.0, 400.0), 0.0);
    }

    #[test]
    fn content_smaller_than_the_viewport_is_centred_while_zooming_from_it() {
        assert_eq!(anchored_offset(0.0, 300.0, 200.0, 800.0, 600.0), 100.0);
        assert_eq!(anchored_offset(0.0, 100.0, 200.0, 800.0, 600.0), 0.0);
    }

    #[test]
    fn an_empty_content_gives_no_offset() {
        assert_eq!(anchored_offset(10.0, 10.0, 0.0, 100.0, 50.0), 0.0);
    }
}
