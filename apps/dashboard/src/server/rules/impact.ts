import { query } from "@/server/data/db";

export type ImpactRow = {
  description_raw: string;
  transaction_date: string;
  amount: number;
  institution: string;
};

export type RuleImpact = {
  count: number;
  sample: ImpactRow[];
};

export async function getMerchantRuleImpact(ruleId: string): Promise<RuleImpact> {
  const countRows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE merchant_rule_id = ?",
    [ruleId]
  );
  const count = Number(countRows[0]?.n ?? 0);

  const sample = await query<ImpactRow>(
    `SELECT description_raw, transaction_date, amount, institution
     FROM transactions
     WHERE merchant_rule_id = ?
     ORDER BY transaction_date DESC
     LIMIT 5`,
    [ruleId]
  );

  return { count, sample };
}

export async function getCategoryRuleImpact(ruleId: string): Promise<RuleImpact> {
  const countRows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE category_rule_id = ?",
    [ruleId]
  );
  const count = Number(countRows[0]?.n ?? 0);

  const sample = await query<ImpactRow>(
    `SELECT description_raw, transaction_date, amount, institution
     FROM transactions
     WHERE category_rule_id = ?
     ORDER BY transaction_date DESC
     LIMIT 5`,
    [ruleId]
  );

  return { count, sample };
}
