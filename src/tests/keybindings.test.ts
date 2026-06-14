import { describe, expect, it, vi } from "vitest";

import {
  createKeyHandler,
  resolveBinding,
  type KeyActions,
} from "../lib/utils/keybindings";

function key(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("resolveBinding", () => {
  it("maps arrow keys to folder navigation", () => {
    expect(resolveBinding(key({ key: "ArrowLeft" }))).toBe("prev");
    expect(resolveBinding(key({ key: "ArrowRight" }))).toBe("next");
  });

  it("maps zoom, fit and actual-size keys", () => {
    expect(resolveBinding(key({ key: "+" }))).toBe("zoomIn");
    expect(resolveBinding(key({ key: "=" }))).toBe("zoomIn");
    expect(resolveBinding(key({ key: "-" }))).toBe("zoomOut");
    expect(resolveBinding(key({ key: "_" }))).toBe("zoomOut");
    expect(resolveBinding(key({ key: "f" }))).toBe("fit");
    expect(resolveBinding(key({ key: "F" }))).toBe("fit");
    expect(resolveBinding(key({ key: "1" }))).toBe("actualSize");
  });

  it("maps Ctrl+[ / Ctrl+] to rotation (and accepts Meta)", () => {
    expect(resolveBinding(key({ key: "[", ctrlKey: true }))).toBe("rotateLeft");
    expect(resolveBinding(key({ key: "]", ctrlKey: true }))).toBe("rotateRight");
    expect(resolveBinding(key({ key: "[", metaKey: true }))).toBe("rotateLeft");
    expect(resolveBinding(key({ key: "]", metaKey: true }))).toBe("rotateRight");
  });

  it("maps i / I to toggleInfo", () => {
    expect(resolveBinding(key({ key: "i" }))).toBe("toggleInfo");
    expect(resolveBinding(key({ key: "I" }))).toBe("toggleInfo");
  });

  it("does not hijack Ctrl/Cmd+I", () => {
    expect(resolveBinding(key({ key: "i", ctrlKey: true }))).toBeNull();
    expect(resolveBinding(key({ key: "i", metaKey: true }))).toBeNull();
  });

  it("maps F11 to fullscreen and Escape to escape", () => {
    expect(resolveBinding(key({ key: "F11" }))).toBe("toggleFullscreen");
    expect(resolveBinding(key({ key: "Escape" }))).toBe("escape");
  });

  it("maps Ctrl+Cmd+F to fullscreen (requires BOTH ctrl and meta)", () => {
    expect(
      resolveBinding(key({ key: "f", ctrlKey: true, metaKey: true })),
    ).toBe("toggleFullscreen");
    expect(
      resolveBinding(key({ key: "F", ctrlKey: true, metaKey: true })),
    ).toBe("toggleFullscreen");
  });

  it("does not hijack plain Cmd+F or Ctrl+F (Find)", () => {
    expect(resolveBinding(key({ key: "f", metaKey: true }))).toBeNull();
    expect(resolveBinding(key({ key: "f", ctrlKey: true }))).toBeNull();
  });

  it("returns null for unbound keys and for modified non-bracket keys", () => {
    expect(resolveBinding(key({ key: "a" }))).toBeNull();
    expect(resolveBinding(key({ key: "f", ctrlKey: true }))).toBeNull();
    expect(resolveBinding(key({ key: "1", metaKey: true }))).toBeNull();
  });
});

function makeActions(): KeyActions {
  return {
    prev: vi.fn(),
    next: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fit: vi.fn(),
    actualSize: vi.fn(),
    rotateLeft: vi.fn(),
    rotateRight: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleInfo: vi.fn(),
    escape: vi.fn(),
  };
}

describe("createKeyHandler", () => {
  it("dispatches the bound action and prevents default when ready", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => true);

    const e = key({ key: "ArrowRight" });
    const prevent = vi.spyOn(e, "preventDefault");
    handler(e);

    expect(actions.next).toHaveBeenCalledOnce();
    expect(prevent).toHaveBeenCalledOnce();
  });

  it("ignores unbound keys without preventing default", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => true);

    const e = key({ key: "a" });
    const prevent = vi.spyOn(e, "preventDefault");
    handler(e);

    expect(prevent).not.toHaveBeenCalled();
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("gates image-view bindings on the ready predicate", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => false);

    handler(key({ key: "ArrowRight" }));
    handler(key({ key: "+" }));
    handler(key({ key: "[", ctrlKey: true }));

    expect(actions.next).not.toHaveBeenCalled();
    expect(actions.zoomIn).not.toHaveBeenCalled();
    expect(actions.rotateLeft).not.toHaveBeenCalled();
  });

  it("always fires Escape and fullscreen even when not ready", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => false);

    handler(key({ key: "Escape" }));
    handler(key({ key: "F11" }));

    expect(actions.escape).toHaveBeenCalledOnce();
    expect(actions.toggleFullscreen).toHaveBeenCalledOnce();
  });

  it("always fires toggleInfo even when no image is ready", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => false);

    handler(key({ key: "i" }));

    expect(actions.toggleInfo).toHaveBeenCalledOnce();
  });

  it("no-ops a matched binding whose action is omitted from the bag", () => {
    const actions = makeActions();
    delete actions.toggleInfo;
    const handler = createKeyHandler(actions, () => true);

    const e = key({ key: "i" });
    const prevent = vi.spyOn(e, "preventDefault");
    expect(() => handler(e)).not.toThrow();
    expect(prevent).toHaveBeenCalledOnce();
  });

  it("can allow prev/next while not ready without enabling other image actions", () => {
    const actions = makeActions();
    const handler = createKeyHandler(
      actions,
      () => false,
      () => false,
      (binding) => binding === "prev" || binding === "next",
    );

    handler(key({ key: "ArrowRight" }));
    handler(key({ key: "ArrowLeft" }));
    handler(key({ key: "+" }));

    expect(actions.next).toHaveBeenCalledOnce();
    expect(actions.prev).toHaveBeenCalledOnce();
    expect(actions.zoomIn).not.toHaveBeenCalled();
  });

  it("suppresses bindings while a text input is focused", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => true);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const e = key({ key: "ArrowRight" });
    Object.defineProperty(e, "target", { value: input });
    handler(e);

    expect(actions.next).not.toHaveBeenCalled();
    input.remove();
  });

  it("suppresses bindings while a contenteditable element is focused", () => {
    const actions = makeActions();
    const handler = createKeyHandler(actions, () => true);

    const div = document.createElement("div");
    // jsdom does not derive isContentEditable from the attribute, so set it.
    Object.defineProperty(div, "isContentEditable", { value: true });
    const e = key({ key: "f" });
    Object.defineProperty(e, "target", { value: div });
    handler(e);

    expect(actions.fit).not.toHaveBeenCalled();
  });

  it("can block non-escape shortcuts while a modal is open", () => {
    const actions = makeActions();
    const handler = createKeyHandler(
      actions,
      () => true,
      (binding) => binding !== "escape",
    );

    handler(key({ key: "ArrowRight" }));
    handler(key({ key: "Escape" }));

    expect(actions.next).not.toHaveBeenCalled();
    expect(actions.escape).toHaveBeenCalledOnce();
  });
});
