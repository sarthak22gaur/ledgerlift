"""Project configuration and path constants."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
EXPORTS_DIR = DATA_DIR / "exports"
STATE_DIR = DATA_DIR / "state"
LOGS_DIR = DATA_DIR / "logs"

RULES_DIR = DATA_DIR / "rules"
MERCHANT_RULES_BASE_PATH = RULES_DIR / "merchants.base.yaml"
CATEGORY_RULES_BASE_PATH = RULES_DIR / "categories.base.yaml"

SUPPORTED_SOURCES: dict[str, list[str]] = {
    "chase": ["checking", "credit"],
    "capitalone": ["credit"],
    "amex": ["credit"],
    "wealthfront": ["cash", "cash_greendot"],
    "sofi": ["bank"],
    "deserve": ["credit"],
}

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def ensure_dirs() -> None:
    """Create all required data directories if they don't exist."""
    for institution, accounts in SUPPORTED_SOURCES.items():
        for account in accounts:
            (RAW_DIR / institution / account).mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    RULES_DIR.mkdir(parents=True, exist_ok=True)
