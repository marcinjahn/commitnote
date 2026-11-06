use gtk4::glib;

pub const CONTENT_SECURITY_POLICY: &str =
    "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";
const FONT_FAMILY: &str = "commitnote-note";
const HEAD: &str = "<head>";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceStyle {
    Normal,
    Italic,
}

impl FaceStyle {
    fn css(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Italic => "italic",
        }
    }
}

/// One face of the note font, read from its TrueType file.
pub struct FontFace {
    pub style: FaceStyle,
    pub bytes: Vec<u8>,
}

/// The core's HTML with a policy that keeps it from loading anything but inline data, and with
/// the note font's faces embedded under the family the core's stylesheet names.
pub fn printable_document(html: &str, faces: &[FontFace]) -> String {
    let mut head = format!(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"{CONTENT_SECURITY_POLICY}\">"
    );
    for face in faces {
        head.push_str("<style>");
        head.push_str(&face_css(face));
        head.push_str("</style>");
    }
    inject_head(&head, html)
}

fn inject_head(extra: &str, html: &str) -> String {
    match html.find(HEAD) {
        Some(start) => {
            let (before, after) = html.split_at(start + HEAD.len());
            format!("{before}{extra}{after}")
        }
        None => format!("{extra}{html}"),
    }
}

fn face_css(face: &FontFace) -> String {
    format!(
        "@font-face{{font-family:\"{FONT_FAMILY}\";src:url(data:font/ttf;base64,{}) \
         format(\"truetype\");font-style:{};font-weight:100 900}}",
        glib::base64_encode(&face.bytes),
        face.style.css()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLICY_TAG: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src \
                              'none'; img-src data:; font-src data:; style-src 'unsafe-inline'\">";

    fn face(style: FaceStyle, bytes: &[u8]) -> FontFace {
        FontFace {
            style,
            bytes: bytes.to_vec(),
        }
    }

    #[test]
    fn the_policy_allows_only_inline_data() {
        assert_eq!(
            CONTENT_SECURITY_POLICY,
            "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"
        );
    }

    #[test]
    fn the_policy_and_faces_go_right_after_the_head_tag() {
        let html = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>";

        let document = printable_document(html, &[face(FaceStyle::Normal, b"ttf")]);

        assert_eq!(
            document,
            format!(
                "<!doctype html><html><head>{POLICY_TAG}<style>@font-face{{font-family:\
                 \"commitnote-note\";src:url(data:font/ttf;base64,dHRm) format(\"truetype\");\
                 font-style:normal;font-weight:100 900}}</style><meta charset=\"utf-8\"></head>\
                 <body></body></html>"
            )
        );
    }

    #[test]
    fn a_document_without_a_head_starts_with_the_policy() {
        let document = printable_document("<p>Plain</p>", &[]);

        assert_eq!(document, format!("{POLICY_TAG}<p>Plain</p>"));
    }

    #[test]
    fn only_the_first_head_tag_takes_the_policy() {
        let document = printable_document("<head></head><pre><head></pre>", &[]);

        assert_eq!(
            document,
            format!("<head>{POLICY_TAG}</head><pre><head></pre>")
        );
    }

    #[test]
    fn each_face_has_its_own_style_block_with_its_style() {
        let document = printable_document(
            "<head></head>",
            &[
                face(FaceStyle::Normal, &[0, 1, 2]),
                face(FaceStyle::Italic, &[255]),
            ],
        );

        let styles: Vec<&str> = document
            .split("<style>")
            .skip(1)
            .map(|block| block.split("</style>").next().unwrap_or_default())
            .collect();
        assert_eq!(
            styles,
            [
                "@font-face{font-family:\"commitnote-note\";src:url(data:font/ttf;base64,AAEC) \
                 format(\"truetype\");font-style:normal;font-weight:100 900}",
                "@font-face{font-family:\"commitnote-note\";src:url(data:font/ttf;base64,/w==) \
                 format(\"truetype\");font-style:italic;font-weight:100 900}",
            ]
        );
    }

    #[test]
    fn no_faces_means_no_font_face_rule() {
        let document = printable_document("<head></head><body>Text</body>", &[]);

        assert!(!document.contains("@font-face"), "{document}");
        assert!(document.contains(POLICY_TAG));
    }
}
