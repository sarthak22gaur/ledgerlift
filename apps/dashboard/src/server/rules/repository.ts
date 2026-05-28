import { query } from "@/server/data/db";
import type {
  MerchantRuleEntry,
  CategoryRuleEntry,
  OverrideEntry,
  AccountMappingEntry,
} from "@/lib/schemas";

async function markEnrichmentDirty(): Promise<void> {
  await query(
    "INSERT OR REPLACE INTO pipeline_meta(key, value) VALUES('enrichment_dirty', '1')"
  );
}

export type MerchantRuleWithSource = MerchantRuleEntry & { rule_id: number; source: "base" | "user" };

type MerchantRuleRow = {
  rule_id: number;
  id: string;
  priority: number;
  match_type: string;
  match_pattern: string;
  canonical_merchant: string;
  category: string | null;
  subcategory: string | null;
  source: string;
};

function rowToMerchantRule(row: MerchantRuleRow): MerchantRuleWithSource {
  return {
    rule_id: row.rule_id,
    id: row.id,
    priority: row.priority,
    match: {
      type: row.match_type as MerchantRuleEntry["match"]["type"],
      pattern: row.match_pattern,
    },
    canonical_merchant: row.canonical_merchant,
    ...(row.category != null ? { category: row.category } : {}),
    ...(row.subcategory != null ? { subcategory: row.subcategory } : {}),
    source: (row.source === "user" ? "user" : "base") as "base" | "user",
  };
}

export async function listMerchantRules(): Promise<MerchantRuleWithSource[]> {
  const rows = await query<MerchantRuleRow>(
    `SELECT rule_id, id, priority, match_type, match_pattern, canonical_merchant, category, subcategory, source
     FROM merchant_rules
     ORDER BY priority DESC, rule_id ASC`
  );
  return rows.map(rowToMerchantRule);
}

export async function insertMerchantRule(entry: MerchantRuleEntry): Promise<MerchantRuleWithSource[]> {
  await query(
    `INSERT INTO merchant_rules(id, priority, match_type, match_pattern, canonical_merchant, category, subcategory, source)
     VALUES(?, ?, ?, ?, ?, ?, ?, 'user')`,
    [
      entry.id,
      entry.priority,
      entry.match.type,
      entry.match.pattern,
      entry.canonical_merchant,
      entry.category ?? null,
      entry.subcategory ?? null,
    ]
  );
  await markEnrichmentDirty();
  return listMerchantRules();
}

export async function updateMerchantRule(ruleId: number, entry: MerchantRuleEntry): Promise<MerchantRuleWithSource[]> {
  await query(
    `UPDATE merchant_rules
     SET id = ?, priority = ?, match_type = ?, match_pattern = ?,
         canonical_merchant = ?, category = ?, subcategory = ?
     WHERE rule_id = ? AND source = 'user'`,
    [
      entry.id,
      entry.priority,
      entry.match.type,
      entry.match.pattern,
      entry.canonical_merchant,
      entry.category ?? null,
      entry.subcategory ?? null,
      ruleId,
    ]
  );
  await markEnrichmentDirty();
  return listMerchantRules();
}

export async function deleteMerchantRule(ruleId: number): Promise<{ deleted: boolean; rules: MerchantRuleWithSource[] }> {
  const before = await query<{ rule_id: number }>(
    "SELECT rule_id FROM merchant_rules WHERE rule_id = ? AND source = 'user'",
    [ruleId]
  );
  if (before.length === 0) {
    return { deleted: false, rules: await listMerchantRules() };
  }
  await query("DELETE FROM merchant_rules WHERE rule_id = ? AND source = 'user'", [ruleId]);
  await markEnrichmentDirty();
  return { deleted: true, rules: await listMerchantRules() };
}

export type CategoryRuleWithSource = CategoryRuleEntry & { rule_id: number; source: "base" | "user" };

type CategoryRuleRow = {
  rule_id: number;
  id: string;
  priority: number;
  when_merchant_normalized: string | null;
  when_description_regex: string | null;
  when_transaction_type: string | null;
  when_direction: string | null;
  when_institution: string | null;
  when_account_name: string | null;
  assign_category: string;
  assign_subcategory: string | null;
  assign_confidence: number | null;
  source: string;
};

function safeParseJsonArray(raw: string | null): string[] | undefined {
  if (raw == null) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    return undefined;
  } catch (e) {
    console.warn("[rules/repository] Invalid JSON in category rule column:", raw, e);
    return undefined;
  }
}

