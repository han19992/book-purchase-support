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

function appsScriptUrl() {
  return String(process.env.APPS_SCRIPT_WEBAPP_URL || "").trim();
}

function enabled() {
  return Boolean(appsScriptUrl());
}

async function scriptRequest(method, body) {
  if (!enabled()) {
    throw new Error("앱스 스크립트 연결 정보가 설정되지 않았습니다.");
  }

  const response = await fetch(appsScriptUrl(), {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await response.text().catch(() => "");
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text };
    }
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Apps Script 오류: ${response.status}`);
  }

  return data;
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

async function readRecords() {
  if (!enabled()) return [];
  const result = await scriptRequest("GET");
  const rows = Array.isArray(result.records) ? result.records : [];
  return rows.map(normalizeRecord).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function appendRecord(record) {
  if (!enabled()) return;
  await scriptRequest("POST", { record: normalizeRecord(record) });
}

module.exports = {
  enabled,
  HEADERS,
  appendRecord,
  normalizeRecord,
  quarterLabel,
  readRecords,
};
