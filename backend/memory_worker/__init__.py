"""Isolated operational-memory worker.

This package must never be imported by the operational FastAPI application.
"""

from .contracts import MEMORY_SCHEMA_VERSION


__all__ = ["MEMORY_SCHEMA_VERSION"]
