const { enabled, appendRecord, normalizeRecord, quarterLabel, readRecords } = require("./_lib/google-sheets");

function json(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const requesterEmail = String(body.requester_email || "").trim().toLowerCase();
    const referenceLink = String(body.reference_link || "").trim();
    const bookTitle = String(body.book_title || "").trim();
    const author = String(body.author || "").trim();
    const requestNote = String(body.request_note || "").trim();
    const estimatedAmount = Number(String(body.estimated_amount || 0).replace(/[^\d]/g, ""));

    if (!requesterEmail) throw new Error("팀 이메일이 필요합니다.");
    if (!referenceLink) throw new Error("참고 링크가 필요합니다.");
    if (!bookTitle) throw new Error("도서명이 필요합니다.");
    if (!estimatedAmount || estimatedAmount <= 0) throw new Error("금액을 확인해 주세요.");

    const current = await readRecords();
    const nextRecord = normalizeRecord({
      id: `BP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      created_at: new Date().toISOString(),
      quarter: quarterLabel(new Date()),
      requester_email: requesterEmail,
      reference_link: referenceLink,
      book_title: bookTitle,
      author,
      estimated_amount: estimatedAmount,
      purchase_status: "구매요청",
      share_status: "검토중",
      request_note: requestNote,
      updated_at: new Date().toISOString(),
    });

    if (enabled()) {
      await appendRecord(nextRecord);
    }

    const nextRecords = [nextRecord, ...current];
    json(res, 200, { ok: true, record: nextRecord, sheetConnected: enabled(), records: nextRecords });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "request failed" });
  }
};
