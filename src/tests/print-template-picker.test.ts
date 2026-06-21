import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";

import PrintTemplatePicker from "../lib/components/PrintTemplatePicker.svelte";
import { print } from "../lib/stores/print.svelte";
import { TEMPLATES, TEMPLATE_ORDER } from "../lib/utils/print-presets";

function radios(): HTMLElement[] {
  return screen.getAllByRole("radio");
}

describe("PrintTemplatePicker", () => {
  beforeEach(() => {
    print.template = "full";
  });

  afterEach(() => {
    print.template = "full";
  });

  it("renders a radiogroup with the five templates in order", () => {
    render(PrintTemplatePicker);

    const group = screen.getByRole("radiogroup", { name: "Layout template" });
    expect(group).toBeInTheDocument();

    const cards = radios();
    expect(cards).toHaveLength(TEMPLATE_ORDER.length);

    TEMPLATE_ORDER.forEach((id, index) => {
      const label = TEMPLATES[id].label;
      expect(cards[index]).toHaveAttribute("aria-label", label);
      // Visible label text and an aria-hidden diagram glyph.
      expect(cards[index]).toHaveTextContent(label);
      expect(cards[index].querySelector("[aria-hidden='true']")).toBeTruthy();
    });
  });

  it("reflects the store's selection via aria-checked and roving tabindex", () => {
    print.template = "fourUp";
    render(PrintTemplatePicker);

    const cards = radios();
    const fourUpIndex = TEMPLATE_ORDER.indexOf("fourUp");

    cards.forEach((card, index) => {
      const isSelected = index === fourUpIndex;
      expect(card).toHaveAttribute("aria-checked", String(isSelected));
      expect(card.getAttribute("tabindex")).toBe(isSelected ? "0" : "-1");
    });
  });

  it("selects a card on click and updates the store", async () => {
    render(PrintTemplatePicker);
    const cards = radios();
    const nineUpIndex = TEMPLATE_ORDER.indexOf("nineUp");

    await fireEvent.click(cards[nineUpIndex]);

    expect(print.template).toBe("nineUp");
    expect(cards[nineUpIndex]).toHaveAttribute("aria-checked", "true");
  });

  it("selects with Enter and Space", async () => {
    render(PrintTemplatePicker);
    const cards = radios();
    const contactIndex = TEMPLATE_ORDER.indexOf("contact");
    const twoUpIndex = TEMPLATE_ORDER.indexOf("twoUp");

    await fireEvent.keyDown(cards[contactIndex], { key: "Enter" });
    expect(print.template).toBe("contact");

    await fireEvent.keyDown(cards[twoUpIndex], { key: " " });
    expect(print.template).toBe("twoUp");
  });

  it("moves selection forward with ArrowRight/ArrowDown", async () => {
    render(PrintTemplatePicker);
    let cards = radios();

    await fireEvent.keyDown(cards[0], { key: "ArrowRight" });
    expect(print.template).toBe(TEMPLATE_ORDER[1]);

    cards = radios();
    await fireEvent.keyDown(cards[1], { key: "ArrowDown" });
    expect(print.template).toBe(TEMPLATE_ORDER[2]);
  });

  it("moves selection backward with ArrowLeft/ArrowUp", async () => {
    print.template = TEMPLATE_ORDER[2];
    render(PrintTemplatePicker);
    let cards = radios();

    await fireEvent.keyDown(cards[2], { key: "ArrowLeft" });
    expect(print.template).toBe(TEMPLATE_ORDER[1]);

    cards = radios();
    await fireEvent.keyDown(cards[1], { key: "ArrowUp" });
    expect(print.template).toBe(TEMPLATE_ORDER[0]);
  });

  it("wraps from last to first and first to last", async () => {
    const last = TEMPLATE_ORDER.length - 1;
    print.template = TEMPLATE_ORDER[last];
    render(PrintTemplatePicker);
    let cards = radios();

    await fireEvent.keyDown(cards[last], { key: "ArrowRight" });
    expect(print.template).toBe(TEMPLATE_ORDER[0]);

    cards = radios();
    await fireEvent.keyDown(cards[0], { key: "ArrowLeft" });
    expect(print.template).toBe(TEMPLATE_ORDER[last]);
  });

  it("prevents default on arrow and activation keys", async () => {
    render(PrintTemplatePicker);
    const cards = radios();

    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
      cards[0].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("ignores unrelated keys", async () => {
    render(PrintTemplatePicker);
    const cards = radios();

    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
    cards[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(print.template).toBe("full");
  });
});
