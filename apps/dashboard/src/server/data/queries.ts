import type { FilterParams } from "./types";

type QueryParts = { sql: string; params: unknown[] };

// Exclusion predicates for transfer-related double-counting.
//
// There are TWO different "internal" concepts and they get applied to
// different queries:
//
//   1) NOT_INTERNAL_FLOW (loose): exclude only flows that are *demonstrably*
//      internal — matched pair IDs and intra-institution sweeps. This is the
//      right filter for total cashflow / income / expenses, because category-
//      based exclusion drops real flows like Zelle to other people, Coinbase
//      buys, ATM cash withdrawals, and unmatched CC payments (e.g. pre-2024
//      Deserve where the card-side data doesn't exist).
//
//   2) NOT_DOUBLE_COUNTED (strict): also drops anything categorized 'Transfers'
//      or 'Credit Card Payment'. This is the right filter for category and
//      merchant breakdown queries — you don't want a "Transfers" slice on the
//      spending pie chart even when the entries are real external flows.

// Matched-pair logic: a transfer_pair_id means BOTH sides represent the same
// movement of money between two tracked accounts. Whether CC payment or generic
// transfer, that money never left the user's network — exclude both sides from
// income/expense. (The older "keep debit" behavior only made sense when one of
// the two accounts was untracked, which is the unpaired case anyway.)
const NOT_TRANSFER_PAIR = `(transfer_pair_id IS NULL)`;
// One-sided internal sweeps (Wealthfront cash <-> greendot etc.) where only
// one leg is recorded in statements. They can never pair but aren't real flows.
const NOT_INTERNAL_SWEEP = `(subcategory_normalized IS NULL OR subcategory_normalized != 'Internal Sweep')`;
// Strict category fallback (keeps "Transfers" off the spending pie).
const NOT_EXCLUDED_CATEGORY = `(category_normalized IS NULL OR category_normalized NOT IN ('Transfers', 'Credit Card Payment'))`;
// Unpaired card-side payment credits are bookkeeping reversals, not income.
// Keep the matching debit-side case counted as expense when no card statement
// exists, but do not let an orphan positive card payment inflate income.
const NOT_UNPAIRED_CC_PAYMENT_CREDIT = `NOT (category_normalized = 'Credit Card Payment' AND amount > 0 AND transfer_pair_id IS NULL)`;

// Reimbursement (category='Reimbursement'): bill-split / settle-up flows with
// roommates, spouse, sublet, etc. They're real cashflow (NOT internal pool), but
// inbound legs aren't "income" — they're offsets of expenses you already paid.
// Treatment:
//   - Inbound (amount > 0): SUBTRACTED from expenses, NOT added to income.
//   - Outbound (amount < 0): counted as a normal expense AND surfaces on the
//     Category Breakdown / Top Merchants views as its own category.
// Net cashflow = income - expenses still equals raw sum(amount), just split
// across buckets in a way that reflects "money I actually spent out-of-pocket".
const REIMBURSEMENT_IN_AMOUNT = `CASE WHEN amount > 0 AND category_normalized = 'Reimbursement' THEN amount ELSE 0 END`;
// NULL-safe: in SQL, `NULL = 'X'` is NULL, and NULL AND TRUE is NULL, and
// `NOT NULL` is NULL — which is falsy in CASE WHEN. Compare against COALESCE'd
// value so rows with category_normalized=NULL still survive.
const NOT_REIMBURSEMENT_IN = `NOT (COALESCE(category_normalized, '') = 'Reimbursement' AND amount > 0)`;

// Loose: only drop what's PROVABLY internal. Use for total cashflow.
const NOT_INTERNAL_FLOW = `(${NOT_TRANSFER_PAIR} AND ${NOT_INTERNAL_SWEEP})`;
// Strict: also drop category-Transfers / Credit Card Payment. Use for
// per-category and per-merchant breakdowns where the category itself isn't
// a meaningful axis.
const NOT_DOUBLE_COUNTED = `(${NOT_INTERNAL_FLOW} AND ${NOT_EXCLUDED_CATEGORY})`;