function rowToCategoryRule(row: CategoryRuleRow): CategoryRuleWithSource {
  const merchantNorm = safeParseJsonArray(row.when_merchant_normalized);
  const txnType = safeParseJsonArray(row.when_transaction_type);

  const when: CategoryRuleEntry["when"] = {};
  if (merchantNorm !== undefined) when.merchant_normalized = merchantNorm;
  if (row.when_description_regex != null) when.description_regex = row.when_description_regex;
  if (txnType !== undefined) when.transaction_type = txnType;
  if (row.when_direction != null) when.direction = row.when_direction as "debit" | "credit";
  if (row.when_institution != null) when.institution = row.when_institution;
  if (row.when_account_name != null) when.account_name = row.when_account_name;

  const assign: CategoryRuleEntry["assign"] = {
    category: row.assign_category,
    ...(row.assign_subcategory != null ? { subcategory: row.assign_subcategory } : {}),
    ...(row.assign_confidence != null ? { confidence: row.assign_confidence } : {}),
  };

  return {
    rule_id: row.rule_id,
    id: row.id,
    priority: row.priority,
    when,
    assign,
    source: (row.source === "user" ? "user" : "base") as "base" | "user",
  };
}

export async function listCategoryRules(): Promise<CategoryRuleWithSource[]> {
  const rows = await query<CategoryRuleRow>(
    `SELECT rule_id, id, priority, when_merchant_normalized, when_description_regex,
            when_transaction_type, when_direction, when_institution, when_account_name,
            assign_category, assign_subcategory, assign_confidence, source
     FROM category_rules
     ORDER BY priority DESC, rule_id ASC`
  );
  return rows.map(rowToCategoryRule);
}

export async function insertCategoryRule(entry: CategoryRuleEntry): Promise<CategoryRuleWithSource[]> {
  const when = entry.when;
  const assign = entry.assign;

  await query(
    `INSERT INTO category_rules(id, priority, when_merchant_normalized, when_description_regex,
       when_transaction_type, when_direction, when_institution, when_account_name,
       assign_category, assign_subcategory, assign_confidence, source)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')`,
    [
      entry.id,
      entry.priority,
      when.merchant_normalized != null ? JSON.stringify(when.merchant_normalized) : null,
      when.description_regex ?? null,
      when.transaction_type != null ? JSON.stringify(when.transaction_type) : null,
      when.direction ?? null,
      when.institution ?? null,
      when.account_name ?? null,
      assign.category,
      assign.subcategory ?? null,
      assign.confidence ?? null,
    ]
  );
  await markEnrichmentDirty();
  return listCategoryRules();
}

export async function updateCategoryRule(ruleId: number, entry: CategoryRuleEntry): Promise<CategoryRuleWithSource[]> {
  const when = entry.when;
  const assign = entry.assign;

  await query(
    `UPDATE category_rules
     SET id = ?, priority = ?, when_merchant_normalized = ?, when_description_regex = ?,
         when_transaction_type = ?, when_direction = ?, when_institution = ?,
         when_account_name = ?, assign_category = ?, assign_subcategory = ?, assign_confidence = ?
     WHERE rule_id = ? AND source = 'user'`,
    [
      entry.id,
      entry.priority,
      when.merchant_normalized != null ? JSON.stringify(when.merchant_normalized) : null,
      when.description_regex ?? null,
      when.transaction_type != null ? JSON.stringify(when.transaction_type) : null,
      when.direction ?? null,
      when.institution ?? null,
      when.account_name ?? null,
      assign.category,
      assign.subcategory ?? null,
      assign.confidence ?? null,
      ruleId,
    ]
  );
  await markEnrichmentDirty();
  return listCategoryRules();
}

export async function deleteCategoryRule(ruleId: number): Promise<{ deleted: boolean; rules: CategoryRuleWithSource[] }> {
  const before = await query<{ rule_id: number }>(
    "SELECT rule_id FROM category_rules WHERE rule_id = ? AND source = 'user'",
    [ruleId]
  );
  if (before.length === 0) {
    return { deleted: false, rules: await listCategoryRules() };
  }
  await query("DELETE FROM category_rules WHERE rule_id = ? AND source = 'user'", [ruleId]);
  await markEnrichmentDirty();
  return { deleted: true, rules: await listCategoryRules() };
}

type OverrideRow = {
  id: string;
  pattern: string | null;
  transaction_id: string | null;
  merchant: string | null;
  category: string | null;
  subcategory: string | null;
};

function rowToOverride(row: OverrideRow): OverrideEntry {
  const entry: Record<string, string | undefined> = { id: row.id };
  if (row.pattern != null) entry.pattern = row.pattern;
  if (row.transaction_id != null) entry.transaction_id = row.transaction_id;
  if (row.merchant != null) entry.merchant = row.merchant;
  if (row.category != null) entry.category = row.category;
  if (row.subcategory != null) entry.subcategory = row.subcategory;
  return entry as OverrideEntry;
}

export async function listMerchantOverrides(): Promise<OverrideEntry[]> {
  const rows = await query<OverrideRow>(
    "SELECT id, pattern, transaction_id, merchant, category, subcategory FROM merchant_overrides ORDER BY id ASC"
  );
  return rows.map(rowToOverride);
}

