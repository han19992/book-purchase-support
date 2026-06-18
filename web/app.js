(function () {
  const STORAGE_KEYS = {
    email: "book-purchase-email-v1",
    records: "book-purchase-records-v1",
  };

  const els = {
    teamEmail: document.getElementById("team-email"),
    saveEmail: document.getElementById("save-email"),
    clearEmail: document.getElementById("clear-email"),
    identitySummary: document.getElementById("identity-summary"),
    sheetStatusText: document.getElementById("sheet-status-text"),
    requestForm: document.getElementById("request-form"),
    referenceLink: document.getElementById("reference-link"),
    fetchBook: document.getElementById("fetch-book"),
    fetchNote: document.getElementById("fetch-note"),
    bookTitle: document.getElementById("book-title"),
    bookAuthor: document.getElementById("book-author"),
    bookAmount: document.getElementById("book-amount"),
    requestNote: document.getElementById("request-note"),
    submitRequest: document.getElementById("submit-request"),
    recordsBody: document.getElementById("records-body"),
    emptyState: document.getElementById("empty-state"),
    downloadCsv: document.getElementById("download-csv"),
  };

  const state = {
    email: "",
    records: [],
    sheetConnected: false,
    extractionTimer: null,
    extractionSequence: 0,
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function randomId() {
    return `BP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseAmount(value) {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  function formatAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "-";
    return `${new Intl.NumberFormat("ko-KR").format(Math.round(amount))}원`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function normalizeRecord(record) {
    return {
      id: String(record.id || "").trim() || randomId(),
      created_at: String(record.created_at || "").trim(),
      quarter: String(record.quarter || "").trim(),
      requester_email: normalizeEmail(record.requester_email),
      reference_link: String(record.reference_link || "").trim(),
      book_title: String(record.book_title || "").trim(),
      author: String(record.author || "").trim(),
      estimated_amount: parseAmount(record.estimated_amount),
      purchase_status: String(record.purchase_status || "구매요청").trim() || "구매요청",
      share_status: String(record.share_status || "검토중").trim() || "검토중",
      request_note: String(record.request_note || "").trim(),
      updated_at: String(record.updated_at || "").trim(),
    };
  }

  function loadLocalCache() {
    state.email = normalizeEmail(localStorage.getItem(STORAGE_KEYS.email) || "");
    const stored = readJSON(STORAGE_KEYS.records, []);
    state.records = Array.isArray(stored) ? stored.map(normalizeRecord) : [];
  }

  function saveLocalCache() {
    localStorage.setItem(STORAGE_KEYS.email, state.email);
    writeJSON(STORAGE_KEYS.records, state.records);
  }

  function setStatus(message, tone = "muted") {
    els.fetchNote.innerHTML = tone === "error" ? `<strong>${escapeHtml(message)}</strong>` : escapeHtml(message);
    els.fetchNote.dataset.tone = tone;
  }

  function setSheetStatus(text) {
    els.sheetStatusText.textContent = text;
  }

  function renderIdentity() {
    els.teamEmail.value = state.email;
    els.identitySummary.innerHTML = `현재 이메일: <strong>${escapeHtml(state.email || "-")}</strong>`;
    els.submitRequest.disabled = !state.email;
  }

  function filteredRecords() {
    if (!state.email) return [];
    return state.records
      .filter((record) => record.requester_email === state.email)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function renderRecords() {
    const rows = filteredRecords();
    els.recordsBody.innerHTML = rows
      .map(
        (record) => `
          <tr>
            <td>${escapeHtml(formatDate(record.created_at))}</td>
            <td><strong>${escapeHtml(record.book_title || "-")}</strong></td>
            <td>${escapeHtml(record.author || "-")}</td>
            <td>${escapeHtml(formatAmount(record.estimated_amount))}</td>
            <td><span class="status-pill">${escapeHtml(record.purchase_status || "구매요청")}</span></td>
            <td>
              ${record.reference_link ? `<a href="${escapeHtml(record.reference_link)}" target="_blank" rel="noreferrer">${escapeHtml(record.reference_link)}</a>` : "-"}
            </td>
          </tr>
        `
      )
      .join("");
    els.emptyState.classList.toggle("hidden", rows.length !== 0);
  }

  function renderAll() {
    renderIdentity();
    renderRecords();
  }

  function setDraftFromRecord(record) {
    if (!record) return;
    els.referenceLink.value = record.reference_link || els.referenceLink.value;
    els.bookTitle.value = record.book_title || els.bookTitle.value;
    els.bookAuthor.value = record.author || els.bookAuthor.value;
    els.bookAmount.value = record.estimated_amount ? new Intl.NumberFormat("ko-KR").format(record.estimated_amount) : els.bookAmount.value;
  }

  function parseMeta(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const content = node?.getAttribute("content") || node?.textContent || "";
      if (String(content).trim()) return String(content).trim();
    }
    return "";
  }

  function readJsonLd(doc) {
    const nodes = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (const node of nodes) {
      const raw = node.textContent.trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (stack.length) {
          const item = stack.shift();
          if (!item || typeof item !== "object") continue;
          if (Array.isArray(item["@graph"])) stack.push(...item["@graph"]);
          const type = item["@type"];
          const typeText = Array.isArray(type) ? type.join(" ") : String(type || "");
          if (/Book|Product/i.test(typeText) || item.name || item.headline) return item;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function extractAuthorFromText(text) {
    const patterns = [
      /저자[:\s]+([^\n|<]+)/i,
      /작가[:\s]+([^\n|<]+)/i,
      /author[:\s]+([^\n|<]+)/i,
      /by\s+([^\n|<]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  function extractAmountFromText(text) {
    const patterns = [
      /(?:₩|원)\s?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/,
      /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s?원/,
      /price[:\s]+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/i,
      /amount[:\s]+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return parseAmount(match[1]);
    }
    return 0;
  }

  function extractTitleFromText(text) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.find((line) => line.length > 3 && line.length < 120) || "";
  }

  function extractBookData(sourceText) {
    const text = String(sourceText || "").trim();
    if (!text) return { title: "", author: "", amount: 0 };

    if (/^\s*</.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const ld = readJsonLd(doc);
      const title =
        parseMeta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[property="book:title"]']) ||
        String(ld?.name || ld?.headline || ld?.title || "").trim() ||
        doc.title ||
        "";
      const author =
        parseMeta(doc, ['meta[name="author"]', 'meta[property="book:author"]', 'meta[property="article:author"]']) ||
        String(ld?.author?.name || ld?.author || "").trim() ||
        extractAuthorFromText(doc.body?.innerText || "");
      const amount =
        parseAmount(parseMeta(doc, ['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]'])) ||
        extractAmountFromText(doc.body?.innerText || "");
      return { title, author, amount };
    }

    return {
      title: text.match(/(?:도서명|제목|title)[:\s]+([^\n]+)/i)?.[1]?.trim() || extractTitleFromText(text),
      author: extractAuthorFromText(text),
      amount: extractAmountFromText(text),
    };
  }

  async function loadText(url) {
    const source = String(url || "").trim();
    const attempts = [source];
    if (/^https?:\/\//i.test(source)) {
      attempts.push(`https://r.jina.ai/http://${source.replace(/^https?:\/\//i, "")}`);
    }
    for (const candidate of attempts) {
      try {
        const response = await fetch(candidate, { redirect: "follow" });
        if (!response.ok) continue;
        return await response.text();
      } catch {
        continue;
      }
    }
    throw new Error("링크에서 정보를 읽어오지 못했습니다.");
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `요청 실패: ${response.status}`);
    }
    return data;
  }

  async function refreshFromServer() {
    try {
      const data = await fetchJson("/api/bootstrap");
      state.sheetConnected = Boolean(data.sheetConnected);
      setSheetStatus(data.sheetStatus || (state.sheetConnected ? "구글 시트 연결됨" : "연결 준비 중"));
      if (Array.isArray(data.records)) {
        state.records = data.records.map(normalizeRecord);
        saveLocalCache();
      }
      renderAll();
      return true;
    } catch (error) {
      state.sheetConnected = false;
      setSheetStatus("연결 준비 중");
      const cached = readJSON(STORAGE_KEYS.records, []);
      if (Array.isArray(cached) && cached.length) {
        state.records = cached.map(normalizeRecord);
        renderAll();
      }
      setStatus(error.message || "시트 연결에 실패했습니다.", "error");
      return false;
    }
  }

  async function extractBookInfo() {
    const link = els.referenceLink.value.trim();
    if (!link) {
      setStatus("참고 링크를 먼저 입력해 주세요.", "error");
      return;
    }

    const sequence = ++state.extractionSequence;
    els.fetchBook.disabled = true;
    setStatus("책 정보를 불러오는 중입니다...");
    try {
      const text = await loadText(link);
      if (sequence !== state.extractionSequence) return;
      const parsed = extractBookData(text);
      setDraftFromRecord({
        reference_link: link,
        book_title: parsed.title,
        author: parsed.author,
        estimated_amount: parsed.amount,
      });
      const parts = [];
      if (parsed.title) parts.push(`도서명: ${parsed.title}`);
      if (parsed.author) parts.push(`저자: ${parsed.author}`);
      if (parsed.amount) parts.push(`금액: ${formatAmount(parsed.amount)}`);
      setStatus(parts.join(" / ") || "책 정보를 불러왔습니다.", "success");
    } catch (error) {
      setStatus(error.message || "자동 추출에 실패했습니다. 직접 수정해 주세요.", "error");
    } finally {
      if (sequence === state.extractionSequence) {
        els.fetchBook.disabled = false;
      }
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!state.email) {
      setStatus("먼저 팀 이메일을 저장해 주세요.", "error");
      return;
    }

    const payload = {
      requester_email: state.email,
      reference_link: els.referenceLink.value.trim(),
      book_title: els.bookTitle.value.trim(),
      author: els.bookAuthor.value.trim(),
      estimated_amount: parseAmount(els.bookAmount.value),
      request_note: els.requestNote.value.trim(),
    };

    if (!payload.reference_link) {
      setStatus("참고 링크를 입력해 주세요.", "error");
      els.referenceLink.focus();
      return;
    }
    if (!payload.book_title) {
      setStatus("도서명을 확인해 주세요.", "error");
      els.bookTitle.focus();
      return;
    }
    if (!payload.estimated_amount) {
      setStatus("금액을 확인해 주세요.", "error");
      els.bookAmount.focus();
      return;
    }

    els.submitRequest.disabled = true;
    try {
      const data = await fetchJson("/api/request", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (Array.isArray(data.records)) {
        state.records = data.records.map(normalizeRecord);
      } else if (data.record) {
        state.records = [normalizeRecord(data.record), ...state.records];
      }
      saveLocalCache();
      els.requestForm.reset();
      els.referenceLink.focus();
      renderAll();
      setSheetStatus(data.sheetConnected ? "구글 시트 연결됨" : "연결 준비 중");
      setStatus("신청이 구글 시트에 기록되었습니다.", "success");
    } catch (error) {
      setStatus(error.message || "신청 등록에 실패했습니다.", "error");
    } finally {
      els.submitRequest.disabled = !state.email;
    }
  }

  function saveEmail() {
    state.email = normalizeEmail(els.teamEmail.value);
    if (!state.email) {
      setStatus("팀 이메일을 입력해 주세요.", "error");
      renderAll();
      return;
    }
    saveLocalCache();
    renderAll();
    setStatus(`현재 이메일을 ${state.email}로 저장했습니다.`, "success");
  }

  function clearEmail() {
    state.email = "";
    localStorage.removeItem(STORAGE_KEYS.email);
    renderAll();
    setStatus("저장된 이메일을 지웠습니다.", "muted");
  }

  function exportCSV() {
    const rows = [
      ["신청일", "팀 이메일", "도서명", "저자", "금액", "상태", "공유 상태", "참고 링크", "메모"],
      ...filteredRecords().map((record) => [
        record.created_at,
        record.requester_email,
        record.book_title,
        record.author,
        String(record.estimated_amount || 0),
        record.purchase_status,
        record.share_status,
        record.reference_link,
        record.request_note,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "book-purchase-support.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV 파일을 내려받았습니다.", "success");
  }

  function wireEvents() {
    els.saveEmail.addEventListener("click", saveEmail);
    els.clearEmail.addEventListener("click", clearEmail);
    els.requestForm.addEventListener("submit", submitRequest);
    els.fetchBook.addEventListener("click", extractBookInfo);
    els.downloadCsv.addEventListener("click", exportCSV);

    els.teamEmail.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEmail();
      }
    });

    els.referenceLink.addEventListener("input", () => {
      clearTimeout(state.extractionTimer);
      if (!els.referenceLink.value.trim()) {
        setStatus("링크를 넣으면 도서 정보를 자동으로 불러옵니다.");
        return;
      }
      state.extractionTimer = setTimeout(() => {
        extractBookInfo();
      }, 700);
    });

    els.bookAmount.addEventListener("blur", () => {
      const amount = parseAmount(els.bookAmount.value);
      els.bookAmount.value = amount ? new Intl.NumberFormat("ko-KR").format(amount) : "";
    });

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEYS.email || event.key === STORAGE_KEYS.records) {
        loadLocalCache();
        renderAll();
      }
    });
  }

  async function init() {
    loadLocalCache();
    renderAll();
    wireEvents();
    const connected = await refreshFromServer();
    if (!state.email) {
      setStatus("팀 이메일을 저장한 뒤 신청을 시작하세요.");
    } else if (connected) {
      setStatus("팀 이메일이 저장되어 있습니다. 참고 링크만 넣고 신청하세요.");
    }
  }

  init();
})();