export function buildWhereClause(filters: FilterParams): {
  clause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.startDate) {
    conditions.push("transaction_date >= ?");
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push("transaction_date <= ?");
    params.push(filters.endDate);
  }

  if (filters.institutions?.length) {
    const placeholders = filters.institutions.map(() => "?").join(", ");
    conditions.push(`institution IN (${placeholders})`);
    params.push(...filters.institutions);
  }

  if (filters.accounts?.length) {
    const placeholders = filters.accounts.map(() => "?").join(", ");
    conditions.push(`account_name IN (${placeholders})`);
    params.push(...filters.accounts);
  }

  if (filters.categories?.length) {
    const placeholders = filters.categories.map(() => "?").join(", ");
    conditions.push(`category_normalized IN (${placeholders})`);
    params.push(...filters.categories);
  }

  if (filters.merchants?.length) {
    const placeholders = filters.merchants.map(() => "?").join(", ");
    conditions.push(`merchant_normalized IN (${placeholders})`);
    params.push(...filters.merchants);
  }

  if (filters.direction) {
    conditions.push("direction = ?");
    params.push(filters.direction);
  }

  if (filters.minAmount != null) {
    conditions.push("ABS(amount) >= ?");
    params.push(filters.minAmount);
  }

  if (filters.maxAmount != null) {
    conditions.push("ABS(amount) <= ?");
    params.push(filters.maxAmount);
  }

  if (filters.search) {
    conditions.push(
      "(LOWER(description_raw) LIKE LOWER(?) OR LOWER(description_normalized) LIKE LOWER(?) OR LOWER(merchant_normalized) LIKE LOWER(?))"
    );
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }

  if (filters.uncategorizedOnly) {
    conditions.push(
      "(category_normalized IS NULL OR category_normalized = 'Uncategorized')"
    );
  }

  if (filters.transferCandidatesOnly) {
    conditions.push(
      "(is_transfer_candidate = 1 OR is_internal_payment_candidate = 1)"
    );
  }

  const clause =
    conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  return { clause, params };
}

export function overviewMetricsQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const { clause: clause2, params: params2 } = buildWhereClause(filters);
  // Use the loose predicate: only drop provably-internal flows (matched pairs +
  // sweeps). Category-based exclusion would over-drop Zelle to people, Coinbase,
  // unmatched CC payments, etc. which are real external flows.
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const incomeExpression = `CASE WHEN amount > 0 AND ${NOT_UNPAIRED_CC_PAYMENT_CREDIT} AND ${NOT_REIMBURSEMENT_IN} THEN amount ELSE 0 END`;
  const expensesExpression = `SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) - SUM(${REIMBURSEMENT_IN_AMOUNT})`;
  const baseCondition = clause2 || "";
  const sql = `
    WITH net AS (
      SELECT
        COALESCE(SUM(${incomeExpression}), 0) AS "totalIncome",
        COALESCE(${expensesExpression}, 0) AS "totalExpenses",
        COALESCE(SUM(${incomeExpression}), 0)
          - COALESCE(${expensesExpression}, 0) AS "netCashflow",
        COALESCE(SUM(CASE WHEN amount < 0 AND (category_normalized IS NULL OR category_normalized = 'Uncategorized') THEN ABS(amount) ELSE 0 END), 0) AS "uncategorizedSpend",
        COUNT(*) AS "transactionCount"
      FROM transactions
      ${realCondition}
    ),
    transfers AS (
      SELECT
        COUNT(*) AS "transferPairCount",
        COALESCE(SUM(abs_amount), 0) AS "transferAmount"
      FROM (
        SELECT
          transfer_pair_id,
          ABS(amount) AS abs_amount,
          ROW_NUMBER() OVER (PARTITION BY transfer_pair_id ORDER BY direction DESC, transaction_date) AS rn,
          COUNT(*) OVER (PARTITION BY transfer_pair_id) AS pair_row_count
        FROM transactions
        ${baseCondition} ${baseCondition ? "AND" : "WHERE"} transfer_pair_id IS NOT NULL
      ) transfer_legs
      WHERE rn = 1 AND pair_row_count >= 2
    )
    SELECT net.*, transfers."transferPairCount", transfers."transferAmount"
    FROM net, transfers
  `;
  return { sql, params: [...params, ...params2] };
}

