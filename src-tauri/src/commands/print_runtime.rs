use super::print::PrintCommandError;

/// Trigger the OS-native print dialog for the main webview.
///
/// The webview renders the print-only DOM layer under `@media print` (see
/// `PrintLayout.svelte`), so the panel prints just the image fit to the page.
/// The actual print panel is an OS side effect that cannot be asserted
/// headlessly, so this whole module is on the coverage-exclusion list (same
/// policy as the clipboard/reveal/fullscreen OS steps). The pure error mapping
/// lives in `print.rs` and stays covered.
#[tauri::command(rename_all = "camelCase")]
pub async fn print_current_view(
    webview_window: tauri::WebviewWindow,
) -> Result<(), PrintCommandError> {
    run_native_print(&webview_window)
}

/// macOS: drive the `WKWebView` → AppKit `printOperationWithPrintInfo:` print
/// panel. Runs inside `with_webview`, which executes on the main thread (a hard
/// requirement for AppKit calls). The panel is presented as a window-modal sheet
/// so the call returns immediately.
#[cfg(target_os = "macos")]
fn run_native_print(
    webview_window: &tauri::WebviewWindow,
) -> Result<(), PrintCommandError> {
    use objc2_app_kit::{NSPrintInfo, NSWindow};
    use objc2_web_kit::WKWebView;

    webview_window
        .with_webview(|platform| {
            let webview_ptr = platform.inner() as *mut WKWebView;
            if webview_ptr.is_null() {
                return;
            }
            let ns_window_ptr = platform.ns_window() as *mut NSWindow;

            // SAFETY: pointers are the live WKWebView / NSWindow owned by the
            // window, valid for the duration of this main-thread closure.
            unsafe {
                let webview = &*webview_ptr;
                let print_info = NSPrintInfo::sharedPrintInfo();
                let operation = webview.printOperationWithPrintInfo(&print_info);
                operation.setShowsPrintPanel(true);
                operation.setShowsProgressPanel(true);

                if let Some(window) = ns_window_ptr.as_ref() {
                    operation
                        .runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                            window, None, None, std::ptr::null_mut(),
                        );
                } else {
                    operation.runOperation();
                }
            }
        })
        .map_err(|err| {
            PrintCommandError::print(format!("failed to access webview for printing: {err}"))
        })
}

/// Windows: drive the WebView2 controller → `ICoreWebView2_16::ShowPrintUI`
/// browser print dialog.
#[cfg(target_os = "windows")]
fn run_native_print(
    webview_window: &tauri::WebviewWindow,
) -> Result<(), PrintCommandError> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
    };
    use windows::core::Interface;

    webview_window
        .with_webview(|platform| {
            let controller = platform.controller();
            // SAFETY: the controller is the live WebView2 controller owned by the
            // window; the COM calls below run on the webview's UI thread.
            unsafe {
                if let Ok(core) = controller.CoreWebView2() {
                    if let Ok(core16) = core.cast::<ICoreWebView2_16>() {
                        let _ = core16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER);
                    }
                }
            }
        })
        .map_err(|err| {
            PrintCommandError::print(format!("failed to access webview for printing: {err}"))
        })
}

/// Other platforms (not a shipping target) have no native print path.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn run_native_print(
    _webview_window: &tauri::WebviewWindow,
) -> Result<(), PrintCommandError> {
    Err(PrintCommandError::print(
        "native printing is not supported on this platform",
    ))
}
