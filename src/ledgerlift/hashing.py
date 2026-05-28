"""File hashing utilities for content-based identity."""

import hashlib
from pathlib import Path

HASH_ALGORITHM = "sha256"
CHUNK_SIZE = 8192


def hash_file(path: Path) -> str:
    """Compute SHA-256 hash of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK_SIZE):
            h.update(chunk)
    return h.hexdigest()


def hash_bytes(data: bytes) -> str:
    """Compute SHA-256 hash of raw bytes."""
    return hashlib.sha256(data).hexdigest()
