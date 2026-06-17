#!/usr/bin/env python3
"""Book purchase support portal with Google Sheets sync.

This app is intentionally dependency-free so it can run in a bare Python
environment. It serves a responsive dashboard, stores records locally, and can
mirror the data into a Google Sheet when service account credentials are
configured.
"""

from __future__ import annotations

import base64
import csv
import datetime as dt
import hashlib
import hmac
import html
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - older runtimes
    ZoneInfo = None  # type: ignore


ROOT = Path(__file__).resolve().parent
WORK_DIR = ROOT / "work"
STATIC_DIR = ROOT / "web"
INDEX_PATH = ROOT / "index.html"
DATA_PATH = WORK_DIR / "local-db.json"
SETTINGS_PATH = WORK_DIR / "settings.json"

SHEET_URL = os.environ.get("GOOGLE_SHEET_URL", "")
DEFAULT_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "")
SHEET_TAB_NAME = os.environ.get("GOOGLE_SHEET_TAB", "Sheet1")

HEADERS = [
    "id",
    "created_at",
    "quarter",
    "requester_name",
    "requester_email",
    "book_title",
    "author",
    "book_url",
    "estimated_amount",
    "purchase_status",
    "purchase_manager",
    "share_status",
    "shipping_address_locked",
    "address_hint",
    "request_password_salt",
    "request_password_hash",
    "notes",
    "urgent_request",
    "last_updated_at",
]

STATUS_OPTIONS = ["구매요청", "구매중", "구매완료", "소장용", "공유 가능"]
SHARE_OPTIONS = ["검토중", "공유 가능", "개인 보관"]
DEFAULT_PURCHASER = os.environ.get("DEFAULT_PURCHASER", "Kristy")
MANAGER_PASSWORD = os.environ.get("MANAGER_PASSWORD", "")
APP_SECRET = os.environ.get("APP_SECRET", "change-me")
GOOGLE_SA_EMAIL = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
GOOGLE_PRIVATE_KEY = os.environ.get("GOOGLE_PRIVATE_KEY", "")
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)
PORT = int(os.environ.get("PORT", "8000"))


def now_kst() -> dt.datetime:
    if ZoneInfo is not None:
        return dt.datetime.now(ZoneInfo("Asia/Seoul"))
    return dt.datetime.now().astimezone()


def iso_now() -> str:
    return now_kst().replace(microsecond=0).isoformat()


def quarter_label(moment: Optional[dt.datetime] = None) -> str:
    moment = moment or now_kst()
    quarter = ((moment.month - 1) // 3) + 1
    return f"{moment.year} Q{quarter}"


def budget_for_quarter() -> int:
    return 50_000


def next_purchase_deadline(moment: Optional[dt.datetime] = None) -> dt.datetime:
    moment = moment or now_kst()
    deadline = moment.replace(day=5, hour=10, minute=0, second=0, microsecond=0)
    if moment.day > 5 or (moment.day == 5 and moment.hour >= 10):
        month = (moment.month % 12) + 1
        year = moment.year + (1 if moment.month == 12 else 0)
        deadline = moment.replace(year=year, month=month, day=5, hour=10, minute=0, second=0, microsecond=0)
    return deadline


def mask_address(address: str) -> str:
    cleaned = " ".join(address.split())
    if not cleaned:
        return ""
    if len(cleaned) <= 6:
        return cleaned[:2] + "***"
    return f"{cleaned[:4]}{'*' * max(6, len(cleaned) // 3)}{cleaned[-4:]}"


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def text_response(
    handler: BaseHTTPRequestHandler,
    content: str,
    status: int = 200,
    content_type: str = "text/html; charset=utf-8",
) -> None:
    data = content.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def pbkdf2_hash(password: str, salt: Optional[bytes] = None) -> Dict[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180_000)
    return {
        "salt": base64.urlsafe_b64encode(salt).decode("ascii"),
        "hash": base64.urlsafe_b64encode(digest).decode("ascii"),
    }


def pbkdf2_verify(password: str, salt_b64: str, hash_b64: str) -> bool:
    salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
    expected = base64.urlsafe_b64decode(hash_b64.encode("ascii"))
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180_000)
    return hmac.compare_digest(digest, expected)


