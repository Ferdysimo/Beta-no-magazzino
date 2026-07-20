#!/usr/bin/env python3
"""Read-only external smoke checks for the P0-B production deployment."""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def request(method, url, headers=None, data=None, timeout=8):
    req = urllib.request.Request(
        url,
        method=method,
        headers=headers or {},
        data=data,
    )
    try:
        with OPENER.open(req, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def websocket_status(host, path, origin, timeout=8):
    context = ssl.create_default_context()
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    payload = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Origin: {origin}\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode("ascii")

    with socket.create_connection((host, 443), timeout=timeout) as raw:
        with context.wrap_socket(raw, server_hostname=host) as secure:
            secure.settimeout(timeout)
            secure.sendall(payload)
            first_line = secure.recv(4096).split(b"\r\n", 1)[0]
    parts = first_line.decode("ascii", errors="replace").split()
    return int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0


def certificate_days_left(host, timeout=8):
    context = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=timeout) as raw:
        with context.wrap_socket(raw, server_hostname=host) as secure:
            cert = secure.getpeercert()
    expires = datetime.strptime(
        cert["notAfter"], "%b %d %H:%M:%S %Y %Z"
    ).replace(tzinfo=timezone.utc)
    return (expires - datetime.now(timezone.utc)).days


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="pasta-app.it")
    parser.add_argument("--ip", default="51.91.125.232")
    parser.add_argument("--expected-commit")
    args = parser.parse_args()

    https = f"https://{args.host}"
    results = []

    def check(name, passed, detail):
        results.append((passed, name, detail))

    status, _, _ = request("GET", f"{https}/api/")
    check("HTTPS API", status == 200, f"HTTP {status}")

    status, headers, _ = request("GET", f"http://{args.host}/")
    location = headers.get("Location", "")
    check(
        "HTTP redirect",
        status in (301, 302, 307, 308) and location.startswith(https),
        f"HTTP {status}, Location={location or '-'}",
    )

    for path in ("/docs", "/redoc", "/openapi.json"):
        status, _, _ = request("GET", f"{https}{path}")
        check(f"Hidden {path}", status in (403, 404), f"HTTP {status}")

    status, _, _ = request("GET", f"{https}/api/restaurants")
    check(
        "Public restaurant route removed",
        status in (401, 403, 404, 405),
        f"HTTP {status}",
    )

    status, _, _ = request(
        "POST",
        f"{https}/api/ws-ticket",
        headers={"Content-Type": "application/json"},
        data=b"{}",
    )
    check(
        "WebSocket ticket requires auth",
        status in (401, 403),
        f"HTTP {status}",
    )

    status, headers, _ = request(
        "OPTIONS",
        f"{https}/api/",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    allow_origin = headers.get("Access-Control-Allow-Origin", "")
    check(
        "CORS rejects foreign origin",
        allow_origin != "https://evil.example",
        f"HTTP {status}, allow-origin={allow_origin or '-'}",
    )

    try:
        status, _, _ = request("GET", f"http://{args.ip}/")
        direct_ip_ok = status != 200
        direct_ip_detail = f"HTTP {status}"
    except (OSError, urllib.error.URLError) as exc:
        direct_ip_ok = True
        direct_ip_detail = type(exc).__name__
    check("Direct IP does not serve app", direct_ip_ok, direct_ip_detail)

    try:
        with socket.create_connection((args.ip, 8001), timeout=4):
            port_closed = False
            port_detail = "connection accepted"
    except OSError as exc:
        port_closed = True
        port_detail = type(exc).__name__
    check("Port 8001 closed externally", port_closed, port_detail)

    try:
        ws_status = websocket_status(
            args.host,
            "/api/ws/preflight-nonexistent-tenant",
            f"https://{args.host}",
        )
        check(
            "Anonymous WebSocket rejected",
            ws_status != 101,
            f"HTTP {ws_status}",
        )
    except OSError as exc:
        check("Anonymous WebSocket rejected", True, type(exc).__name__)

    try:
        days = certificate_days_left(args.host)
        check("TLS certificate lifetime", days >= 14, f"{days} days left")
    except (OSError, KeyError, ValueError) as exc:
        check("TLS certificate lifetime", False, type(exc).__name__)

    if args.expected_commit:
        try:
            status, _, body = request("GET", f"{https}/api/version")
            payload = json.loads(body.decode("utf-8"))
            current = str(payload.get("git_commit", ""))
            expected = args.expected_commit
            check(
                "Release commit",
                status == 200
                and bool(current)
                and (
                    expected.startswith(current)
                    or current.startswith(expected)
                ),
                f"HTTP {status}, live={current or '-'}, expected={expected}",
            )
        except (UnicodeDecodeError, json.JSONDecodeError):
            check("Release commit", False, "invalid /api/ response")

    for passed, name, detail in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}: {detail}")

    failures = sum(not passed for passed, _, _ in results)
    print(f"\n{len(results) - failures}/{len(results)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
