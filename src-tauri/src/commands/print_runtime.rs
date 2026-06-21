use super::print::{mm_to_points, PrintCommandError, PrintOrientation};

/// Trigger the OS-native print dialog for the main webview.
///
/// The webview renders the store-driven print-only DOM under `@media print`
/// (see `PrintPageLayout.svelte`), so the panel prints the tiled layout. The
/// command is told the selected paper size (mm) + orientation so the macOS
/// native path can seed a matching `NSPrintInfo`. The actual print panel is an
/// OS side effect that cannot be asserted headlessly, so this whole module is on
/// the coverage-exclusion list (same policy as the clipboard/reveal/fullscreen
/// OS steps). The pure mm→points / orientation mapping lives in `print.rs` and
/// stays covered.
#[tauri::command(rename_all = "camelCase")]
pub async fn print_current_view(
    webview_window: tauri::WebviewWindow,
    paper_width_mm: f64,
    paper_height_mm: f64,
    orientation: String,
) -> Result<(), PrintCommandError> {
    let orientation = PrintOrientation::from_str(&orientation);
    run_native_print(&webview_window, paper_width_mm, paper_height_mm, orientation)
}

/// macOS: drive the `WKWebView` → AppKit `printOperationWithPrintInfo:` print
/// panel. Runs inside `with_webview`, which executes on the main thread (a hard
/// requirement for AppKit calls). The panel is presented as a window-modal sheet
/// so the call returns immediately.
#[cfg(target_os = "macos")]
fn run_native_print(
    webview_window: &tauri::WebviewWindow,
    paper_width_mm: f64,
    paper_height_mm: f64,
    orientation: PrintOrientation,
) -> Result<(), PrintCommandError> {
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintInfo, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSCopying, NSSize};
    use objc2_web_kit::WKWebView;

    let paper_size = NSSize::new(
        mm_to_points(paper_width_mm),
        mm_to_points(paper_height_mm),
    );
    let paper_orientation = match orientation {
        PrintOrientation::Portrait => NSPaperOrientation::Portrait,
        PrintOrientation::Landscape => NSPaperOrientation::Landscape,
    };

    webview_window
        .with_webview(move |platform| {
            let webview_ptr = platform.inner() as *mut WKWebView;
            if webview_ptr.is_null() {
                return;
            }
            let ns_window_ptr = platform.ns_window() as *mut NSWindow;

            // SAFETY: pointers are the live WKWebView / NSWindow owned by the
            // window, valid for the duration of this main-thread closure.
            unsafe {
                let webview = &*webview_ptr;
                // Seed a MUTABLE COPY of the shared print info — never mutate the
                // process-wide `sharedPrintInfo()` singleton — and apply the
                // chosen paper size (points) + orientation, disabling AppKit's
                // automatic scaling so the mm-sized print DOM maps 1:1.
                let print_info = NSPrintInfo::sharedPrintInfo();
                let print_info = print_info.copy();
                print_info.setPaperSize(paper_size);
                print_info.setOrientation(paper_orientation);
                // Zero the imageable-area margins so the full-bleed, mm-sized
                // print DOM (CSS `@page { margin: 0 }`) maps 1:1 onto the sheet.
                // Without this the default 1-inch `NSPrintInfo` margins shrink
                // the imageable area and, with `Clip` pagination below, crop the
                // page box's right/bottom edges.
                print_info.setTopMargin(0.0);
                print_info.setBottomMargin(0.0);
                print_info.setLeftMargin(0.0);
                print_info.setRightMargin(0.0);
                print_info.setHorizontalPagination(NSPrintingPaginationMode::Clip);
                print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
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
    _paper_width_mm: f64,
    _paper_height_mm: f64,
    _orientation: PrintOrientation,
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
    _paper_width_mm: f64,
    _paper_height_mm: f64,
    _orientation: PrintOrientation,
) -> Result<(), PrintCommandError> {
    Err(PrintCommandError::print(
        "native printing is not supported on this platform",
    ))
}
