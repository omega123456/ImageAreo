use imageareo_lib::commands::print::{
    __test_support::{mm_to_points, print_error, PrintOrientation},
    PrintCommandError,
};

#[test]
fn print_error_carries_the_print_failed_code_and_message() {
    let error = print_error("native print panel unavailable");

    assert_eq!(error.code, "print_failed");
    assert_eq!(error.message, "native print panel unavailable");
}

#[test]
fn print_command_error_serializes_camel_case() {
    let error = PrintCommandError {
        code: "print_failed",
        message: "boom".to_string(),
    };

    let json = serde_json::to_value(&error).expect("error should serialize");
    assert_eq!(json["code"], "print_failed");
    assert_eq!(json["message"], "boom");
}

#[test]
fn mm_to_points_converts_using_72_over_25_4() {
    // 25.4 mm (1 inch) is exactly 72 points.
    assert!((mm_to_points(25.4) - 72.0).abs() < 1e-9);
    // 0 mm maps to 0 points.
    assert_eq!(mm_to_points(0.0), 0.0);
    // US Letter width 215.9 mm → 612 points.
    assert!((mm_to_points(215.9) - 612.0).abs() < 1e-6);
    // US Letter height 279.4 mm → 792 points.
    assert!((mm_to_points(279.4) - 792.0).abs() < 1e-6);
}

#[test]
fn print_orientation_maps_known_values_and_defaults_to_portrait() {
    assert_eq!(PrintOrientation::from_str("portrait"), PrintOrientation::Portrait);
    assert_eq!(PrintOrientation::from_str("landscape"), PrintOrientation::Landscape);
    // Unknown / empty values fall back to portrait (the store default).
    assert_eq!(PrintOrientation::from_str("diagonal"), PrintOrientation::Portrait);
    assert_eq!(PrintOrientation::from_str(""), PrintOrientation::Portrait);
}
