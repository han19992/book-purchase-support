const crypto = require("crypto");

const HEADERS = [
  "id",
  "created_at",
  "quarter",
  "requester_email",
  "reference_link",
  "book_title",
  "author",
  "estimated_amount",
  "purchase_status",
  "share_status",
  "request_note",
  "updated_at",
];

function parseSheetId(urlOrId) {
  const value = String(urlOrId || "").trim();
  if (!value) return "";
  if (value.includes("/d/")) {
    return value.split("/d/", 1)[1].split("/", 1)[0];
  }
  return value;
}

function sheetId() {
  return parseSheetId(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_URL || "");
}

function sheetTab() {
  return String(process.env.GOOGLE_SHEET_TAB || "Sheet1").trim();
}

function serviceAccountEmail() {
  return String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
}

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}

function enabled() {
  return Boolean(sheetId() && serviceAccountEmail() && privateKey());
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: serviceAccountEmail(),
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = base64url(signer.sign(privateKey()));
  const assertion = `${header}.${payload}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth 실패: ${response.status}`);
  }
  const data = await response.json();
  return data.access_token;
}

async function sheetsRequest(method, path, body) {
  if (!enabled()) {
    throw new Error("Google Sheets 연결 정보가 설정되지 않았습니다.");
  }
  const token = await accessToken();
  const suffix = String(path || "");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${
    suffix.startsWith("?") ? suffix : `/${suffix}`
  }`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Google Sheets API 오류: ${response.status}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

async function sheetTitle() {
  const meta = await sheetsRequest("GET", "?fields=sheets(properties(title))");
  const sheets = Array.isArray(meta.sheets) ? meta.sheets : [];
  return sheets[0]?.properties?.title || sheetTab();
}

function normalizeAmount(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function quarterLabel(date = new Date()) {
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${year}년 ${quarter}분기`;
}

function normalizeRecord(record) {
  return {
    id: String(record.id || "").trim(),
    created_at: String(record.created_at || "").trim(),
    quarter: String(record.quarter || "").trim(),
    requester_email: String(record.requester_email || "").trim(),
    reference_link: String(record.reference_link || "").trim(),
    book_title: String(record.book_title || "").trim(),
    author: String(record.author || "").trim(),
    estimated_amount: normalizeAmount(record.estimated_amount),
    purchase_status: String(record.purchase_status || "구매요청").trim() || "구매요청",
    share_status: String(record.share_status || "검토중").trim() || "검토중",
    request_note: String(record.request_note || "").trim(),
    updated_at: String(record.updated_at || "").trim(),
  };
}

function recordToRow(record) {
  return HEADERS.map((key) => {
    if (key === "estimated_amount") return String(normalizeAmount(record[key]));
    return String(record[key] ?? "");
  });
}

function rowToRecord(headerRow, row) {
  const record = {};
  headerRow.forEach((header, index) => {
    record[header] = row[index] ?? "";
  });
  return normalizeRecord(record);
}

async function readRecords() {
  if (!enabled()) return [];
  const title = await sheetTitle();
  const range = encodeURIComponent(`${title}!A1:Z1000`);
  const result = await sheetsRequest(
    "GET",
    `values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`
  );
  const rows = Array.isArray(result.values) ? result.values : [];
  if (!rows.length) return [];
  const header = rows[0].map((value) => String(value || "").trim());
  return rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()))
    .map((row) => rowToRecord(header, row))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function writeRecords(records) {
  if (!enabled()) return;
  const title = await sheetTitle();
  const rows = [HEADERS, ...records.map(recordToRow)];
  const range = encodeURIComponent(`${title}!A1`);
  await sheetsRequest(
    "PUT",
    `values/${range}?valueInputOption=RAW&includeValuesInResponse=false`,
    {
      range: `${title}!A1`,
      majorDimension: "ROWS",
      values: rows,
    }
  );
}

module.exports = {
  enabled,
  HEADERS,
  normalizeRecord,
  quarterLabel,
  readRecords,
  writeRecords,
};
