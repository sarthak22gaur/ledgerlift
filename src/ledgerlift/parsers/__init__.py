"""Statement parsers for different financial institutions."""

from ledgerlift.parsers.amex_credit_csv import AmexCreditCSVParser
from ledgerlift.parsers.base import BaseParser
from ledgerlift.parsers.capital_one_credit_pdf import CapitalOneCreditPDFParser
from ledgerlift.parsers.chase_checking_pdf import ChaseCheckingPDFParser
from ledgerlift.parsers.chase_credit_pdf import ChaseCreditPDFParser
from ledgerlift.parsers.deserve_credit_pdf import DeserveCreditPDFParser
from ledgerlift.parsers.sofi_pdf import SoFiPDFParser
from ledgerlift.parsers.wealthfront_cash_pdf import WealthfrontCashPDFParser
from ledgerlift.parsers.wealthfront_greendot_pdf import WealthfrontGreenDotPDFParser

# Registry of available parsers, keyed by (institution, account_type)
PARSER_REGISTRY: dict[tuple[str, str], type[BaseParser]] = {
    ("chase", "checking"): ChaseCheckingPDFParser,
    ("chase", "credit"): ChaseCreditPDFParser,
    ("capitalone", "credit"): CapitalOneCreditPDFParser,
    ("amex", "credit"): AmexCreditCSVParser,
    ("wealthfront", "cash"): WealthfrontCashPDFParser,
    ("wealthfront", "cash_greendot"): WealthfrontGreenDotPDFParser,
    ("sofi", "bank"): SoFiPDFParser,
    ("deserve", "credit"): DeserveCreditPDFParser,
}


def get_parser(institution: str, account_name: str) -> BaseParser:
    """Get the appropriate parser for a given institution and account type."""
    key = (institution.lower(), account_name.lower())
    parser_cls = PARSER_REGISTRY.get(key)
    if parser_cls is None:
        raise ValueError(
            f"No parser registered for institution={institution}, account={account_name}. "
            f"Available: {list(PARSER_REGISTRY.keys())}"
        )
    return parser_cls()