export async function upsertMerchantOverride(entry: OverrideEntry): Promise<OverrideEntry[]> {
  await query(
    `INSERT INTO merchant_overrides(id, pattern, transaction_id, merchant, category, subcategory)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pattern = excluded.pattern,
       transaction_id = excluded.transaction_id,
       merchant = excluded.merchant,
       category = excluded.category,
       subcategory = excluded.subcategory`,
    [
      entry.id,
      entry.pattern ?? null,
      entry.transaction_id ?? null,
      entry.merchant ?? null,
      entry.category ?? null,
      entry.subcategory ?? null,
    ]
  );
  await markEnrichmentDirty();
  return listMerchantOverrides();
}

export async function deleteMerchantOverride(id: string): Promise<OverrideEntry[]> {
  await query("DELETE FROM merchant_overrides WHERE id = ?", [id]);
  await markEnrichmentDirty();
  return listMerchantOverrides();
}

export async function listCategoryOverrides(): Promise<OverrideEntry[]> {
  const rows = await query<OverrideRow>(
    "SELECT id, pattern, transaction_id, merchant, category, subcategory FROM category_overrides ORDER BY id ASC"
  );
  return rows.map(rowToOverride);
}

export async function upsertCategoryOverride(entry: OverrideEntry): Promise<OverrideEntry[]> {
  await query(
    `INSERT INTO category_overrides(id, pattern, transaction_id, merchant, category, subcategory)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pattern = excluded.pattern,
       transaction_id = excluded.transaction_id,
       merchant = excluded.merchant,
       category = excluded.category,
       subcategory = excluded.subcategory`,
    [
      entry.id,
      entry.pattern ?? null,
      entry.transaction_id ?? null,
      entry.merchant ?? null,
      entry.category ?? null,
      entry.subcategory ?? null,
    ]
  );
  await markEnrichmentDirty();
  return listCategoryOverrides();
}

export async function deleteCategoryOverride(id: string): Promise<OverrideEntry[]> {
  await query("DELETE FROM category_overrides WHERE id = ?", [id]);
  await markEnrichmentDirty();
  return listCategoryOverrides();
}

type AccountRow = {
  id: number;
  last4: string | null;
  institution: string;
  account_name: string;
  opened_date: string | null;
  closed_date: string | null;
};

function rowToAccount(row: AccountRow): AccountMappingEntry & { _db_id: number } {
  const entry: AccountMappingEntry & { _db_id: number } = {
    _db_id: row.id,
    institution: row.institution,
    account: row.account_name,
  };
  if (row.last4 != null) entry.last4 = row.last4;
  if (row.opened_date != null) entry.opened_date = row.opened_date;
  if (row.closed_date != null) entry.closed_date = row.closed_date;
  return entry;
}

export async function listAccounts(): Promise<AccountMappingEntry[]> {
  const rows = await query<AccountRow>(
    "SELECT id, last4, institution, account_name, opened_date, closed_date FROM accounts ORDER BY institution ASC, account_name ASC"
  );
  return rows.map((r) => {
    const { _db_id: _unused, ...entry } = rowToAccount(r);
    void _unused;
    return entry;
  });
}

export async function upsertAccount(entry: AccountMappingEntry): Promise<AccountMappingEntry[]> {
  await query(
    `INSERT INTO accounts(last4, institution, account_name, opened_date, closed_date)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(institution, account_name, last4) DO UPDATE SET
       opened_date = excluded.opened_date,
       closed_date = excluded.closed_date`,
    [
      entry.last4 ?? null,
      entry.institution,
      entry.account,
      entry.opened_date ?? null,
      entry.closed_date ?? null,
    ]
  );
  await markEnrichmentDirty();
  return listAccounts();
}

export async function deleteAccount(institution: string, account: string, last4?: string): Promise<AccountMappingEntry[]> {
  await query(
    "DELETE FROM accounts WHERE institution = ? AND account_name = ? AND last4 IS ?",
    [institution, account, last4 ?? null]
  );
  await markEnrichmentDirty();
  return listAccounts();
}

export async function listCounterparties(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    "SELECT name FROM internal_counterparties ORDER BY name ASC"
  );
  return rows.map((r) => r.name);
}

export async function upsertCounterparty(name: string): Promise<string[]> {
  await query(
    "INSERT OR IGNORE INTO internal_counterparties(name) VALUES(?)",
    [name]
  );
  await markEnrichmentDirty();
  return listCounterparties();
}

export async function deleteCounterparty(name: string): Promise<string[]> {
  await query("DELETE FROM internal_counterparties WHERE name = ?", [name]);
  await markEnrichmentDirty();
  return listCounterparties();
}
