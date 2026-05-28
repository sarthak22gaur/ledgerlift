import { z } from "zod";

export const filterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  institutions: z.array(z.string()).optional(),
  accounts: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  merchants: z.array(z.string()).optional(),
  direction: z.enum(["debit", "credit"]).optional(),
  minAmount: z.coerce.number().nonnegative().optional(),
  maxAmount: z.coerce.number().nonnegative().optional(),
  search: z.string().optional(),
  uncategorizedOnly: z.coerce.boolean().optional(),
  transferCandidatesOnly: z.coerce.boolean().optional(),
});

export type FilterSchemaType = z.infer<typeof filterSchema>;

// Regex patterns in rule files are evaluated by Python's `re` module at
// pipeline runtime, not by JS. Python re supports constructs JS RegExp doesn't
// (look-behind anchors, named groups, possessive quantifiers, etc.). The
// dashboard accepts any string for regex fields; mistakes surface when the
// pipeline runs `ledgerlift enrich`.

export const merchantRuleEntrySchema = z.object({
  rule_id: z.number().int().optional(),
  id: z.string().min(1),
  priority: z.number().int(),
  match: z.object({
    type: z.enum(["regex", "contains", "prefix", "exact"]),
    pattern: z.string().min(1),
  }),
  canonical_merchant: z.string().min(1),
  category: z.string().optional(),
  subcategory: z.string().optional(),
});

export type MerchantRuleEntry = z.infer<typeof merchantRuleEntrySchema>;


export const categoryRuleEntrySchema = z.object({
  rule_id: z.number().int().optional(),
  id: z.string().min(1),
  priority: z.number().int(),
  when: z.object({
    merchant_normalized: z.array(z.string()).optional(),
    description_regex: z.string().optional(),
    transaction_type: z.array(z.string()).optional(),
    direction: z.enum(["debit", "credit"]).optional(),
    institution: z.string().optional(),
    account_name: z.string().optional(),
  }),
  assign: z.object({
    category: z.string().min(1),
    subcategory: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  }),
});

export type CategoryRuleEntry = z.infer<typeof categoryRuleEntrySchema>;


const overrideEntryBaseSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().optional(),
  transaction_id: z.string().optional(),
  merchant: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
});

export const overrideEntrySchema = overrideEntryBaseSchema
  .refine(
    (d) => d.pattern !== undefined || d.transaction_id !== undefined,
    { message: "Override requires at least one of: pattern, transaction_id" }
  )
  .refine(
    (d) => d.merchant !== undefined || d.category !== undefined || d.subcategory !== undefined,
    { message: "Override requires at least one of: merchant, category, subcategory" }
  );

export type OverrideEntry = z.infer<typeof overrideEntrySchema>;


export const accountMappingEntrySchema = z.object({
  last4: z.string().optional(),
  institution: z.string().min(1),
  account: z.string().min(1),
  opened_date: z.string().optional(),
  closed_date: z.string().optional(),
});

export type AccountMappingEntry = z.infer<typeof accountMappingEntrySchema>;


export const transactionSchema = z.object({
  transaction_id: z.string(),
  source_file_hash: z.string(),
  institution: z.string(),
  account_name: z.string(),
  account_type: z.string(),
  statement_start_date: z.string(),
  statement_end_date: z.string(),
  transaction_date: z.string(),
  posted_date: z.string(),
  description_raw: z.string(),
  description_normalized: z.string(),
  amount: z.number(),
  currency: z.string(),
  direction: z.enum(["debit", "credit"]),
  transaction_type: z.enum([
    "purchase",
    "ach",
    "fee",
    "interest",
    "check",
    "transfer",
    "atm",
    "deposit",
    "withdrawal",
    "payment",
    "unknown",
  ]),
  category_raw: z.string().nullable(),
  category_normalized: z.string().nullable(),
  subcategory_normalized: z.string().nullable(),
  merchant_normalized: z.string().nullable(),
  merchant_confidence: z.number().nullable(),
  merchant_rule_id: z.string().nullable(),
  category_confidence: z.number().nullable(),
  category_rule_id: z.string().nullable(),
  reference_number: z.string().nullable(),
  is_transfer_candidate: z.boolean(),
  is_internal_payment_candidate: z.boolean(),
  parser_name: z.string(),
  parser_version: z.string(),
  import_timestamp: z.string(),
  enriched_at: z.string().nullable(),
});
