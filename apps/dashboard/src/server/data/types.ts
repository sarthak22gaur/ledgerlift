export type Transaction = {
  transaction_id: string;
  source_file_hash: string;
  institution: string;
  account_name: string;
  account_type: string;
  statement_start_date: string; // DATE stored as ISO string
  statement_end_date: string;
  transaction_date: string;
  posted_date: string;
  description_raw: string;
  description_normalized: string;
  amount: number; // negative = debit (money out), positive = credit (money in)
  currency: string;
  direction: "debit" | "credit";
  transaction_type:
    | "purchase"
    | "ach"
    | "fee"
    | "interest"
    | "check"
    | "transfer"
    | "atm"
    | "deposit"
    | "withdrawal"
    | "payment"
    | "unknown";
  category_raw: string | null;
  category_normalized: string | null;
  subcategory_normalized: string | null;
  merchant_normalized: string | null;
  merchant_confidence: number | null;
  merchant_rule_id: string | null;
  category_confidence: number | null;
  category_rule_id: string | null;
  reference_number: string | null;
  is_transfer_candidate: boolean;
  is_internal_payment_candidate: boolean;
  transfer_pair_id: string | null;
  transfer_match_confidence: number | null;
  parser_name: string;
  parser_version: string;
  import_timestamp: string; // TIMESTAMP as ISO string
  enriched_at: string | null;
};

export type Account = {
  id: string;
  institution: string;
  account_name: string;
  account_type: string;
  first_seen: string;
  last_seen: string;
  transaction_count: number;
};

export type Institution = {
  name: string;
  account_count: number;
  transaction_count: number;
  first_seen: string;
  last_seen: string;
};

export type OverviewMetrics = {
  totalIncome: number;
  totalExpenses: number;
  netCashflow: number;
  uncategorizedSpend: number;
  transactionCount: number;
  transferPairCount: number;
  transferAmount: number;
};

export type CashflowSeries = {
  month: string; // e.g. "2025-01"
  income: number;
  expenses: number;
  net: number;
};

export type CategoryBreakdown = {
  category: string;
  amount: number;
  count: number;
  percentage: number;
};

export type MonthlySpendingRow = {
  category: string | null;
  amount: number;
  count: number;
  importedCount: number;
  latestDate: string | null;
};

export type MonthlyCategory = CategoryBreakdown & {
  comparisonAmount: number;
  previousAmount: number | null;
  previousDifference: number | null;
  previousPercent: number | null;
  threeMonthAverage: number | null;
  isNew: boolean;
};

export type MonthlyOverview = {
  month: string;
  startDate: string;
  endDate: string;
  filters: FilterParams;
  latestImportedDate: string | null;
  selectedLatestDate: string | null;
  transactionCount: number;
  comparisonDay: number | null;
  comparisonEndDate: string;
  categorySpending: number;
  categories: MonthlyCategory[];
  merchants: MerchantSummary[];
  metrics: OverviewMetrics;
};

export type MerchantSummary = {
  merchant: string;
  amount: number;
  count: number;
  category: string | null;
};

export type TransferPair = {
  transfer_pair_id: string;
  confidence: number;
  date1: string;
  date2: string;
  amount: number;
  account1: string;
  account2: string;
  description1: string;
  description2: string;
  direction1: "debit" | "credit";
  direction2: "debit" | "credit";
  is_internal_payment: boolean;
};

export type FilterParams = {
  startDate?: string;
  endDate?: string;
  institutions?: string[];
  accounts?: string[];
  categories?: string[];
  merchants?: string[];
  direction?: "debit" | "credit";
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  uncategorizedOnly?: boolean;
  transferCandidatesOnly?: boolean;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type CalendarYearPoint = { year: string; value: number };

export type CalendarMonthPoint = { month: string; value: number };

export type CalendarDayPoint = { date: string; value: number; txn_count: number };

export type DayOfWeekPoint = {
  dow: string;
  value: number;
  txn_count: number;
  avg_value: number;
};

export type SeasonPoint = {
  season: "Winter" | "Spring" | "Summer" | "Autumn";
  value: number;
  txn_count: number;
};

export type MonthOfYearPoint = { month: string; value: number; txn_count: number };
