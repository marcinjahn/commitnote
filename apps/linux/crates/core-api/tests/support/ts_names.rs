#![allow(dead_code)]

pub fn api_source() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../src/native-core/api.ts"
    );
    std::fs::read_to_string(path).expect("src/native-core/api.ts is readable")
}

pub fn names_in(source: &str, array: &str) -> Vec<String> {
    let marker = format!("const {array} = [");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("{array} is declared in api.ts"))
        + marker.len();
    let body = &source[start..];
    let end = body.find(']').expect("array is closed");
    quoted(&body[..end])
}

fn quoted(body: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut parts = body.split('"');
    parts.next();
    while let Some(name) = parts.next() {
        names.push(name.to_owned());
        parts.next();
    }
    names
}

pub fn api_version(source: &str) -> u32 {
    let marker = "NATIVE_CORE_API_VERSION = ";
    let start = source.find(marker).expect("version is declared") + marker.len();
    let digits: String = source[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    assert!(source[start + digits.len()..].starts_with(';'));
    digits.parse().expect("version is a number")
}

pub fn marker(source: &str) -> String {
    let declaration = "NATIVE_CORE_MARKER = \"";
    let start = source.find(declaration).expect("marker is declared") + declaration.len();
    let end = source[start..].find('"').expect("marker is closed");
    source[start..start + end].to_owned()
}
