// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CategorizationReviewList from "@/app/review/categorization/review-list";
import CategorizationPage from "@/app/review/categorization/page";
import type { CategorizationReviewRow } from "@/server/data/types";

const { push, refresh, getCategorizationReview, getFilterOptions, canShare, currentParams } = vi.hoisted(() => ({
  push: vi.fn(), refresh: vi.fn(), getCategorizationReview: vi.fn(), getFilterOptions: vi.fn(), canShare: vi.fn(),
  currentParams: { value: "institutions=Example+Bank&accounts=Everyday&search=sample&categories=Shopping" },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/review/categorization", useSearchParams: () => new URLSearchParams(currentParams.value) }));
vi.mock("@/components/layout/app-shell", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/server/auth/can-share", () => ({ canShare }));
vi.mock("@/server/data/repository", () => ({ getCategorizationReview, getFilterOptions }));

function transaction(id: string): CategorizationReviewRow {
  return {
    transaction_id: id, source_file_hash: "synthetic", institution: "Example Bank", account_name: "Everyday", account_type: "checking",
    statement_start_date: "2026-10-01", statement_end_date: "2026-10-31", transaction_date: "2026-10-12", posted_date: "2026-10-13",
    description_raw: "SYNTHETIC SAMPLE RETAIL", description_normalized: "Sample retail", amount: -200, currency: "CAD", direction: "debit", transaction_type: "purchase",
    category_raw: null, category_normalized: "Shopping", subcategory_normalized: "Household", merchant_normalized: "Sample Retail", merchant_confidence: 0.9, merchant_rule_id: "sample-retail",
    category_confidence: 0.9, category_rule_id: "merchant:sample-retail", reference_number: null, is_transfer_candidate: false, is_internal_payment_candidate: false,
    transfer_pair_id: null, transfer_match_confidence: null, parser_name: "synthetic", parser_version: "1", import_timestamp: "2026-10-14", enriched_at: "2026-10-14",
    reviewReasons: [{ kind: "mixed-retailer", label: "Mixed retailer" }, { kind: "unusual-amount", label: "Unusually large amount", baseline: "merchant", ratio: 4, median: 50, sampleCount: 5, currency: "CAD" }],
  };
}
const first = transaction("synthetic:shopping/one:complete-id");
const second = transaction("synthetic:shopping/two:complete-id");
const props = { transactions: [first, second], total: 2, page: 1, pageSize: 50, categories: ["Shopping", "Groceries"], canEdit: true };

describe("categorization review", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    canShare.mockResolvedValue(true);
    getFilterOptions.mockResolvedValue({ institutions: ["Example Bank"], categories: ["Shopping"], accounts: ["Everyday"], merchants: [] });
    getCategorizationReview.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 });
    currentParams.value = "institutions=Example+Bank&accounts=Everyday&search=sample&categories=Shopping";
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  async function mount(element = <CategorizationReviewList {...props} />) {
    await act(async () => { root = createRoot(container); root.render(element); });
  }
  function button(text: string, within: ParentNode = container) {
    return [...within.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent === text)!;
  }
  async function setInput(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps same-category confirmations independent and permits another save before enrichment", async () => {
    let finishFirst!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    const cards = [...container.querySelectorAll("article")];
    const status = cards[0].querySelector('[aria-live="polite"]')!;
    await act(async () => { button("Confirm category", cards[0]).click(); });
    expect(cards[0].querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(cards[0].querySelector('[aria-live="polite"]')).toBe(status);
    expect(status.classList.contains("min-h-5")).toBe(true);
    expect(button("Confirm category", cards[1]).disabled).toBe(false);
    await act(async () => { button("Confirm category", cards[1]).click(); });
    expect(container.querySelectorAll("article")).toHaveLength(1);
    await act(async () => { finishFirst(new Response("{}")); await firstSave; });
    const bodies = fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies).toEqual([first, second].map((txn) => ({ id: `category-review:${txn.transaction_id}`, transaction_id: txn.transaction_id, category: "Shopping", subcategory: "Household" })));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("continue reviewing");
    expect(container.textContent).toContain("ledgerlift enrich --force");
  });

  it("keeps a failed save visible and retries with the same exact override ID", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("error", { status: 500 })).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await act(async () => { button("Confirm category").click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("try again");
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { button("Confirm category").click(); });
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).toBe(`category-review:${first.transaction_id}`);
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });

  it("changes only the selected transaction and omits a cleared subcategory", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await act(async () => { button("Change category").click(); });
    const inputs = container.querySelectorAll<HTMLInputElement>("article input");
    await setInput(inputs[0], "Groceries");
    await setInput(inputs[1], "");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetch.mock.calls[0][0]).toBe("/api/rules/category-overrides");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id: `category-review:${first.transaction_id}`, transaction_id: first.transaction_id, category: "Groceries" });
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });

  it("shows every reason, currency, provenance and details without interpreting confidence as error probability", async () => {
    await mount();
    const card = container.querySelector("article")!;
    expect(card.textContent).toContain("CAD 200.00");
    expect(card.textContent).toContain("Mixed retailer");
    expect(card.textContent).toContain("4.0× the merchant median of CAD 50.00 across 5 other imported transactions");
    expect(card.textContent).toContain("merchant:sample-retail");
    expect(card.textContent).toContain("0.9 · not a probability of error");
    expect(card.querySelector("details")?.textContent).toContain("SYNTHETIC SAMPLE RETAIL");
    expect(card.querySelector("details")?.textContent).toContain(first.transaction_id);
  });

  it("hides all write controls for shared sessions and hydrates without browser-derived state", async () => {
    const element = <CategorizationReviewList {...props} canEdit={false} />;
    container.innerHTML = renderToString(element);
    const errors: unknown[] = [];
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) }); });
    expect(errors).toEqual([]);
    expect(container.textContent).toContain("Read-only shared view");
    expect(button("Confirm category")).toBeUndefined();
    expect(button("Change category")).toBeUndefined();
    expect(container.querySelector("form")).toBeNull();
  });

  it("preserves active URL filters in 50-row pagination", async () => {
    await mount(<CategorizationReviewList {...props} total={105} page={2} />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav a')];
    expect(links).toHaveLength(2);
    for (const [index, link] of links.entries()) {
      const params = new URL(link.href).searchParams;
      expect(params.get("page")).toBe(index === 0 ? "1" : "3");
      expect(params.get("accounts")).toBe("Everyday");
      expect(params.get("institutions")).toBe("Example Bank");
      expect(params.get("search")).toBe("sample");
      expect(params.get("categories")).toBe("Shopping");
    }
    expect(container.textContent).toContain("up to 50 per page");
  });

  it("uses standard validated URL filters, rejects invalid page numbers and resets page when searching", async () => {
    currentParams.value = "search=sample&page=2&accounts=Everyday";
    const page = await CategorizationPage({ searchParams: Promise.resolve({ search: "sample", accounts: "Everyday", page: "1.5" }) });
    expect(getCategorizationReview).toHaveBeenCalledWith({ search: "sample", accounts: ["Everyday"] }, 1, 50);
    await mount(page);
    const search = container.querySelector<HTMLInputElement>('input[placeholder="Search..."]')!;
    await setInput(search, "another sample");
    await act(async () => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("search")).toBe("another sample");
    expect(params.get("accounts")).toBe("Everyday");
    expect(params.has("page")).toBe(false);
  });

  it("distinguishes an empty review from a failed ledger read and passes share auth to write controls", async () => {
    canShare.mockResolvedValue(false);
    const empty = renderToStaticMarkup(await CategorizationPage({ searchParams: Promise.resolve({}) }));
    expect(empty).toContain("No transactions to review in this view");
    expect(empty).toContain("Read-only shared view");
    expect(empty).not.toContain('role="alert"');
    getCategorizationReview.mockRejectedValueOnce(new Error("synthetic database unavailable"));
    const error = renderToStaticMarkup(await CategorizationPage({ searchParams: Promise.resolve({}) }));
    expect(error).toContain('role="alert"');
    expect(error).toContain("Categorization review could not be loaded");
    expect(error).not.toContain("No transactions to review");
  });
});
