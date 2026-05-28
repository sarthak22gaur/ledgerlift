import { query } from "@/server/data/db";
import { CopyButton } from "./copy-button";

const CMD = "ledgerlift enrich --force";

export default async function PendingRerunBanner() {
  let isDirty = false;
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM pipeline_meta WHERE key = 'enrichment_dirty' LIMIT 1"
    );
    isDirty = rows.length > 0 && rows[0].value === "1";
  } catch (e) {
    // If the DB isn't reachable yet, suppress the banner rather than crash.
    console.warn("[PendingRerunBanner] Failed to read pipeline_meta:", e);
  }

  if (!isDirty) return null;

  return (
    <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
      <span>
        Rules changed. Run{" "}
        <code className="rounded bg-amber-100 dark:bg-amber-900/60 px-1 font-mono text-xs">{CMD}</code>{" "}
        to apply them.
      </span>
      <CopyButton text={CMD} />
    </div>
  );
}
