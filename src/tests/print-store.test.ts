import { afterEach, describe, expect, it } from "vitest";

import { COPIES_MAX, COPIES_MIN } from "../lib/utils/print-presets";
import { print } from "../lib/stores/print.svelte";

describe("print store", () => {
  afterEach(() => print.reset());

  it("has a sensible baseline default state", () => {
    expect(print.open).toBe(false);
    expect(print.template).toBe("full");
    expect(print.paperSize).toBe("letter");
    expect(print.orientation).toBe("portrait");
    expect(print.margins).toBe("normal");
    expect(print.copies).toBe(1);
    expect(print.fit).toBe("fit");
  });

  it("opens and closes the print window", () => {
    expect(print.open).toBe(false);

    print.openWindow();
    expect(print.open).toBe(true);

    print.closeWindow();
    expect(print.open).toBe(false);
  });

  it("keeps the print layer alive after the modal closes, until ended", () => {
    print.setPrintImage("data:image/png;base64,AAAA");
    print.beginPrinting();
    // The modal closes the instant the OS dialog opens, but the print layer
    // must persist for the async dialog to read.
    print.closeWindow();
    expect(print.open).toBe(false);
    expect(print.printing).toBe(true);
    expect(print.printImage).toBe("data:image/png;base64,AAAA");

    print.endPrinting();
    expect(print.printing).toBe(false);
    expect(print.printImage).toBe("");
  });

  it("clears a leftover print layer when the window is reopened", () => {
    print.setPrintImage("data:image/png;base64,AAAA");
    print.beginPrinting();
    print.closeWindow();

    print.openWindow();
    expect(print.open).toBe(true);
    expect(print.printing).toBe(false);
    expect(print.printImage).toBe("");
  });

  it("sets the template", () => {
    print.setTemplate("nineUp");
    expect(print.template).toBe("nineUp");
  });

  it("sets the paper size", () => {
    print.setPaperSize("a4");
    expect(print.paperSize).toBe("a4");
  });

  it("sets the orientation", () => {
    print.setOrientation("landscape");
    expect(print.orientation).toBe("landscape");
  });

  it("sets the margins", () => {
    print.setMargins("wide");
    expect(print.margins).toBe("wide");
  });

  it("sets the fit mode", () => {
    print.setFit("fill");
    expect(print.fit).toBe("fill");
  });

  it("sets copies within bounds", () => {
    print.setCopies(5);
    expect(print.copies).toBe(5);
  });

  it("clamps copies to the lower bound", () => {
    print.setCopies(0);
    expect(print.copies).toBe(COPIES_MIN);

    print.setCopies(-10);
    expect(print.copies).toBe(COPIES_MIN);
  });

  it("clamps copies to the upper bound", () => {
    print.setCopies(100);
    expect(print.copies).toBe(COPIES_MAX);

    print.setCopies(1000);
    expect(print.copies).toBe(COPIES_MAX);
  });

  it("truncates fractional copies before clamping", () => {
    print.setCopies(3.9);
    expect(print.copies).toBe(3);
  });

  it("reset restores every field to its default", () => {
    print.openWindow();
    print.setTemplate("contact");
    print.setPaperSize("a4");
    print.setOrientation("landscape");
    print.setMargins("none");
    print.setCopies(7);
    print.setFit("fill");
    print.beginPrinting();
    print.setPrintImage("data:image/png;base64,AAAA");

    print.reset();

    expect(print.open).toBe(false);
    expect(print.printing).toBe(false);
    expect(print.printImage).toBe("");
    expect(print.template).toBe("full");
    expect(print.paperSize).toBe("letter");
    expect(print.orientation).toBe("portrait");
    expect(print.margins).toBe("normal");
    expect(print.copies).toBe(COPIES_MIN);
    expect(print.fit).toBe("fit");
  });
});
