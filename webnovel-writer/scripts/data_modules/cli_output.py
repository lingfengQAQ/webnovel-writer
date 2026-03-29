#!/usr/bin/env python3
"""
CLI output helpers for data_modules.

All CLI tools should emit JSON payloads via these helpers.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class ErrorPayload:
    code: str
    message: str
    suggestion: str | None = None
    details: dict[str, Any] | None = None


def build_success(data: Any = None, message: str = "ok", warnings: list | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "success",
        "message": message,
    }
    if data is not None:
        payload["data"] = data
    if warnings:
        payload["warnings"] = warnings
    return payload


def build_error(
    code: str,
    message: str,
    suggestion: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
    }
    if suggestion:
        error["suggestion"] = suggestion
    if details:
        error["details"] = details
    return {
        "status": "error",
        "error": error,
    }


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def print_success(data: Any = None, message: str = "ok", warnings: list | None = None) -> None:
    print_json(build_success(data=data, message=message, warnings=warnings))


def print_error(
    code: str,
    message: str,
    suggestion: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    print_json(build_error(code=code, message=message, suggestion=suggestion, details=details))
