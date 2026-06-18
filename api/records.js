const { enabled, readRecords } = require("./_lib/google-sheets");

module.exports = async function handler(req, res) {
  try {
    const records = await readRecords();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      sheetConnected: enabled(),
      records,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      sheetConnected: false,
      error: error.message || "records failed",
      records: [],
    });
  }
};
