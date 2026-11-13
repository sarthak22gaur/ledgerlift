// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "@/components/layout/header";

describe("header theme hydration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.classList.remove("dark");
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    document.documentElement.classList.remove("dark");
    vi.unstubAllGlobals();
  });

  it.each([false, true])("hydrates and toggles when browser dark mode is %s", async (dark) => {
    container.innerHTML = renderToString(<Header pageTitle="Overview" />);
    // The startup script applies the browser's theme before React hydrates.
    document.documentElement.classList.toggle("dark", dark);
    const errors: unknown[] = [];

    await act(async () => {
      root = hydrateRoot(container, <Header pageTitle="Overview" />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });

    expect(errors).toEqual([]);
    const button = container.querySelector('button[aria-label="Toggle dark mode"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(!dark);
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
  });
});
