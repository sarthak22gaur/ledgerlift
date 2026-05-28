CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
    file_hash                   TEXT PRIMARY KEY,
    relative_path               TEXT NOT NULL,
    institution                 TEXT NOT NULL,
    account_name                TEXT NOT NULL,
    parse_status                TEXT NOT NULL DEFAULT 'pending',
    parse_error                 TEXT,
    parsed_at                   TEXT,
    enrich_status               TEXT NOT NULL DEFAULT 'pending',
    enriched_at                 TEXT,
    enriched_transaction_count  INTEGER,
    unresolved_merchant_count   INTEGER,
    unresolved_category_count   INTEGER,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statements (
    id                  TEXT PRIMARY KEY,
    source_file_hash    TEXT NOT NULL REFERENCES source_files(file_hash) ON DELETE CASCADE,
    institution         TEXT NOT NULL,
    account_name        TEXT NOT NULL,
    account_type        TEXT NOT NULL,
    statement_start_date TEXT,
    statement_end_date  TEXT,
    beginning_balance   REAL,
    ending_balance      REAL,
    total_credits       REAL,
    total_debits        REAL,
    parser_name         TEXT NOT NULL,
    parser_version      TEXT NOT NULL,
    imported_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raw_transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id    TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    line_number     INTEGER,
    raw_text        TEXT,
    posted_date     TEXT,
    transaction_date TEXT,
    description     TEXT,
    amount          REAL,
    direction       TEXT,
    category_raw    TEXT,
    reference_number TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id                  TEXT PRIMARY KEY,
    source_file_hash                TEXT NOT NULL REFERENCES source_files(file_hash) ON DELETE CASCADE,
    statement_id                    TEXT REFERENCES statements(id) ON DELETE CASCADE,
    institution                     TEXT NOT NULL,
    account_name                    TEXT NOT NULL,
    account_type                    TEXT NOT NULL,
    statement_start_date            TEXT,
    statement_end_date              TEXT,
    transaction_date                TEXT NOT NULL,
    posted_date                     TEXT,
    description_raw                 TEXT NOT NULL,
    description_normalized          TEXT NOT NULL,
    amount                          REAL NOT NULL,
    currency                        TEXT NOT NULL DEFAULT 'USD',
    direction                       TEXT NOT NULL,
    transaction_type                TEXT NOT NULL DEFAULT 'unknown',
    category_raw                    TEXT,
    category_normalized             TEXT,
    subcategory_normalized          TEXT,
    merchant_normalized             TEXT,
    merchant_confidence             REAL,
    merchant_rule_id                TEXT,
    category_confidence             REAL,
    category_rule_id                TEXT,
    reference_number                TEXT,
    is_transfer_candidate           INTEGER NOT NULL DEFAULT 0,
    is_internal_payment_candidate   INTEGER NOT NULL DEFAULT 0,
    transfer_pair_id                TEXT,
    transfer_match_confidence       REAL,
    parser_name                     TEXT NOT NULL,
    parser_version                  TEXT NOT NULL,
    import_timestamp                TEXT NOT NULL,
    enriched_at                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_txn_date
    ON transactions(transaction_date);

CREATE INDEX IF NOT EXISTS idx_txn_institution_account
    ON transactions(institution, account_name);

CREATE INDEX IF NOT EXISTS idx_txn_category
    ON transactions(category_normalized);

CREATE INDEX IF NOT EXISTS idx_txn_merchant
    ON transactions(merchant_normalized);

CREATE INDEX IF NOT EXISTS idx_txn_pair
    ON transactions(transfer_pair_id);

CREATE TABLE IF NOT EXISTS merchant_rules (
    rule_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    id                TEXT NOT NULL,
    priority          INTEGER NOT NULL,
    match_type        TEXT NOT NULL,
    match_pattern     TEXT NOT NULL,
    canonical_merchant TEXT NOT NULL,
    category          TEXT,
    subcategory       TEXT,
    source            TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('base', 'user'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_rules_label ON merchant_rules(id);
CREATE INDEX IF NOT EXISTS idx_merchant_rules_priority ON merchant_rules(priority DESC);

CREATE TABLE IF NOT EXISTS category_rules (
    rule_id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    id                      TEXT NOT NULL,
    priority                INTEGER NOT NULL,
    when_merchant_normalized TEXT,
    when_description_regex  TEXT,
    when_transaction_type   TEXT,
    when_direction          TEXT,
    when_institution        TEXT,
    when_account_name       TEXT,
    assign_category         TEXT NOT NULL,
    assign_subcategory      TEXT,
    assign_confidence       REAL,
    source                  TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('base', 'user'))
);

CREATE INDEX IF NOT EXISTS idx_category_rules_label ON category_rules(id);
CREATE INDEX IF NOT EXISTS idx_category_rules_priority ON category_rules(priority DESC);

CREATE TABLE IF NOT EXISTS merchant_overrides (
    id             TEXT PRIMARY KEY,
    pattern        TEXT,
    transaction_id TEXT,
    merchant       TEXT,
    category       TEXT,
    subcategory    TEXT
);

CREATE TABLE IF NOT EXISTS category_overrides (
    id             TEXT PRIMARY KEY,
    pattern        TEXT,
    transaction_id TEXT,
    merchant       TEXT,
    category       TEXT,
    subcategory    TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    last4        TEXT,
    institution  TEXT NOT NULL,
    account_name TEXT NOT NULL,
    opened_date  TEXT,
    closed_date  TEXT,
    UNIQUE(institution, account_name, last4)
);

CREATE TABLE IF NOT EXISTS internal_counterparties (
    name TEXT PRIMARY KEY
);
