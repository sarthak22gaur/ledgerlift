"""Base parser interface for financial statement parsers.

To add support for a new institution or account type:

1. Create a new module in ``src/ledgerlift/parsers/`` (e.g., ``mybank_checking_pdf.py``).
2. Subclass :class:`BaseParser` and implement :attr:`name`, :attr:`version`, and :meth:`parse`.
3. Register the parser in ``parsers/__init__.py`` ``PARSER_REGISTRY`` with the key
   ``(institution, account_name)`` (e.g., ``("mybank", "checking")``).
4. Add the institution/account to ``config.py`` ``SUPPORTED_SOURCES``.
5. Optionally add intake auto-detection in ``intake.py`` (filename pattern or content sniffing).

See ``chase_checking_pdf.py`` (PDF) or ``amex_credit_csv.py`` (CSV) for reference
implementations.
"""

from __future__ import annotations

import abc
from pathlib import Path

from ledgerlift.models import ParsedStatement


class BaseParser(abc.ABC):
    """Abstract base class for statement parsers.

    Every parser must define a unique ``name``, a ``version`` string (bump it when
    parsing logic changes so already-parsed files can be detected as stale), and a
    ``parse()`` method that extracts structured data from a statement file.

    The ``parse()`` method receives the file path and its SHA-256 hash (used for
    deduplication) and must return a :class:`ParsedStatement` containing metadata,
    raw transactions, and the extracted text.

    PDF parsers typically use ``pdfplumber`` (via ``utils.pdf.extract_text_pages``)
    then regex to extract transaction lines. CSV parsers read rows directly.
    """

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Unique identifier for this parser (e.g., ``chase_checking_pdf``)."""
        ...

    @property
    @abc.abstractmethod
    def version(self) -> str:
        """Semver-style version string. Bump when parsing logic changes."""
        ...

    @abc.abstractmethod
    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        """Parse a statement file and return structured data.

        Args:
            pdf_path: Path to the statement file (PDF or CSV).
            file_hash: SHA-256 hash of the file contents, used for deduplication.

        Returns:
            A :class:`ParsedStatement` with extracted metadata, a list of
            :class:`RawTransaction` objects, the full extracted text, and any
            warnings encountered during parsing.

        Raises:
            ParseError: If the file cannot be parsed (missing text, wrong format, etc.).
        """
        ...


class ParseError(Exception):
    """Raised when a parser encounters an unrecoverable error."""
