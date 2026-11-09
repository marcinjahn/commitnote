/// A paint alpha with a stronger value for the system's high-contrast setting.
#[derive(Debug, Clone, Copy)]
pub struct Contrast {
    normal: f32,
    high: f32,
}

impl Contrast {
    pub const fn new(normal: f32, high: f32) -> Self {
        Self { normal, high }
    }

    pub const fn pick(self, high_contrast: bool) -> f32 {
        if high_contrast {
            self.high
        } else {
            self.normal
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_value_for_the_setting() {
        let alpha = Contrast::new(0.5, 0.9);

        assert_eq!(alpha.pick(false), 0.5);
        assert_eq!(alpha.pick(true), 0.9);
    }
}
