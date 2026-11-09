use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRenderParams {
    pub name: String,
    pub text: String,
}

impl fmt::Debug for PrintRenderParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PrintRenderParams").finish_non_exhaustive()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRenderResult {
    pub html: String,
}

impl fmt::Debug for PrintRenderResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PrintRenderResult")
            .field("html_len", &self.html.len())
            .finish_non_exhaustive()
    }
}

command!(
    PrintRender,
    "print.render",
    PrintRenderParams,
    PrintRenderResult
);

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn params_and_result_use_the_wire_field_names() {
        let params = PrintRenderParams {
            name: "Welcome".into(),
            text: "# Welcome".into(),
        };
        let encoded = serde_json::to_value(&params).unwrap();
        assert_eq!(encoded, json!({"name":"Welcome","text":"# Welcome"}));
        assert_eq!(
            serde_json::from_value::<PrintRenderParams>(encoded).unwrap(),
            params
        );
        let result: PrintRenderResult = serde_json::from_value(json!({"html":"<p>a</p>"})).unwrap();
        assert_eq!(result.html, "<p>a</p>");
    }

    #[test]
    fn debug_output_leaves_out_the_note_text() {
        let params = PrintRenderParams {
            name: "Private name".into(),
            text: "secret note text".into(),
        };
        let result = PrintRenderResult {
            html: "<p>secret note text</p>".into(),
        };
        let debug = format!("{params:?} {result:?}");
        assert!(!debug.contains("secret"), "{debug}");
        assert!(!debug.contains("Private"), "{debug}");
    }
}