export function cashflowSeriesQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  // Same loose predicate as overviewMetricsQuery — monthly cashflow should reflect
  // actual money in/out, not be deflated by blanket category exclusion.
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const incomeExpression = `CASE WHEN amount > 0 AND ${NOT_UNPAIRED_CC_PAYMENT_CREDIT} AND ${NOT_REIMBURSEMENT_IN} THEN amount ELSE 0 END`;
  const expensesExpression = `SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) - SUM(${REIMBURSEMENT_IN_AMOUNT})`;
  const sql = `
    SELECT
      strftime('%Y-%m', transaction_date) AS month,
      COALESCE(SUM(${incomeExpression}), 0) AS income,
      COALESCE(${expensesExpression}, 0) AS expenses,
      COALESCE(SUM(${incomeExpression}), 0)
        - COALESCE(${expensesExpression}, 0) AS net
    FROM transactions
    ${realCondition}
    GROUP BY month
    ORDER BY month
  `;
  return { sql, params };
}

export function categoryBreakdownQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  // Expenses only, excluding transfers & CC payments
  const expenseCondition = clause
    ? `${clause} AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`
    : `WHERE amount < 0 AND ${NOT_DOUBLE_COUNTED}`;

  const sql = `
    WITH cats AS (
      SELECT
        COALESCE(category_normalized, 'Uncategorized') AS category,
        SUM(ABS(amount)) AS amount,
        COUNT(*) AS count
      FROM transactions
      ${expenseCondition}
      GROUP BY COALESCE(category_normalized, 'Uncategorized')
    ),
    total AS (
      SELECT SUM(amount) AS total_amount FROM cats
    )
    SELECT
      c.category,
      c.amount,
      c.count,
      CASE WHEN t.total_amount > 0 THEN ROUND(c.amount / t.total_amount * 100, 2) ELSE 0 END AS percentage
    FROM cats c, total t
    ORDER BY c.amount DESC
  `;
  return { sql, params };
}

export function topMerchantsQuery(
  filters: FilterParams,
  limit: number = 10
): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  const merchantCondition = clause
    ? `${clause} AND merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`
    : `WHERE merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`;

  const sql = `
    SELECT
      merchant_normalized AS merchant,
      SUM(ABS(amount)) AS amount,
      COUNT(*) AS count,
      (SELECT t2.category_normalized FROM transactions t2 WHERE t2.merchant_normalized = transactions.merchant_normalized GROUP BY t2.category_normalized ORDER BY COUNT(*) DESC LIMIT 1) AS category
    FROM transactions
    ${merchantCondition}
    GROUP BY merchant_normalized
    ORDER BY amount DESC
    LIMIT ?
  `;
  params.push(limit);
  return { sql, params };
}

export function allMerchantsQuery(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50,
  sortBy: string = "amount",
  sortDir: "asc" | "desc" = "desc"
): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  const merchantCondition = clause
    ? `${clause} AND merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`
    : `WHERE merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`;

  const allowedSort = new Set(["merchant", "amount", "count", "category"]);
  const safeSort = allowedSort.has(sortBy) ? sortBy : "amount";
  const safeDir = sortDir === "asc" ? "ASC" : "DESC";
  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT
      merchant_normalized AS merchant,
      SUM(ABS(amount)) AS amount,
      COUNT(*) AS count,
      (SELECT t2.category_normalized FROM transactions t2 WHERE t2.merchant_normalized = transactions.merchant_normalized GROUP BY t2.category_normalized ORDER BY COUNT(*) DESC LIMIT 1) AS category
    FROM transactions
    ${merchantCondition}
    GROUP BY merchant_normalized
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `;
  params.push(pageSize, offset);
  return { sql, params };
}

export function allMerchantsCountQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  const merchantCondition = clause
    ? `${clause} AND merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`
    : `WHERE merchant_normalized IS NOT NULL AND amount < 0 AND ${NOT_DOUBLE_COUNTED}`;

  const sql = `
    SELECT COUNT(DISTINCT merchant_normalized) AS total
    FROM transactions
    ${merchantCondition}
  `;
  return { sql, params };
}

export function transactionsQuery(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50,
  sortBy: string = "transaction_date",
  sortDir: "asc" | "desc" = "desc"
): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  const allowedSort = new Set([
    "transaction_date",
    "posted_date",
    "amount",
    "description_normalized",
    "merchant_normalized",
    "category_normalized",
    "institution",
    "account_name",
  ]);
  const safeSort = allowedSort.has(sortBy) ? sortBy : "transaction_date";
  const safeDir = sortDir === "asc" ? "ASC" : "DESC";
  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT * FROM transactions
    ${clause}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `;
  params.push(pageSize, offset);

  return { sql, params };
}

