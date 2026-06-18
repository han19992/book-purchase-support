const { enabled, readRecords } = require("./_lib/google-sheets");

module.exports = async function handler(req, res) {
  try {
    const records = await readRecords();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      sheetConnected: enabled(),
      sheetStatus: enabled() ? "구글 시트 연결됨" : "연결 준비 중",
      records,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      sheetConnected: false,
      sheetStatus: "연결 실패",
      error: error.message || "bootstrap failed",
      records: [],
    });
  }
};
