mod common;

use std::fs;
use std::path::Path;

use commitnote_core_api::fake::{FakeCheckVectors, FakeCheckVectorsParams};
use commitnote_core_runtime::HostServices;
use serde_json::{Map, Value};

use common::{block_on, start_fake};

const VECTORS_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../test-vectors");
const IMAGE_PIPELINE_PREFIX: &str = "image-pipeline.json:";

fn expected_checks(fields: &Map<String, Value>) -> usize {
    1 + fields
        .values()
        .filter_map(Value::as_array)
        .map(Vec::len)
        .sum::<usize>()
}

fn load_vectors(directory: &Path) -> (Map<String, Value>, usize) {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("the vectors directory exists")
        .map(|entry| {
            entry
                .expect("a readable directory entry")
                .file_name()
                .into_string()
                .expect("vector file names are UTF-8")
        })
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no vector files found");

    let mut files = Map::new();
    let mut expected = 0;
    for name in names {
        let text = fs::read_to_string(directory.join(&name)).expect("a readable vector file");
        let value: Value = serde_json::from_str(&text).expect("a valid vector file");
        let fields = value
            .as_object()
            .unwrap_or_else(|| panic!("{name} is not an object"));
        expected += expected_checks(fields);
        files.insert(name, value);
    }
    (files, expected)
}

#[test]
fn every_vector_passes_through_the_host_crypto_except_image_processing() {
    let (files, expected) = load_vectors(Path::new(VECTORS_DIR));
    let runtime = start_fake(HostServices::default());

    let result = block_on(runtime.request::<FakeCheckVectors>(FakeCheckVectorsParams { files }))
        .expect("fake.checkVectors");

    let unexpected: Vec<&String> = result
        .failures
        .iter()
        .filter(|failure| !failure.starts_with(IMAGE_PIPELINE_PREFIX))
        .collect();
    assert!(
        unexpected.is_empty(),
        "vectors failed outside the image pipeline: {unexpected:?}"
    );
    assert_eq!(result.checked as usize, expected);
}