export function transactionsCountQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const sql = `SELECT COUNT(*) AS total FROM transactions ${clause}`;
  return { sql, params };
}

export function transactionByIdQuery(id: string): QueryParts {
  return {
    sql: "SELECT * FROM transactions WHERE transaction_id = ?",
    params: [id],
  };
}

export function categoryDetailQuery(
  category: string,
  filters: FilterParams
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const categoryCondition = clause
    ? `${clause} AND category_normalized = ?`
    : "WHERE category_normalized = ?";
  params.push(category);

  const sql = `
    SELECT * FROM transactions
    ${categoryCondition}
    ORDER BY transaction_date DESC
  `;
  return { sql, params };
}

export function merchantDetailQuery(
  merchant: string,
  filters: FilterParams
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const merchantCondition = clause
    ? `${clause} AND merchant_normalized = ?`
    : "WHERE merchant_normalized = ?";
  params.push(merchant);

  const sql = `
    SELECT * FROM transactions
    ${merchantCondition}
    ORDER BY transaction_date DESC
  `;
  return { sql, params };
}

export function unresolvedTransactionsQuery(
  filters: FilterParams
): QueryParts {
  const combined: FilterParams = { ...filters, uncategorizedOnly: true };
  const { clause, params } = buildWhereClause(combined);

  const sql = `
    SELECT * FROM transactions
    ${clause}
    ORDER BY transaction_date DESC
  `;
  return { sql, params };
}

export function transferCandidatesQuery(filters: FilterParams): QueryParts {
  const combined: FilterParams = { ...filters, transferCandidatesOnly: true };
  const { clause, params } = buildWhereClause(combined);
  // Only show candidates not yet paired — those are the ones worth reviewing.
  const where = clause
    ? `${clause} AND transfer_pair_id IS NULL`
    : "WHERE transfer_pair_id IS NULL";

  const sql = `
    SELECT * FROM transactions
    ${where}
    ORDER BY transaction_date DESC
  `;
  return { sql, params };
}

export function transferPairsQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const baseCondition = clause || "";
  const andOrWhere = baseCondition ? `${baseCondition} AND` : "WHERE";

  const sql = `
    WITH paired AS (
      SELECT
        transfer_pair_id,
        transfer_match_confidence,
        transaction_date,
        ABS(amount) AS abs_amount,
        institution || '/' || account_name AS account,
        description_normalized,
        direction,
        is_internal_payment_candidate,
        ROW_NUMBER() OVER (PARTITION BY transfer_pair_id ORDER BY direction DESC, transaction_date) AS rn
      FROM transactions
      ${andOrWhere} transfer_pair_id IS NOT NULL
    )
    SELECT
      a.transfer_pair_id,
      a.transfer_match_confidence AS confidence,
      a.transaction_date AS date1,
      b.transaction_date AS date2,
      a.abs_amount AS amount,
      a.account AS account1,
      b.account AS account2,
      a.description_normalized AS description1,
      b.description_normalized AS description2,
      a.direction AS direction1,
      b.direction AS direction2,
      CASE WHEN a.is_internal_payment_candidate = 1 OR b.is_internal_payment_candidate = 1 THEN 1 ELSE 0 END AS is_internal_payment
    FROM paired a
    JOIN paired b ON a.transfer_pair_id = b.transfer_pair_id AND a.rn = 1 AND b.rn = 2
    ORDER BY a.transaction_date DESC
  `;
  return { sql, params };
}

type ImpactKind = "merchant" | "category" | "merchant-override" | "category-override";

