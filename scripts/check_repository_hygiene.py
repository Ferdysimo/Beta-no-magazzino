"""Fail when sensitive runtime files or high-confidence secrets are tracked."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_NAMES = {
    ".env",
    "credentials.json",
    "google_credentials.json",
    "service-account.json",
    "service_account.json",
    "token.json",
}
FORBIDDEN_SUFFIXES = {".key", ".pem", ".p12", ".pfx"}
FORBIDDEN_DIRECTORIES = {"uploads"}

SECRET_PATTERNS = {
    "private key": re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
    ),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "OpenAI-style key": re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
}


def tracked_files() -> list[PurePosixPath]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [
        PurePosixPath(item.decode("utf-8"))
        for item in result.stdout.split(b"\0")
        if item
    ]


def forbidden_path_reason(path: PurePosixPath) -> str | None:
    lowered_parts = tuple(part.lower() for part in path.parts)
    name = path.name.lower()

    if any(part in FORBIDDEN_DIRECTORIES for part in lowered_parts[:-1]):
        return "runtime upload directory"
    if name == ".env" or name.startswith(".env."):
        return "environment file"
    if name in FORBIDDEN_NAMES or name.endswith(".credentials.json"):
        return "credential file"
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        return "private key or certificate container"
    return None


def scan_text(path: PurePosixPath) -> list[str]:
    absolute_path = ROOT.joinpath(*path.parts)
    try:
        content = absolute_path.read_bytes()
    except OSError as exc:
        return [f"cannot read tracked file ({exc})"]

    if b"\0" in content:
        return []

    text = content.decode("utf-8", errors="ignore")
    findings = []
    for label, pattern in SECRET_PATTERNS.items():
        match = pattern.search(text)
        if match:
            line = text.count("\n", 0, match.start()) + 1
            findings.append(f"{label} at line {line}")
    return findings


def main() -> int:
    violations: list[str] = []
    files = tracked_files()

    for path in files:
        reason = forbidden_path_reason(path)
        if reason:
            violations.append(f"{path}: tracked {reason}")
            continue
        for finding in scan_text(path):
            violations.append(f"{path}: {finding}")

    if violations:
        print("Repository hygiene check failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1

    print(f"Repository hygiene check passed ({len(files)} tracked files scanned).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
