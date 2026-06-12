# ImageAreo

**ImageAreo** is a lightweight, fast, modern desktop image viewer for **macOS** and **Windows**. It is built for people who open a lot of photos — from everyday JPEGs and phone HEIC shots to camera RAW files — and want a viewer that stays out of the way. The image is always the focus; toolbars and controls fade when you are not using them, and almost everything can be done from the keyboard.

Built with [Tauri 2](https://v2.tauri.app/) (Rust + native OS webview) and [Svelte 5](https://svelte.dev/).

---

## Why ImageAreo?

Most built-in viewers are fine for a quick peek, but they often struggle with less common formats, feel sluggish when zooming, or bury useful actions behind menus. ImageAreo is designed around a few simple ideas:

- **Open anything local** — JPEG and PNG load instantly; HEIC, TIFF, AVIF, JPEG XL, and camera RAW files are decoded inside the app so you do not need extra plugins.
- **Browse a whole folder, not just one file** — when you open an image, ImageAreo loads the rest of the folder into a gallery strip so you can step through shots with the arrow keys or a click.
- **Zoom that feels good** — smooth, cursor-anchored scroll-wheel zoom with drag-to-pan and momentum, plus one-key fit and 100% modes.
- **Small and native** — a compact install (no bundled Chromium), native window chrome, and OS integrations like “Reveal in Finder/Explorer” and clipboard copy.
- **Honest about scope** — ImageAreo is a *viewer*, not an editor. No crop, filters, or export workflows — just fast, pleasant browsing.

---

## Download

Get the latest release for your platform from **[GitHub Releases](https://github.com/omega123456/ImageAreo/releases/latest)**.

| Platform | What to download | Notes |
|----------|------------------|-------|
| **macOS (Apple Silicon)** | `ImageAreo-*-macos-aarch64.dmg` | M-series Macs |
| **macOS (Intel)** | `ImageAreo-*-macos-x86_64.dmg` | Intel Macs |
| **Windows** | `ImageAreo-*-windows-x86_64-setup.exe` | 64-bit Windows 11+ |

> **System requirements:** macOS **14 (Sonoma)** or later · Windows **11** or later

---

## Installation

### Windows

1. Download the `.exe` installer from [Releases](https://github.com/omega123456/ImageAreo/releases/latest).
2. Double-click the installer and follow the setup wizard.
3. Launch **ImageAreo** from the Start menu, or double-click any supported image file.

**SmartScreen warning:** Windows may show a “Windows protected your PC” dialog because ImageAreo is distributed directly from GitHub and has not yet built up SmartScreen reputation. This is normal for independent open-source apps. Click **More info**, then **Run anyway** to continue.

During install you can optionally register ImageAreo as the default app for common image types. You can also change file associations later from **Settings → File Types** inside the app.

### macOS

ImageAreo for macOS is **not code-signed or notarized** in v1. When you download the app from the browser, macOS marks it with a **quarantine** flag and Gatekeeper will block the first launch. This does **not** mean the file is malicious — it is the standard behaviour for unsigned software downloaded from the internet.

You need to do **both** steps below: clear the quarantine flag with `xattr`, then approve the first launch with right-click → Open.

1. Download the `.dmg` from [Releases](https://github.com/omega123456/ImageAreo/releases/latest).

2. **Remove quarantine from the DMG** — open Terminal and run (adjust the path if your download folder or filename differs):

   ```bash
   xattr -d com.apple.quarantine ~/Downloads/ImageAreo-*-macos-*.dmg
   ```

3. Open the DMG and drag **ImageAreo** into your **Applications** folder.

4. **Remove quarantine from the installed app**:

   ```bash
   xattr -dr com.apple.quarantine /Applications/ImageAreo.app
   ```

   The `-r` flag walks the entire `.app` bundle. Adjust the path if you installed ImageAreo somewhere other than `/Applications`.

5. **Approve the first launch** — in Finder, go to **Applications**, **right-click** (or Control-click) **ImageAreo**, and choose **Open** (do not double-click yet). In the dialog, click **Open** again to confirm.

macOS remembers your choice after step 5. From then on you can launch ImageAreo normally from Applications, Launchpad, or by double-clicking image files.

#### macOS troubleshooting

| Symptom | What to try |
|---------|-------------|
| “App can’t be opened because Apple cannot check it for malicious software” | Repeat step 5 (right-click → Open) |
| “ImageAreo is damaged and can’t be opened” | Repeat steps 2 and 4 (`xattr` on the DMG and the `.app`) |
| App opens but images do not | Check that you are on macOS 14+ and try opening a common format (JPEG/PNG) first |
| Wrong architecture | Apple Silicon Macs need the `aarch64` DMG; Intel Macs need `x86_64` |

---

## Getting started

### Opening images and folders

There are three ways to get started:

1. **Double-click a file** in Finder or File Explorer — if ImageAreo is associated with that file type, it opens directly.
2. **Drag and drop** a file (or folder) onto the ImageAreo window.
3. Use the toolbar or menu: **Open image** (single file) or **Open folder** (browse the first image in that folder).

When you open a single image, ImageAreo automatically scans the **parent folder** (not subfolders) and loads every supported image it finds into the gallery strip at the bottom of the window.

### The main window

ImageAreo’s layout is intentionally minimal:

- **Canvas** — the image fills the centre on a neutral surround (dark in dark mode, soft light grey in light mode) so your photo is not sitting on harsh pure white.
- **Floating toolbar** — a compact bar with open, zoom, rotate, fullscreen, gallery toggle, and settings actions. It auto-hides after a few seconds of idle time and reappears when you move the mouse or press a key.
- **Gallery strip (filmstrip)** — a horizontal row of thumbnails for every image in the current folder. Click a thumbnail to jump between files. Toggle visibility from the toolbar.
- **Zoom HUD** — a small readout showing the current zoom level (for example “Fit” or “142%”). It appears briefly when you zoom and then fades away.
- **Settings drawer** — slides in from the right without covering the image, so you can preview theme and gallery changes live.

### Viewing and navigating

- **Scroll the mouse wheel** over the image to zoom in and out smoothly. Zoom is anchored to the cursor position, so the point under your mouse stays fixed as you magnify — useful for inspecting detail in a photo.
- **Click and drag** to pan when zoomed in. Release the mouse and the view carries a little momentum, similar to a map or photo app.
- **Right-click** the image to open the context menu.

Most actions — navigation, zoom, fit, rotation, fullscreen, and more — are also available via **keyboard shortcuts**, so you can browse hands-on-keyboard when you want to.

### Fullscreen

Fullscreen hides the toolbar and zoom HUD for a distraction-free view; the gallery strip stays available. Move the mouse or press a key to bring controls back temporarily. Exit from the toolbar or a keyboard shortcut.

### Multiple windows

ImageAreo deliberately supports **more than one window at a time**. Open a second folder in a new window from **File → New Window** (or launch the app again). Each window keeps its own folder context — handy when comparing shots from two locations or reviewing exports alongside originals.

---

## Supported formats

ImageAreo handles a wide range of still-image formats. Common web formats are rendered by the OS for maximum speed; everything else is decoded by ImageAreo’s built-in Rust engine.

### Everyday formats (instant native rendering)

| Format | Extensions |
|--------|------------|
| JPEG | `.jpg`, `.jpeg` |
| PNG | `.png` |
| GIF | `.gif` (static frames; not animated playback) |
| WebP | `.webp` |

### Formats decoded inside ImageAreo

| Category | Extensions |
|----------|------------|
| Modern compressed | `.avif`, `.jxl` |
| Classic / legacy | `.tif`, `.tiff`, `.bmp`, `.ico` |
| Apple | `.heic`, `.heif` |
| Camera RAW | `.cr2`, `.cr3`, `.nef`, `.arw`, `.dng`, `.orf`, `.rw2`, `.raf`, `.srw`, `.pef`, `.raw`, and others |

RAW and HEIC files may take a moment longer to display while the decoder runs. A loading indicator appears for slow decodes; corrupt or unsupported files show a clear error state with a retry option.

> **Note:** ImageAreo only works with **local files**. Cloud-only paths, network drives with restricted access, or files your OS cannot read will not open.

---

## Updates

ImageAreo checks for new versions when it starts. If an update is available, a small toast appears in the corner — you can install immediately or dismiss it and update later from **Settings → About**. Updates are downloaded from [GitHub Releases](https://github.com/omega123456/ImageAreo/releases/latest) and applied in-app; you do not need to download a new installer manually unless you prefer to.

---

## What ImageAreo does not do (v1)

To set expectations, these are intentionally out of scope for the current release:

- No image editing beyond on-screen rotation (no crop, filters, colour adjustments, or annotations).
- No saving, exporting, or format conversion.
- No slideshow, batch rename, or printing.
- No cloud or remote sources — local files only.
- No recursive folder scanning (only the folder containing the opened file).
- No Linux build in v1 (macOS and Windows only).

---

## Development

ImageAreo is a **Tauri 2** desktop shell around a **Svelte 5 + Vite** frontend, with image decoding and folder scanning in **Rust**. If you want to run, debug, or contribute, set up the toolchain below.

### Tech stack

| Layer | Stack |
|-------|-------|
| Desktop shell | Tauri 2 (Rust + native OS webview) |
| Frontend | Svelte 5 (Runes), Vite, TypeScript |
| UI | Skeleton UI v4, Tailwind CSS 4, Phosphor icons |
| Unit / component tests | Vitest, jsdom, Testing Library |
| Rust tests | Integration tests via Cargo (`src-tauri/tests/`) |
| End-to-end tests | Playwright (Chromium), specs in `e2e/` |

### Prerequisites

Install these before cloning:

- **[Node.js](https://nodejs.org/)** (LTS)
- **[pnpm](https://pnpm.io/)** 9+
- **[Rust](https://www.rust-lang.org/tools/install)** (stable toolchain)
- **[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)** for your platform — Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows

### Initial setup

```bash
git clone https://github.com/omega123456/ImageAreo.git
cd ImageAreo
pnpm install
```

**Playwright browsers** (one-time, required for E2E tests):

```bash
pnpm exec playwright install chromium
```

This downloads the Chromium build Playwright uses. Without it, `pnpm test:e2e` will fail on a fresh machine.

### Running locally

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Vite dev server only (frontend in the browser at `http://localhost:1420`) |
| `pnpm tauri:dev` | Full desktop app — Vite on port `1420` inside the native Tauri window (use this for day-to-day app work) |
| `pnpm check` | Type-check Svelte and TypeScript (`svelte-check`) |
| `pnpm build` | Production frontend build → `dist/` |
| `pnpm tauri:build` | Production desktop app and platform installers |

For frontend-only UI work, `pnpm dev` is enough. For anything involving IPC, native menus, file dialogs, or decoding, use `pnpm tauri:dev`.

After changing Tauri **capabilities** (`src-tauri/capabilities/default.json`), restart `pnpm tauri:dev` so permission changes are picked up.

### Project layout

```
src/              Svelte frontend (components, stores, IPC wrappers, utils)
src/tests/        Vitest unit and component tests
src-tauri/        Rust backend (commands, image decode, folder scan)
src-tauri/tests/  Rust integration tests
e2e/              Playwright end-to-end specs and screenshot baselines
```

`invoke()` is only called from `src/lib/ipc/` — frontend tests mock the backend through `src/tests/ipc-mock.ts`.

### Testing

The project enforces **≥ 90% coverage** on both the frontend (Vitest) and Rust integration tests. Run the full gate before opening a PR:

```bash
pnpm test:all
```

That runs, in order: frontend coverage → Rust coverage → Playwright E2E.

**Frontend (Vitest)** — fast unit and component tests in jsdom:

```bash
pnpm test              # run once
pnpm test:watch        # watch mode
pnpm test:coverage     # run with the 90% coverage gate
```

Tests live in `src/tests/`. The backend is mocked at the IPC seam (`ipc-mock.ts` + `fixtures.ts`).

**Rust** — integration tests only (not inline `#[cfg(test)]` in production code):

```bash
pnpm test:rust           # integration tests
pnpm test:rust:coverage  # integration tests with coverage gate
```

**End-to-end (Playwright)** — browser tests against the Vite dev server (Chromium). Most specs exercise the UI in a real browser; screenshot specs compare against platform-specific baselines under `e2e/snapshots/`.

```bash
pnpm test:e2e
```

Playwright picks a free port automatically (`scripts/ensure-playwright-port.mjs` writes `.playwright-dev-port` before the run). Do not invoke `playwright test` directly unless you have set that up — always use `pnpm test:e2e`.

To **update screenshot baselines** after an intentional visual change:

```bash
pnpm test:e2e e2e/screenshots -- --update-snapshots
```

Baselines are per-platform (`darwin` / `win32`); update them on the OS you are targeting.

### Cleaning up

```bash
pnpm clean:rust-target   # remove Rust build artifacts (src-tauri/target)
```

---

## Contributing

Bug reports, feature ideas, and pull requests are welcome on [GitHub](https://github.com/omega123456/ImageAreo). For larger changes, please open an issue first so we can agree on direction before you invest time in a PR.

---

## License

ImageAreo is open source under the [MIT License](LICENSE).
