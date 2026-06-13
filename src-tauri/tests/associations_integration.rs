use imageareo_lib::associations::{
    self, __test_support as association_private, progid_for, registry_key_paths, uti_for,
    validate_extensions, windows_default_apps_uri_for_registered_user_app, ASSOCIABLE_EXTENSIONS,
};
use imageareo_lib::commands::associations_runtime::{
    query_file_associations as query_file_associations_command, set_default_associations,
};

#[test]
fn association_private_error_helpers_keep_expected_codes() {
    let invalid = association_private::invalid_extension_error("bad extension");
    assert_eq!(invalid.code, "invalid_extension");
    assert_eq!(invalid.message, "bad extension");

    let query = association_private::query_error("query failed");
    assert_eq!(query.code, "association_query_failed");
    assert_eq!(query.message, "query failed");

    let register = association_private::register_error("register failed");
    assert_eq!(register.code, "association_register_failed");
    assert_eq!(register.message, "register failed");

    let unsupported = association_private::unsupported_error("no platform");
    assert_eq!(unsupported.code, "unsupported_platform");
    assert_eq!(unsupported.message, "no platform");
}

#[test]
fn associable_extensions_stay_in_sync_with_supported_image_extensions() {
    let supported = associations::supported_extension_union();
    let expected = ASSOCIABLE_EXTENSIONS
        .iter()
        .map(|ext| (*ext).to_string())
        .collect::<Vec<_>>();

    assert_eq!(supported, expected);
}

#[test]
fn validate_extensions_normalizes_deduplicates_and_rejects_unknown_values() {
    let validated = validate_extensions([".PNG", "jpg", "png", "  webp  "])
        .expect("supported extensions should validate");
    assert_eq!(validated, vec!["png", "jpg", "webp"]);

    let invalid = validate_extensions(["txt"]).expect_err("unknown extensions should fail");
    assert_eq!(invalid.code, "invalid_extension");
    assert!(invalid.message.contains("txt"));

    let empty = validate_extensions([""]).expect_err("empty extension should fail");
    assert_eq!(empty.code, "invalid_extension");
    assert!(empty.message.contains("must not be empty"));
}

#[test]
fn windows_registry_helpers_build_expected_values() {
    assert_eq!(progid_for("png"), "ImageAreo.AssocFile.PNG");
    assert_eq!(progid_for(".webp"), "ImageAreo.AssocFile.WEBP");

    let paths = registry_key_paths("png");
    assert_eq!(paths.extension_key, r"Software\Classes\.png");
    assert_eq!(
        paths.open_with_progids_key,
        r"Software\Classes\.png\OpenWithProgids"
    );
    assert_eq!(
        paths.user_choice_key,
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.png\UserChoice"
    );
    assert_eq!(paths.progid, "ImageAreo.AssocFile.PNG");
    assert_eq!(
        paths.progid_command_key,
        r"Software\Classes\ImageAreo.AssocFile.PNG\shell\open\command"
    );
}

#[test]
fn windows_default_apps_uri_targets_the_registered_user_app() {
    assert_eq!(
        windows_default_apps_uri_for_registered_user_app("ImageAreo"),
        "ms-settings:defaultapps?registeredAppUser=ImageAreo"
    );
    assert_eq!(
        windows_default_apps_uri_for_registered_user_app("Image Areo+Viewer"),
        "ms-settings:defaultapps?registeredAppUser=Image%20Areo%2BViewer"
    );
}

#[test]
fn macos_uti_mapping_covers_common_and_raw_formats() {
    assert_eq!(uti_for("png"), Some("public.png"));
    assert_eq!(uti_for("jpeg"), Some("public.jpeg"));
    assert_eq!(uti_for("heic"), Some("public.heic"));
    assert_eq!(uti_for("cr3"), Some("com.adobe.raw-image"));
    assert_eq!(uti_for("txt"), None);
}

#[tokio::test]
async fn set_default_associations_rejects_unknown_extensions_before_any_os_side_effect() {
    let error = set_default_associations(vec!["txt".to_string()])
        .await
        .expect_err("unknown extension should fail validation before any OS call");

    assert_eq!(error.code, "invalid_extension");
    assert!(error.message.contains("txt"));
}

#[tokio::test]
async fn query_file_associations_command_returns_the_supported_extension_list() {
    let associations = query_file_associations_command()
        .await
        .expect("association query should succeed");

    assert_eq!(associations.len(), ASSOCIABLE_EXTENSIONS.len());
    assert_eq!(
        associations.first().map(|entry| entry.ext.as_str()),
        Some("jpg")
    );
    assert!(associations.iter().any(|entry| entry.ext == "png"));
    assert!(associations.iter().any(|entry| entry.ext == "jxl"));
}

#[tokio::test]
async fn public_command_reexports_cover_association_runtime_wrappers() {
    let query_result = imageareo_lib::commands::query_file_associations()
        .await
        .expect("public query re-export should succeed");
    assert_eq!(query_result.len(), ASSOCIABLE_EXTENSIONS.len());
    assert!(query_result.iter().any(|entry| entry.ext == "heic"));

    let error = imageareo_lib::commands::set_default_associations(vec!["txt".to_string()])
        .await
        .expect_err("invalid extension should still fail through the public re-export");
    assert_eq!(error.code, "invalid_extension");
}
