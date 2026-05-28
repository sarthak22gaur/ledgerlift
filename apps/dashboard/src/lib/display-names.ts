// Human-friendly display names for institutions and accounts.

const INSTITUTION_NAMES: Record<string, string> = {
  chase: "Chase",
  amex: "American Express",
  capitalone: "Capital One",
  sofi: "SoFi",
  wealthfront: "Wealthfront",
  deserve: "Deserve",
};

const ACCOUNT_NAMES: Record<string, string> = {
  checking: "Checking",
  credit: "Credit Card",
  bank: "Bank Account",
  cash: "Cash Account",
  cash_greendot: "Cash (Green Dot)",
  savings: "Savings",
};

const ACCOUNT_TYPE_NAMES: Record<string, string> = {
  checking: "Checking",
  credit: "Credit Card",
  bank: "Bank",
  cash: "Cash",
  cash_greendot: "Cash",
  savings: "Savings",
};

export function formatInstitution(raw: string): string {
  return INSTITUTION_NAMES[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatAccountName(raw: string): string {
  return ACCOUNT_NAMES[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatAccountType(raw: string): string {
  return ACCOUNT_TYPE_NAMES[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}