export function ruleImpactQuery(kind: ImpactKind, ruleId: string): QueryParts {
  let col: string;
  let labelExpr: string;
  let params: unknown[];

  if (kind === "merchant") {
    col = "merchant_rule_id";
    labelExpr = "?";
    params = [ruleId];
  } else if (kind === "category") {
    col = "category_rule_id";
    labelExpr = "?";
    params = [ruleId];
  } else if (kind === "merchant-override") {
    col = "merchant_rule_id";
    labelExpr = "'override:' || ?";
    params = [ruleId];
  } else {
    col = "category_rule_id";
    labelExpr = "'override:' || ?";
    params = [ruleId];
  }

  const sql = `
    SELECT
      COUNT(*) AS count,
      (
        SELECT json_group_array(json_object(
          'description_raw', description_raw,
          'transaction_date', transaction_date,
          'amount', amount,
          'institution', institution
        ))
        FROM (
          SELECT description_raw, transaction_date, amount, institution
          FROM transactions
          WHERE ${col} = ${labelExpr}
          ORDER BY transaction_date DESC
          LIMIT 5
        )
      ) AS sample_json
    FROM transactions
    WHERE ${col} = ${labelExpr}
  `;
  return { sql, params: [...params, ...params] };
}

type CalendarMetric = "expenses" | "net";

function metricExpressions(metric: CalendarMetric): { valueExpr: string } {
  const incomeExpression = `CASE WHEN amount > 0 AND ${NOT_UNPAIRED_CC_PAYMENT_CREDIT} AND ${NOT_REIMBURSEMENT_IN} THEN amount ELSE 0 END`;
  const expensesExpression = `SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) - SUM(${REIMBURSEMENT_IN_AMOUNT})`;
  const valueExpr =
    metric === "net"
      ? `COALESCE(SUM(${incomeExpression}), 0) - COALESCE(${expensesExpression}, 0)`
      : `COALESCE(${expensesExpression}, 0)`;
  return { valueExpr };
}

export function calendarYearSeriesQuery(
  filters: FilterParams,
  metric: CalendarMetric
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      strftime('%Y', transaction_date) AS year,
      ${valueExpr} AS value
    FROM transactions
    ${realCondition}
    GROUP BY strftime('%Y', transaction_date)
    ORDER BY year
  `;
  return { sql, params };
}

export function calendarMonthSeriesQuery(
  filters: FilterParams,
  metric: CalendarMetric,
  year: string
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW} AND strftime('%Y', transaction_date) = ?`
    : `WHERE ${NOT_INTERNAL_FLOW} AND strftime('%Y', transaction_date) = ?`;
  params.push(year);
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      strftime('%m', transaction_date) AS month,
      ${valueExpr} AS value
    FROM transactions
    ${realCondition}
    GROUP BY strftime('%m', transaction_date)
    ORDER BY month
  `;
  return { sql, params };
}

export function calendarYearHeatmapQuery(
  filters: FilterParams,
  metric: CalendarMetric,
  year: string
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW} AND strftime('%Y', transaction_date) = ?`
    : `WHERE ${NOT_INTERNAL_FLOW} AND strftime('%Y', transaction_date) = ?`;
  params.push(year);
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      transaction_date AS date,
      ${valueExpr} AS value,
      COUNT(*) AS txn_count
    FROM transactions
    ${realCondition}
    GROUP BY transaction_date
    ORDER BY date
  `;
  return { sql, params };
}

export function calendarDayHeatmapQuery(
  filters: FilterParams,
  metric: CalendarMetric,
  year: string,
  month: string
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const yearMonth = `${year}-${month}`;
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW} AND strftime('%Y-%m', transaction_date) = ?`
    : `WHERE ${NOT_INTERNAL_FLOW} AND strftime('%Y-%m', transaction_date) = ?`;
  params.push(yearMonth);
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      transaction_date AS date,
      ${valueExpr} AS value,
      COUNT(*) AS txn_count
    FROM transactions
    ${realCondition}
    GROUP BY transaction_date
    ORDER BY date
  `;
  return { sql, params };
}

export function dayOfWeekSeriesQuery(
  filters: FilterParams,
  metric: CalendarMetric
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      strftime('%w', transaction_date) AS dow,
      ${valueExpr} AS value,
      COUNT(*) AS txn_count,
      CAST(${valueExpr} AS REAL) / NULLIF(COUNT(DISTINCT transaction_date), 0) AS avg_value  /* re-expands valueExpr: SQLite forbids referencing a SELECT-list alias in a sibling SELECT expression */
    FROM transactions
    ${realCondition}
    GROUP BY strftime('%w', transaction_date)
    ORDER BY dow
  `;
  return { sql, params };
}

