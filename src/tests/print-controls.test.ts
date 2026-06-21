import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";

import PrintControls from "../lib/components/PrintControls.svelte";
import { print } from "../lib/stores/print.svelte";

describe("PrintControls", () => {
  beforeEach(() => print.reset());
  afterEach(() => print.reset());

  it("renders only the layout-relevant control groups", () => {
    render(PrintControls);
    expect(screen.getByText("Orientation")).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    // Paper, Margins, and Copies belong to the OS print dialog — not here.
    expect(screen.queryByText("Paper")).not.toBeInTheDocument();
    expect(screen.queryByText("Margins")).not.toBeInTheDocument();
    expect(screen.queryByText("Copies")).not.toBeInTheDocument();
  });

  it("groups orientation and fit with accessible labels", () => {
    render(PrintControls);
    expect(screen.getByRole("group", { name: "Orientation" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Image fit" })).toBeInTheDocument();
  });

  it("updates orientation and tracks aria-pressed", async () => {
    render(PrintControls);
    const landscape = screen.getByRole("button", { name: "Landscape" });
    expect(landscape).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(landscape);
    expect(print.orientation).toBe("landscape");
    expect(landscape).toHaveAttribute("aria-pressed", "true");

    const portrait = screen.getByRole("button", { name: "Portrait" });
    await fireEvent.click(portrait);
    expect(print.orientation).toBe("portrait");
  });

  it("updates the fit mode", async () => {
    render(PrintControls);
    await fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(print.fit).toBe("fill");
    await fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(print.fit).toBe("fit");
  });
});