def openssl_available() -> bool:
    return shutil.which("openssl") is not None


def _openssl_crypt(data: str, secret: str, decrypt: bool = False) -> str:
    if not openssl_available():
        raise RuntimeError("openssl not found")
    cmd = [
        "openssl",
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-a",
        "-A",
    ]
    if decrypt:
        cmd.append("-d")
    cmd.extend(["-pass", "env:APP_SECRET"])
    env = os.environ.copy()
    env["APP_SECRET"] = secret
    proc = subprocess.run(
        cmd,
        input=data.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "ignore").strip() or "openssl failed")
    return proc.stdout.decode("utf-8").strip()


def encrypt_text(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _openssl_crypt(plaintext, APP_SECRET, decrypt=False)


def decrypt_text(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    return _openssl_crypt(ciphertext, APP_SECRET, decrypt=True)


def parse_sheet_id(url_or_id: str) -> str:
    value = (url_or_id or "").strip()
    if not value:
        return DEFAULT_SHEET_ID
    if "/d/" in value:
        parts = value.split("/d/", 1)[1]
        return parts.split("/", 1)[0]
    return value


class GoogleSheetsClient:
    def __init__(self, spreadsheet_id: str, sheet_name: str) -> None:
        self.spreadsheet_id = spreadsheet_id
        self.sheet_name = sheet_name
        self._token: Optional[Dict[str, Any]] = None

    @property
    def enabled(self) -> bool:
        return bool(GOOGLE_SA_EMAIL and GOOGLE_PRIVATE_KEY and self.spreadsheet_id)

    def _b64url(self, data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

    def _sign_jwt(self, header: Dict[str, Any], claims: Dict[str, Any]) -> str:
        if not openssl_available():
            raise RuntimeError("openssl not found")
        header_b64 = self._b64url(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        claims_b64 = self._b64url(json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
        with tempfile.NamedTemporaryFile("w", delete=False) as key_file:
            key_file.write(GOOGLE_PRIVATE_KEY.replace("\\n", "\n"))
            key_path = key_file.name
        try:
            proc = subprocess.run(
                ["openssl", "dgst", "-sha256", "-sign", key_path],
                input=signing_input,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.decode("utf-8", "ignore").strip() or "openssl signing failed")
            signature_b64 = self._b64url(proc.stdout)
            return f"{header_b64}.{claims_b64}.{signature_b64}"
        finally:
            try:
                os.unlink(key_path)
            except OSError:
                pass

    def _access_token(self) -> str:
        if self._token and self._token.get("expires_at", 0) - 60 > dt.datetime.now().timestamp():
            return self._token["access_token"]

        now = int(dt.datetime.now(dt.timezone.utc).timestamp())
        claims = {
            "iss": GOOGLE_SA_EMAIL,
            "scope": "https://www.googleapis.com/auth/spreadsheets",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        }
        jwt_token = self._sign_jwt({"alg": "RS256", "typ": "JWT"}, claims)
        body = urllib.parse.urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": jwt_token,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        self._token = {
            "access_token": payload["access_token"],
            "expires_at": dt.datetime.now().timestamp() + int(payload.get("expires_in", 3600)),
        }
        return self._token["access_token"]

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        token = self._access_token()
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{self.spreadsheet_id}/{path}"
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        }
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")
            raise RuntimeError(detail or f"Google Sheets API error: {exc.code}") from exc

    def fetch_rows(self) -> List[List[str]]:
        range_name = urllib.parse.quote(f"{self.sheet_name}!A1:R1000", safe="!():,")
        data = self._request("GET", f"values/{range_name}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE")
        return data.get("values", [])

    def replace_rows(self, rows: List[List[Any]]) -> None:
        range_name = urllib.parse.quote(f"{self.sheet_name}!A1", safe="!():,")
        body = {"range": f"{self.sheet_name}!A1", "majorDimension": "ROWS", "values": rows}
        self._request("PUT", f"values/{range_name}?valueInputOption=RAW&includeValuesInResponse=false", body)


class Storage:
    def list_records(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def add_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def update_record(self, record_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def verify_private_access(self, record_id: str, password: str) -> Dict[str, Any]:
        raise NotImplementedError


class LocalStorage(Storage):
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.settings = read_json_file(
            SETTINGS_PATH,
            {
                "manager_password": MANAGER_PASSWORD,
                "default_purchaser": DEFAULT_PURCHASER,
            },
        )
        self.records: List[Dict[str, Any]] = read_json_file(DATA_PATH, [])
        loaded_from_sheet = self._maybe_load_from_sheet()
        self._normalize()
        if loaded_from_sheet:
            self._persist(sync=False)
        elif not DATA_PATH.exists():
            self._persist(sync=False)

    def _normalize(self) -> None:
        if not isinstance(self.records, list):
            self.records = []
        for record in self.records:
            record.setdefault("purchase_status", "구매요청")
            record.setdefault("purchase_manager", self.settings.get("default_purchaser", DEFAULT_PURCHASER))
            record.setdefault("share_status", "검토중")
            record.setdefault("notes", "")
            record.setdefault("urgent_request", False)

    def _maybe_load_from_sheet(self) -> bool:
        if not SHEETS_CLIENT.enabled:
            return False
        try:
            rows = SHEETS_CLIENT.fetch_rows()
        except Exception:
            return False
        if not rows:
            return False
        header = rows[0]
        if not header:
            return False
        indices = {name: header.index(name) for name in header if name in HEADERS}
        loaded: List[Dict[str, Any]] = []
        for row in rows[1:]:
            if not any(str(cell).strip() for cell in row):
                continue
            record = {}
            for key in HEADERS:
                idx = indices.get(key)
                record[key] = row[idx] if idx is not None and idx < len(row) else ""
            if record.get("estimated_amount") not in ("", None):
                try:
                    record["estimated_amount"] = int(float(record["estimated_amount"]))
                except (TypeError, ValueError):
                    pass
            loaded.append(record)
        if loaded:
            self.records = loaded
            return True
        return False

    def _persist(self, sync: bool = True) -> None:
        write_json_file(DATA_PATH, self.records)
        write_json_file(SETTINGS_PATH, self.settings)
        if sync:
            sync_google_sheet(self.records)

    def list_records(self) -> List[Dict[str, Any]]:
        with self.lock:
            return [self._public_record(record) for record in self.records]

    def _public_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        result = dict(record)
        result["shipping_address_locked"] = "잠금됨"
        result.pop("request_password_hash", None)
        result.pop("request_password_salt", None)
        return result

    def add_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            self.records.append(record)
            self._persist()
            return self._public_record(record)

    def update_record(self, record_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            for record in self.records:
                if record["id"] == record_id:
                    record.update(updates)
                    record["last_updated_at"] = iso_now()
                    self._persist()
                    return self._public_record(record)
            raise KeyError("Record not found")

    def verify_private_access(self, record_id: str, password: str) -> Dict[str, Any]:
        with self.lock:
            for record in self.records:
                if record["id"] != record_id:
                    continue
                if pbkdf2_verify(
                    password,
                    record["request_password_salt"],
                    record["request_password_hash"],
                ):
                    return {
                        "id": record["id"],
                        "requester_name": record["requester_name"],
                        "shipping_address": decrypt_text(record.get("shipping_address_locked", "")),
                        "address_hint": record.get("address_hint", ""),
                    }
                raise PermissionError("비밀번호가 일치하지 않습니다.")
            raise KeyError("Record not found")


class SheetBackedStorage(LocalStorage):
    def _persist(self) -> None:
        super()._persist()

    def _normalize(self) -> None:
        if not isinstance(self.records, list):
            self.records = []
        if not self.records:
            return
        for record in self.records:
            record.setdefault("purchase_status", "구매요청")
            record.setdefault("purchase_manager", self.settings.get("default_purchaser", DEFAULT_PURCHASER))
            record.setdefault("share_status", "검토중")
            record.setdefault("notes", "")
            record.setdefault("urgent_request", False)


def sheet_rows_from_records(records: List[Dict[str, Any]]) -> List[List[Any]]:
    rows = [HEADERS]
    for record in records:
        rows.append([record.get(col, "") for col in HEADERS])
    return rows


SHEETS_CLIENT = GoogleSheetsClient(GOOGLE_SHEET_ID, SHEET_TAB_NAME)


def sync_google_sheet(records: List[Dict[str, Any]]) -> None:
    if not SHEETS_CLIENT.enabled:
        return
    try:
        SHEETS_CLIENT.replace_rows(sheet_rows_from_records(records))
    except Exception:
        # Keep the app usable even if Google Sheets temporarily fails.
        return


def storage_factory() -> Storage:
    if SHEETS_CLIENT.enabled:
        try:
            return LocalStorage()
        except Exception:
            return LocalStorage()
    return LocalStorage()


STORAGE = storage_factory()


def record_to_sheet_row(record: Dict[str, Any]) -> List[Any]:
    return [record.get(col, "") for col in HEADERS]


def build_public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(record)
    payload["shipping_address_locked"] = "잠금됨"
    payload.pop("request_password_hash", None)
    payload.pop("request_password_salt", None)
    return payload


def compute_budget_used(records: Iterable[Dict[str, Any]], requester_name: str, quarter: str) -> int:
    total = 0
    for record in records:
        if record.get("requester_name", "").strip().lower() == requester_name.strip().lower() and record.get("quarter") == quarter:
            try:
                total += int(record.get("estimated_amount") or 0)
            except (TypeError, ValueError):
                continue
    return total


def render_index() -> str:
    records = STORAGE.list_records()
    counts = {status: 0 for status in STATUS_OPTIONS}
    for record in records:
        counts[record.get("purchase_status", "구매요청")] = counts.get(record.get("purchase_status", "구매요청"), 0) + 1
    bootstrap = {
        "program": {
            "start_month": "7월",
            "purchase_deadline": "매월 1일 오전 10시 마감, 매월 5일까지 주문",
            "purchase_manager": "Kristy (3개월)",
            "sheet_manager": "Saige",
            "quarter_budget": budget_for_quarter(),
            "sheet_url": SHEET_URL,
            "sheet_status": "연결됨" if SHEETS_CLIENT.enabled else "로컬 모드",
            "current_quarter": quarter_label(),
            "next_deadline": next_purchase_deadline().isoformat(),
            "rules": [
                "분기별 1회 구매",
                "1인당 5만원 이하",
                "금액 몰아주기 금지",
                "개인 배송지는 비밀번호로만 공개",
            ],
        },
        "records": [build_public_record(record) for record in records],
        "status_counts": counts,
        "manager_password_set": bool(MANAGER_PASSWORD),
    }
    bootstrap_json = json.dumps(bootstrap, ensure_ascii=False).replace("</", "<\\/")
    html_text = INDEX_PATH.read_text(encoding="utf-8") if INDEX_PATH.exists() else "<!doctype html><html><body>Missing index.html</body></html>"
    marker = "<!--BOOTSTRAP_JSON_MARKER-->"
    return html_text.replace(marker, f"<script>window.__BOOTSTRAP__ = {bootstrap_json};</script>")


def render_csv(records: List[Dict[str, Any]], include_private: bool = False) -> str:
    output = tempfile.SpooledTemporaryFile(mode="w+", newline="", encoding="utf-8", max_size=1024 * 1024)
    try:
        if include_private:
            fieldnames = HEADERS
        else:
            fieldnames = [
                "id",
                "created_at",
                "quarter",
                "requester_name",
                "requester_email",
                "book_title",
                "author",
                "book_url",
                "estimated_amount",
                "purchase_status",
                "purchase_manager",
                "share_status",
                "shipping_address_locked",
                "address_hint",
                "notes",
                "urgent_request",
                "last_updated_at",
            ]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            row = dict(record)
            if not include_private:
                row["shipping_address_locked"] = mask_address(row.get("shipping_address_locked", ""))
                row.pop("request_password_hash", None)
                row.pop("request_password_salt", None)
            writer.writerow({key: row.get(key, "") for key in fieldnames})
        output.seek(0)
        return output.read()
    finally:
        output.close()


def update_record_status(record_id: str, payload: Dict[str, Any], manager_password: str) -> Dict[str, Any]:
    settings_password = STORAGE.settings.get("manager_password") if isinstance(STORAGE, LocalStorage) else MANAGER_PASSWORD
    if not settings_password:
        raise PermissionError("관리자 비밀번호가 설정되지 않았습니다.")
    if manager_password != settings_password:
        raise PermissionError("관리자 비밀번호가 일치하지 않습니다.")
    current = STORAGE.list_records()
    target = None
    for record in getattr(STORAGE, "records", current):
        if record.get("id") == record_id:
            target = record
            break
    if target is None:
        raise KeyError("Record not found")
    updates: Dict[str, Any] = {}
    if "purchase_status" in payload and payload["purchase_status"] in STATUS_OPTIONS:
        updates["purchase_status"] = payload["purchase_status"]
    if "share_status" in payload and payload["share_status"] in SHARE_OPTIONS:
        updates["share_status"] = payload["share_status"]
    if "purchase_manager" in payload:
        updates["purchase_manager"] = payload["purchase_manager"].strip()
    return STORAGE.update_record(record_id, updates)


class AppHandler(BaseHTTPRequestHandler):
    server_version = "BookSupport/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _read_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        if "application/json" in ctype:
            return json.loads(raw.decode("utf-8"))
        parsed = urllib.parse.parse_qs(raw.decode("utf-8"))
        return {key: values[0] for key, values in parsed.items()}

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            text_response(self, render_index())
            return
        if path == "/app.js":
            js_path = STATIC_DIR / "app.js"
            text_response(self, js_path.read_text(encoding="utf-8"), content_type="application/javascript; charset=utf-8")
            return
        if path == "/api/bootstrap":
            json_response(
                self,
                {
                    "program": {
                        "start_month": "7월",
                        "purchase_deadline": "매월 1일 오전 10시 마감, 매월 5일까지 주문",
                        "purchase_manager": "Kristy (3개월)",
                        "sheet_manager": "Saige",
                        "quarter_budget": budget_for_quarter(),
                        "sheet_url": SHEET_URL,
                        "sheet_status": "연결됨" if SHEETS_CLIENT.enabled else "로컬 모드",
                        "current_quarter": quarter_label(),
                        "next_deadline": next_purchase_deadline().isoformat(),
                        "rules": [
                            "분기별 1회 구매",
                            "1인당 5만원 이하",
                            "금액 몰아주기 금지",
                            "개인 배송지는 비밀번호로만 공개",
                        ],
                    },
                    "records": STORAGE.list_records(),
                    "status_counts": {},
                    "manager_password_set": bool(MANAGER_PASSWORD),
                },
            )
            return
        if path == "/api/records":
            json_response(self, {"records": STORAGE.list_records()})
            return
        if path == "/api/export.csv":
            include_private = self.headers.get("X-Manager-Password", "") == MANAGER_PASSWORD and bool(MANAGER_PASSWORD)
            csv_data = render_csv(getattr(STORAGE, "records", []), include_private=include_private)
            encoded = csv_data.encode("utf-8-sig")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="book-purchase-support.csv"')
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_HEAD(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            html_data = render_index().encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_data)))
            self.end_headers()
            return
        if path == "/api/export.csv":
            csv_data = render_csv(getattr(STORAGE, "records", []))
            encoded = csv_data.encode("utf-8-sig")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="book-purchase-support.csv"')
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read_body()
            if path == "/api/request":
                self.handle_create_request(body)
                return
            if path == "/api/unlock":
                self.handle_unlock(body)
                return
            if path == "/api/admin/update":
                self.handle_admin_update(body)
                return
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
        except PermissionError as exc:
            json_response(self, {"ok": False, "error": str(exc)}, status=HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            json_response(self, {"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            json_response(self, {"ok": False, "error": f"서버 오류: {exc}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_create_request(self, body: Dict[str, Any]) -> None:
        requester_name = body.get("requester_name", "").strip()
        requester_email = body.get("requester_email", "").strip()
        book_title = body.get("book_title", "").strip()
        estimated_amount = int(float(body.get("estimated_amount") or 0))
        if not requester_name or not requester_email or not book_title:
            raise ValueError("필수 입력값이 비어 있습니다.")
        if estimated_amount <= 0:
            raise ValueError("금액은 0보다 커야 합니다.")
        quarter = body.get("request_quarter") or quarter_label()
        current_records = STORAGE.list_records()
        budget_used = compute_budget_used(current_records, requester_name, quarter)
        if budget_used + estimated_amount > budget_for_quarter():
            raise ValueError(
                f"{requester_name}님의 {quarter} 누적 금액이 예산 {budget_for_quarter():,}원을 초과합니다."
            )
        password = body.get("private_password", "").strip()
        if len(password) < 4:
            raise ValueError("비밀번호는 4자 이상이어야 합니다.")
        hashed = pbkdf2_hash(password)
        record_id = f"BK-{secrets.token_hex(4).upper()}"
        record = {
            "id": record_id,
            "created_at": iso_now(),
            "quarter": quarter,
            "requester_name": requester_name,
            "requester_email": requester_email,
            "book_title": book_title,
            "author": body.get("author", "").strip(),
            "book_url": body.get("book_url", "").strip(),
            "estimated_amount": estimated_amount,
            "purchase_status": "구매요청",
            "purchase_manager": body.get("purchase_manager", "").strip() or DEFAULT_PURCHASER,
            "share_status": "공유 가능" if body.get("share_status") == "on" else "검토중",
            "shipping_address_locked": encrypt_text(body.get("shipping_address", "").strip()),
            "address_hint": body.get("address_hint", "").strip(),
            "request_password_salt": hashed["salt"],
            "request_password_hash": hashed["hash"],
            "notes": body.get("notes", "").strip(),
            "urgent_request": body.get("urgent_request") == "on",
            "last_updated_at": iso_now(),
        }
        STORAGE.add_record(record)
        json_response(self, {"ok": True, "record": build_public_record(record)})

    def handle_unlock(self, body: Dict[str, Any]) -> None:
        record_id = body.get("record_id", "").strip()
        password = body.get("password", "").strip()
        if not record_id or not password:
            raise ValueError("신청 ID와 비밀번호를 모두 입력하세요.")
        result = STORAGE.verify_private_access(record_id, password)
        json_response(self, {"ok": True, "private": result})

    def handle_admin_update(self, body: Dict[str, Any]) -> None:
        record_id = body.get("record_id", "").strip()
        manager_password = body.get("manager_password", "").strip()
        if not record_id or not manager_password:
            raise ValueError("신청 ID와 관리자 비밀번호가 필요합니다.")
        payload = {
            "purchase_status": body.get("purchase_status", ""),
            "share_status": body.get("share_status", ""),
            "purchase_manager": body.get("purchase_manager", ""),
        }
        updated = update_record_status(record_id, payload, manager_password)
        json_response(self, {"ok": True, "record": updated})


def ensure_workspace() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_PATH.exists():
        write_json_file(DATA_PATH, [])
    if not SETTINGS_PATH.exists():
        write_json_file(
            SETTINGS_PATH,
            {
                "manager_password": MANAGER_PASSWORD,
                "default_purchaser": DEFAULT_PURCHASER,
            },
        )


def main() -> None:
    ensure_workspace()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), AppHandler)
    print(f"Book support portal running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