export function seasonSeriesQuery(
  filters: FilterParams,
  metric: CalendarMetric
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const { valueExpr } = metricExpressions(metric);
  // Meteorological seasons, northern hemisphere
  const seasonExpr = `CASE strftime('%m', transaction_date)
    WHEN '12' THEN 'Winter' WHEN '01' THEN 'Winter' WHEN '02' THEN 'Winter'
    WHEN '03' THEN 'Spring' WHEN '04' THEN 'Spring' WHEN '05' THEN 'Spring'
    WHEN '06' THEN 'Summer' WHEN '07' THEN 'Summer' WHEN '08' THEN 'Summer'
    ELSE 'Autumn'
  END`;
  const sql = `
    SELECT
      ${seasonExpr} AS season,
      ${valueExpr} AS value,
      COUNT(*) AS txn_count
    FROM transactions
    ${realCondition}
    GROUP BY ${seasonExpr}
    ORDER BY season
  `;
  return { sql, params };
}

export function monthOfYearSeriesQuery(
  filters: FilterParams,
  metric: CalendarMetric
): QueryParts {
  const { clause, params } = buildWhereClause(filters);
  const realCondition = clause
    ? `${clause} AND ${NOT_INTERNAL_FLOW}`
    : `WHERE ${NOT_INTERNAL_FLOW}`;
  const { valueExpr } = metricExpressions(metric);
  const sql = `
    SELECT
      strftime('%m', transaction_date) AS month,
      ${valueExpr} AS value,
      COUNT(*) AS txn_count
    FROM transactions
    ${realCondition}
    GROUP BY strftime('%m', transaction_date)
    ORDER BY month
  `;
  return { sql, params };
}

export function accountSummaryQuery(filters: FilterParams): QueryParts {
  const { clause, params } = buildWhereClause(filters);

  // Accounts are derived from the transactions table directly — there is no
  // separate dashboard-facing "accounts summary" table after the SQLite
  // migration. Same income/expense exclusion rules as before:
  //   - Drop matched transfer pairs (transfer_pair_id IS NOT NULL).
  //   - Drop Internal Sweep subcategory rows (intra-institution one-leg moves).
  //   - Credit-card accounts: also drop category in ('Credit Card Payment',
  //     'Transfers') — those are payments to/from your bank, not real flows.
  //   - Reimbursement inbound legs net against expenses (offset of real
  //     out-of-pocket spend), not income.
  const sql = `
    SELECT
      institution || '/' || account_name AS id,
      institution,
      account_name,
      account_type,
      MIN(transaction_date) AS first_seen,
      MAX(transaction_date) AS last_seen,
      COUNT(*) AS transaction_count,
      COALESCE(SUM(CASE
        WHEN amount > 0
         AND transfer_pair_id IS NULL
         AND (subcategory_normalized IS NULL OR subcategory_normalized != 'Internal Sweep')
         AND NOT (COALESCE(category_normalized, '') = 'Reimbursement' AND amount > 0)
         AND (account_type != 'credit' OR
              category_normalized IS NULL OR
              category_normalized NOT IN ('Credit Card Payment', 'Transfers'))
        THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(
        SUM(CASE
          WHEN amount < 0
           AND transfer_pair_id IS NULL
           AND (subcategory_normalized IS NULL OR subcategory_normalized != 'Internal Sweep')
           AND (account_type != 'credit' OR
                category_normalized IS NULL OR
                category_normalized NOT IN ('Credit Card Payment', 'Transfers'))
          THEN ABS(amount) ELSE 0 END)
        - SUM(CASE
          WHEN amount > 0
           AND category_normalized = 'Reimbursement'
           AND transfer_pair_id IS NULL
          THEN amount ELSE 0 END)
      , 0) AS total_expenses
    FROM transactions
    ${clause}
    GROUP BY institution, account_name, account_type
    ORDER BY institution, account_name
  `;
  return { sql, params };
}
