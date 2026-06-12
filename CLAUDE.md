# CLAUDE.md — ImageAreo

> Project rules and conventions. Established before scaffolding so they govern all work.
> Sections marked _(filled in by P1/P18)_ are completed by later phases — do not remove the rules above them.

## Project Overview

**ImageAreo** is a lightweight, fast, modern cross-platform desktop image viewer (inspired by ImageGlass). The image is the hero; chrome recedes; interaction is keyboard- and mouse-driven. Open-source (MIT/Apache-2.0).

- **Targets:** macOS 14+ and Windows 11+ (Linux is a non-goal for v1).
- **Plan of record:** `.agent/plans/2026-06-10_imageareo_plan.md` (built test-first, phase by phase).

## Tech Stack

- **Shell:** Tauri 2 (Rust backend + native OS webview)
- **Frontend:** Svelte 5 (Runes), plain Svelte + Vite SPA (no SvelteKit)
- **UI:** Skeleton UI v4 + Tailwind CSS 4
- **Icons:** Phosphor (`phosphor-svelte`)
- **Font:** Inter Variable (`@fontsource-variable/inter`)
- **Package manager:** pnpm
- **Key crates:** `image`, `heic`, `rawler`, `jxl-oxide`, `fast_image_resize`, `tauri-plugin-{store,dialog,opener,updater,clipboard-manager}`
- **Key packages:** `@skeletonlabs/skeleton`, `tailwind-scrollbar`

## Directory Structure

```
src/                      # Svelte 5 frontend
  lib/
    components/           # viewer, gallery, toolbar, settings, context menu, states
    stores/               # runes *.svelte.ts: settings, folder, viewer, updater
    ipc/                  # typed wrappers over invoke() — the ONLY place invoke is called
    utils/                # zoom-pan-controller, easing, keybindings, format
    types/
  tests/                  # Vitest: setup.ts, ipc-mock.ts, fixtures.ts, *.test.ts
src-tauri/
  src/
    commands/             # IPC handlers
    image/                # decode dispatch + supported-extension sets
    thumbnail/            # fast_image_resize generation
    folder/               # directory scan + sort
    menu/                 # native app menu
  tests/                  # *_integration.rs (Tauri test feature)
e2e/                      # Playwright specs
```

## Styling Rules (NON-NEGOTIABLE)

1. **No hand-written CSS.** All styling is Tailwind utility classes + Skeleton v4 components.
2. **No Tailwind arbitrary/bracket classes** (e.g. `bg-[#141414]`, `pl-[72px]`, `w-[320px]`). If a value isn't covered by a standard utility, add a **named theme token** (Skeleton/Tailwind color ramp or a custom token) and use it by name.
3. **Colors come from theme tokens.** The image **canvas-surround** colors are named tokens (a dark token for dark mode, a medium-light neutral token for light mode) — never bracket hex.
4. **Scrollbars** are styled only with the `tailwind-scrollbar` plugin utilities (`scrollbar-thin`, `scrollbar-thumb-*`). No `::-webkit-scrollbar` CSS.
5. **Dynamic transforms** (zoom/pan `scale`/`translate`) are applied as JS-driven inline `style` bindings from the zoom/pan controller. This is the only permitted inline-style use and does not count as stylesheet CSS.
6. **Theme** is system-follow by default with Dark/Light overrides.

## Testing Rules & Gating (NON-NEGOTIABLE)

1. **Tests are built side-by-side with code** in the same phase, starting from the test-scaffolding phase (P3). Do not defer tests to a later phase.
2. **Coverage gate: ≥ 90%** (Vitest line/function/statement thresholds on the frontend; Rust coverage), enforced in config. A change is not done if it drops coverage below 90%.
3. **Coverage-exclusion policy:** OS-side-effect code that cannot be asserted headlessly is excluded from the denominator — the OS write step of clipboard copy, reveal-in-file-manager, fullscreen window calls, updater install/relaunch, and the launch-path OS-event hookup. Their **pure logic** (decode, path parsing, sorting, classification) is NOT excluded and must be tested.
4. **Frontend tests** use Vitest (jsdom) + `@testing-library/svelte`, located in `src/tests/`. Mock the backend through the centralized **IPC mock seam** (`src/tests/ipc-mock.ts` + `fixtures.ts`): override per test with `ipc.override(cmd, handler)`.
5. **Rust tests** are integration tests in `src-tauri/tests/*_integration.rs` using the Tauri `test` feature and `tempfile` fixtures. Do **not** place Rust tests in `src-tauri/src/`; production Rust files must not contain inline `#[cfg(test)]` modules.
6. **E2E** uses Playwright (`e2e/`).

## Coding Conventions

- **State:** Svelte 5 runes in `.svelte.ts` store modules. No external state library.
- **IPC boundary:** `invoke()` is called **only** from `src/lib/ipc/`. Components/stores call typed wrappers, never `invoke` directly. This keeps the IPC seam mockable.
- **Tauri permissions/capabilities are mandatory plumbing.** Any new frontend use of a Tauri core API or plugin command must be checked against `src-tauri/capabilities/default.json` and granted explicitly if needed.
  If a command works in types/JS but fails at runtime with `not allowed`, this is usually a missing capability permission, not a logic bug.
  Example: native fullscreen via `@tauri-apps/api/window` requires the matching window permission such as `core:window:allow-set-fullscreen` in [src-tauri/capabilities/default.json](/Users/jozsef.kovacs/Projects/ImageAero/src-tauri/capabilities/default.json).
  When adding a new Tauri permission, update tests for the calling seam and restart `pnpm tauri:dev` so the capability change is actually loaded.
- **Format routing:** only `jpg/jpeg/png/gif/webp` are "native" (rendered via `convertFileSrc`). Every other supported format (avif, tif/tiff, bmp, ico, heic/heif, raw types, jxl) goes through the Rust `decode_image` command.
- **Filmstrip:** hand-windowed horizontal carousel; no virtualization plugin dependency.
- **Gallery settings:** a single `galleryDensity` setting replaces the old thumbnail count and size controls.
- **Comments:** minimal — only where the *why* is non-obvious.
- **Accessibility:** `aria-label` on all icon-only buttons; keyboard-operable menus; focus-trapped drawer; debounced `aria-live` for the zoom indicator.

## Commands

Install dependencies first with `pnpm install`.

- `pnpm dev` — run the Vite frontend dev server (port 1420)
- `pnpm tauri:dev` (alias: `pnpm tauri dev`) — run the full desktop app in development
- `pnpm build` — production build of the frontend (output: `dist/`)
- `pnpm tauri:build` (alias: `pnpm tauri build`) — build the native desktop app/installers
- `pnpm check` — type-check Svelte + TypeScript (`svelte-check`)
- `pnpm tauri` — Tauri CLI passthrough
- `pnpm test:coverage` — frontend tests with the 90% gate
- `pnpm test:rust:coverage` — Rust integration tests
- `pnpm test:e2e` — Playwright E2E
- `pnpm test:e2e e2e/screenshots -- --update-snapshots` — Playwright E2E and update the baseline
- `pnpm test:all` — everything

## Release Process

_(filled in by P18)_ — GitHub Actions builds macOS (unsigned for v1) + Windows artifacts on tagged releases, signs update artifacts with the updater key, and publishes `latest.json` for the auto-updater.
