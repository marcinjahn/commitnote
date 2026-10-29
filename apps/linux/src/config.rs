pub const APP_ID: &str = env!("COMMITNOTE_APP_ID");
pub const PROFILE: &str = env!("COMMITNOTE_PROFILE");
pub const VERSION: &str = env!("COMMITNOTE_VERSION");
pub const RESOURCE_PREFIX: &str = "/io/github/marcinjahn/commitnote/";

pub fn is_development() -> bool {
    PROFILE == "development"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_profile_uses_the_devel_app_id() {
        assert_eq!(APP_ID.ends_with(".Devel"), PROFILE == "development");
        assert!(APP_ID.starts_with("io.github.marcinjahn.commitnote"));
    }

    #[test]
    fn resource_prefix_matches_the_gresource_manifest() {
        let manifest = include_str!("../data/resources.gresource.xml");
        let prefix = format!(
            "<gresource prefix=\"{}\">",
            RESOURCE_PREFIX.trim_end_matches('/')
        );
        assert!(manifest.contains(&prefix));
    }
}
