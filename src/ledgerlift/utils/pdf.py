"""PDF text extraction utilities."""

from __future__ import annotations

import logging
from pathlib import Path

import pdfplumber

logger = logging.getLogger(__name__)


def extract_text_pages(pdf_path: Path) -> list[str]:
    """Extract text from each page of a PDF, returning a list of page texts."""
    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append(text)
            if not text.strip():
                logger.warning("Page %d of %s yielded no text", i + 1, pdf_path.name)
    return pages


def extract_full_text(pdf_path: Path) -> str:
    """Extract all text from a PDF as a single string."""
    pages = extract_text_pages(pdf_path)
    return "\n\n--- PAGE BREAK ---\n\n".join(pages)
