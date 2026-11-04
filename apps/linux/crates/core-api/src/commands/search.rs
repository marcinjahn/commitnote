use serde::{Deserialize, Serialize};

use crate::shapes::ColorTag;

empty_shape!(
    SearchOpenParams,
    SearchOpenResult,
    SearchCloseParams,
    SearchCloseResult,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnippetPart {
    pub text: String,
    #[serde(rename = "match")]
    pub is_match: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRow {
    pub path: Vec<String>,
    pub name: String,
    pub folder: Option<String>,
    pub name_ranges: Vec<(u32, u32)>,
    pub snippet: Option<Vec<SnippetPart>>,
    pub color_tag: Option<ColorTag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCopy {
    pub recent_heading: String,
    pub names_heading: String,
    pub contents_heading: String,
    pub no_matches: String,
    pub still_reading: String,
    pub hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub recent: Vec<SearchRow>,
    pub names: Vec<SearchRow>,
    pub contents: Vec<SearchRow>,
    pub count_text: Option<String>,
    pub names_more: Option<String>,
    pub contents_more: Option<String>,
    pub copy: SearchCopy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryParams {
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryResult {
    pub results: SearchResults,
}

command!(
    SearchOpen,
    "search.open",
    SearchOpenParams,
    SearchOpenResult
);
command!(
    SearchClose,
    "search.close",
    SearchCloseParams,
    SearchCloseResult
);
command!(
    SearchQuery,
    "search.query",
    SearchQueryParams,
    SearchQueryResult
);
