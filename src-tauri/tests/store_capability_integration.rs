use std::path::PathBuf;

use serde_json::Value;

#[test]
fn default_capability_grants_store_plugin_default_permission() {
    let capability_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("capabilities")
        .join("default.json");

    let capability: Value = serde_json::from_slice(
        &std::fs::read(&capability_path).expect("default capability should be readable"),
    )
    .expect("default capability should be valid JSON");

    let permissions = capability["permissions"]
        .as_array()
        .expect("default capability permissions should be an array");

    assert!(
        permissions
            .iter()
            .any(|permission| permission.as_str() == Some("store:default")),
        "default capability must grant store:default so settings persistence can use the store plugin at startup"
    );
}
