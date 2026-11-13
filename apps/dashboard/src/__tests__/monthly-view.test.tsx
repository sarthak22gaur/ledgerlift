// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MonthlyControls from "@/components/monthly/monthly-controls";
import MonthlyView from "@/components/monthly/monthly-view";
import MonthlyPage from "@/app/monthly/page";
import type { MonthlyOverview } from "@/server/data/types";

const { push, getMonthlyOverview, getFilterOptions } = vi.hoisted(() => ({ push: vi.fn(), getMonthlyOverview: vi.fn(), getFilterOptions: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/layout/app-shell", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/server/auth/can-share", () => ({ canShare: async () => false }));
vi.mock("@/server/data/repository", () => ({ getMonthlyOverview, getFilterOptions }));

const fixture: MonthlyOverview = {
  month: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30",
  latestImportedDate: "2026-11-10", selectedLatestDate: "2026-11-10", transactionCount: 4,
  comparisonDay: 10, comparisonEndDate: "2026-11-10", categorySpending: 120,
  filters: { institutions: ["Example Bank"], accounts: ["Everyday"], search: "sample" },
  metrics: { totalIncome: 500, totalExpenses: 95, netCashflow: 405, uncategorizedSpend: 20, transactionCount: 4, transferPairCount: 0, transferAmount: 0 },
  categories: [
    { category: "Utilities", amount: 100, count: 2, percentage: 100 / 120 * 100, comparisonAmount: 100, previousAmount: 50, previousDifference: 50, previousPercent: 100, threeMonthAverage: 60, isNew: false },
    { category: "Uncategorized", amount: 20, count: 1, percentage: 20 / 120 * 100, comparisonAmount: 20, previousAmount: 0, previousDifference: 20, previousPercent: null, threeMonthAverage: 0, isNew: true },
  ],
  merchants: [{ merchant: "Sample Electric", amount: 100, count: 2, category: "Utilities" }],
};

function markup(data = fixture) {
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(<MonthlyView data={data} />);
  return element;
}

describe("monthly spending presentation", () => {
  it("separates spending and cashflow and links contributing debit scopes", () => {
    const element = markup();
    expect(element.textContent).toContain("Category spending");
    expect(element.textContent).toContain("Cash outflow after reimbursements");
    expect(element.textContent).toContain("$120.00");
    expect(element.textContent).toContain("$95.00");
    expect(element.textContent).toContain("Comparisons through day 10");
    expect(element.textContent).toContain("Positive refunds do not reduce it");
    expect(element.textContent).toContain("excluded from these spending totals");
    const category = element.querySelector<HTMLAnchorElement>('a[aria-label="View Utilities debit transactions"]')!;
    const params = new URL(category.href).searchParams;
    expect(params.get("startDate")).toBe("2026-11-01");
    expect(params.get("endDate")).toBe("2026-11-30");
    expect(params.get("direction")).toBe("debit");
    expect(params.get("institutions")).toBe("Example Bank");
    expect(params.get("accounts")).toBe("Everyday");
    expect(params.get("categories")).toBe("Utilities");
    const merchant = [...element.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent?.includes("Sample Electric"))!;
    expect(new URL(merchant.href).searchParams.get("merchants")).toBe("Sample Electric");
    expect(element.querySelector('[aria-label="Active monthly filters"]')?.textContent).toContain("Search: sample");
  });

  it("withholds missing baselines and never calls absent history new spending", () => {
    const element = markup({ ...fixture, categories: fixture.categories.map((category) => ({ ...category, previousAmount: null, previousDifference: null, previousPercent: null, threeMonthAverage: null, isNew: false })) });
    expect(element.textContent).toContain("No imported data for the prior month");
    expect(element.textContent).toContain("A prior-month baseline is needed");
    expect(element.querySelector("tbody")?.textContent).not.toContain("New");
    expect(element.querySelector("tbody")?.textContent).not.toContain("100.0%");
  });

  it("shows actual month amounts separately when comparisons stop earlier", () => {
    const element = markup({ ...fixture, categories: [{ ...fixture.categories[0], amount: 150, comparisonAmount: 100 }] });
    expect(element.querySelector("thead")?.textContent).toContain("Through day 10");
    expect(element.querySelector("tbody")?.textContent).toContain("$150.00");
    expect(element.querySelector("tbody")?.textContent).toContain("$100.00");
  });

  it("shows an honest empty month without financial summary cards", () => {
    const element = markup({ ...fixture, transactionCount: 0, categories: [], merchants: [], categorySpending: 0 });
    expect(element.textContent).toContain("No imported transactions for November 2026");
    expect(element.textContent).toContain("does not establish zero spending");
    expect(element.textContent).not.toContain("Net cashflow");
  });

  it("renders a database failure as an error rather than a no-data month", async () => {
    getMonthlyOverview.mockRejectedValueOnce(new Error("synthetic unavailable database"));
    getFilterOptions.mockResolvedValueOnce({ institutions: [], accounts: [], categories: [], merchants: [] });
    const html = renderToStaticMarkup(await MonthlyPage({ searchParams: Promise.resolve({ month: "2026-11" }) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Monthly overview could not be loaded");
    expect(html).not.toContain("No imported transactions");
  });
});

describe("monthly controls", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    vi.unstubAllGlobals();
    push.mockReset();
  });
  const controls = <MonthlyControls month="2026-01" filters={{ ...fixture.filters, direction: "credit", startDate: "2025-01-01" }} institutions={["Example Bank"]} accounts={["Everyday"]} />;

  it("hydrates deterministically and preserves non-date filters across year boundaries", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(controls);
    const errors: unknown[] = [];
    await act(async () => { root = hydrateRoot(container!, controls, { onRecoverableError: (error) => errors.push(error) }); });
    expect(errors).toEqual([]);
    expect(container.querySelector('input[type="month"]')?.getAttribute("id")).toBe("monthly-month");
    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="Previous month"]')!;
    await act(async () => { previous.click(); });
    const previousParams = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(previousParams.get("month")).toBe("2025-12");
    expect(previousParams.get("institutions")).toBe("Example Bank");
    expect(previousParams.get("accounts")).toBe("Everyday");
    expect(previousParams.get("direction")).toBe("credit");
    expect(previousParams.has("startDate")).toBe(false);
    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-label="Next month"]')!.click(); });
    expect(new URL(push.mock.calls[1][0], "http://localhost").searchParams.get("month")).toBe("2026-02");
  });

  it("keeps institution and account controls available for empty scope options", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => { root = createRoot(container!); root.render(<MonthlyControls month="2026-11" filters={{}} institutions={[]} accounts={[]} />); });
    expect(container.querySelector('button[aria-label="Filter institutions"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Filter accounts"]')).not.toBeNull();
    expect(container.textContent).toContain("All institutions");
  });

  it("uses the month picker to navigate without stale dates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => { root = createRoot(container!); root.render(controls); });
    const input = container.querySelector<HTMLInputElement>('input[type="month"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2026-07");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(push).toHaveBeenCalledOnce();
    const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("month")).toBe("2026-07");
    expect(params.has("startDate")).toBe(false);
    expect(params.get("accounts")).toBe("Everyday");
  });

  it("announces month updates without adding a visible item to the controls row", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => { finishNavigation = resolve; });
    push.mockImplementationOnce(() => navigation);
    await act(async () => { root = createRoot(container!); root.render(controls); });
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.classList.contains("sr-only")).toBe(true);
    expect(status!.textContent).toBe("");
    const childCount = container.firstElementChild!.children.length;

    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-label="Next month"]')!.click(); });
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status!.classList.contains("sr-only")).toBe(true);
    expect(status!.textContent).toBe("Updating…");
    expect(container.firstElementChild!.children.length).toBe(childCount);
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector<HTMLInputElement>('input[type="month"]')!.disabled).toBe(true);
    expect(new URL(push.mock.calls[0][0], "http://localhost").searchParams.get("month")).toBe("2026-02");

    await act(async () => { finishNavigation(); await navigation; });
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status!.textContent).toBe("");
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("false");
  });

  it("changes account scope while retaining month and other filters", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => { root = createRoot(container!); root.render(<MonthlyControls month="2026-11" filters={fixture.filters} institutions={["Example Bank"]} accounts={["Everyday", "Savings"]} />); });
    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-label="Filter accounts"]')!.click(); });
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent?.includes("Savings"))!;
    expect(option).toBeDefined();
    await act(async () => { option.click(); });
    const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("accounts")).toBe("Everyday,Savings");
    expect(params.get("month")).toBe("2026-11");
    expect(params.get("institutions")).toBe("Example Bank");
    expect(params.get("search")).toBe("sample");
  });
});
