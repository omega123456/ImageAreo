use imageareo_lib::commands::print::{__test_support::print_error, PrintCommandError};

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
