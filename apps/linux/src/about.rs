use adw::prelude::*;
use gtk4::{self as gtk, gio, glib};
use libadwaita as adw;

use crate::config;

const APPLICATION_NAME: &str = "commitnote";
const DEVELOPER: &str = "Marcin Jahn";
const WEBSITE: &str = "https://github.com/marcinjahn/commitnote";
const COPYRIGHT: &str = "© 2026 Marcin Jahn";
const LICENSE: &str = "All rights reserved.";
const DEBUG_INFO_FILENAME: &str = "commitnote-debug-info.txt";

const FONT_LICENSES: &[(&str, &str)] = &[
    (
        "Atkinson Hyperlegible Next",
        "AtkinsonHyperlegibleNext-OFL.txt",
    ),
    ("IBM Plex Mono", "IBMPlexMono-OFL.txt"),
    ("IBM Plex Sans", "IBMPlexSans-OFL.txt"),
    ("Inter", "Inter-OFL.txt"),
    ("JetBrains Mono", "JetBrainsMono-OFL.txt"),
    ("Literata", "Literata-OFL.txt"),
    ("Lora", "Lora-OFL.txt"),
    ("Nunito", "Nunito-OFL.txt"),
    ("Source Serif 4", "SourceSerif4-OFL.txt"),
    ("iA Writer Quattro", "iAWriterQuattro-LICENSE.md"),
];

pub fn present(parent: &impl IsA<gtk::Widget>) {
    let dialog = adw::AboutDialog::builder()
        .application_name(APPLICATION_NAME)
        .application_icon(config::APP_ID)
        .version(config::VERSION)
        .developer_name(DEVELOPER)
        .developers([DEVELOPER])
        .website(WEBSITE)
        .copyright(COPYRIGHT)
        .license_type(gtk::License::Custom)
        .license(LICENSE)
        .debug_info(debug_info())
        .debug_info_filename(DEBUG_INFO_FILENAME)
        .build();
    for (family, file) in FONT_LICENSES {
        let (copyright, license) = legal_section_markup(file);
        dialog.add_legal_section(
            family,
            Some(&copyright),
            gtk::License::Custom,
            Some(&license),
        );
    }
    dialog.present(Some(parent));
}

fn debug_info() -> String {
    format!(
        "commitnote {} ({})\nGTK {}.{}.{}\nlibadwaita {}.{}.{}\nWebKitGTK {}.{}.{}",
        config::VERSION,
        config::PROFILE,
        gtk::major_version(),
        gtk::minor_version(),
        gtk::micro_version(),
        adw::major_version(),
        adw::minor_version(),
        adw::micro_version(),
        webkit6::functions::major_version(),
        webkit6::functions::minor_version(),
        webkit6::functions::micro_version(),
    )
}

fn license_text(file: &str) -> String {
    let path = format!("{}licenses/{file}", config::RESOURCE_PREFIX);
    let bytes = gio::resources_lookup_data(&path, gio::ResourceLookupFlags::NONE)
        .unwrap_or_else(|_| panic!("the {file} licence resource is bundled"));
    String::from_utf8(bytes.to_vec())
        .unwrap_or_else(|_| panic!("the {file} licence resource is UTF-8"))
}

fn copyright_line<'a>(text: &'a str, file: &str) -> &'a str {
    text.lines()
        .map(str::trim)
        .find(|line| line.starts_with("Copyright"))
        .unwrap_or_else(|| panic!("the {file} licence has a copyright line"))
}

fn legal_section_markup(file: &str) -> (String, String) {
    let text = license_text(file);
    let copyright = glib::markup_escape_text(copyright_line(&text, file));
    let license = glib::markup_escape_text(&text);
    (copyright.into(), license.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_font_family_has_a_licence_with_a_copyright_line() {
        crate::register_resources();
        for (family, file) in FONT_LICENSES {
            let text = license_text(file);
            let copyright = copyright_line(&text, file);
            assert!(
                copyright.starts_with("Copyright") && copyright.len() > "Copyright".len(),
                "{family} has no usable copyright line"
            );
            assert!(text.len() > copyright.len(), "{family} has no licence text");
        }
    }

    #[test]
    fn legal_section_markup_parses_to_the_raw_licence_text() {
        crate::register_resources();
        for (family, file) in FONT_LICENSES {
            let text = license_text(file);
            let (copyright, license) = legal_section_markup(file);
            let joined = format!("{copyright}\n\n{license}");
            let (_, plain, _) = gtk::pango::parse_markup(&joined, '\0')
                .unwrap_or_else(|_| panic!("{family} legal section is valid markup"));
            let expected = format!("{}\n\n{text}", copyright_line(&text, file));
            assert_eq!(
                plain.as_str(),
                expected.replace("\r\n", "\n"),
                "{family} legal section text differs from the licence file"
            );
        }
    }

    #[test]
    fn font_families_are_unique_and_in_order() {
        let titles: Vec<&str> = FONT_LICENSES.iter().map(|(family, _)| *family).collect();
        assert_eq!(
            titles,
            [
                "Atkinson Hyperlegible Next",
                "IBM Plex Mono",
                "IBM Plex Sans",
                "Inter",
                "JetBrains Mono",
                "Literata",
                "Lora",
                "Nunito",
                "Source Serif 4",
                "iA Writer Quattro",
            ]
        );
    }
}
