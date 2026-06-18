(function () {
  const STORAGE_KEYS = {
    email: "book-purchase-email-v1",
    records: "book-purchase-records-v1",
  };

  const statusOptions = ["구매요청", "구매중", "구매완료", "소장용", "공유 가능"];

  const els = {
    teamEmail: document.getElementById("team-email"),
    saveEmail: document.getElementById("save-email"),
    clearEmail: document.getElementById("clear-email"),
    identitySummary: document.getElementById("identity-summary"),
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
    extractionTimer: null,
    extractionAbort: null,
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

  function formatMoney(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return "-";
    return new Intl.NumberFormat("ko-KR").format(Math.round(number)) + "원";
  }

  function parseAmount(value) {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  function formatAmountInput(value) {
    const amount = parseAmount(value);
    return amount ? new Intl.NumberFormat("ko-KR").format(amount) : "";
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeRecord(record) {
    return {
      id: record.id || randomId(),
      requester_email: normalizeEmail(record.requester_email),
      reference_link: String(record.reference_link || "").trim(),
      book_title: String(record.book_title || "").trim(),
      author: String(record.author || "").trim(),
      estimated_amount: Number(record.estimated_amount || 0),
      request_note: String(record.request_note || "").trim(),
      purchase_status: statusOptions.includes(record.purchase_status)
        ? record.purchase_status
        : "구매요청",
      share_status: String(record.share_status || "검토중").trim(),
      created_at: record.created_at || new Date().toISOString(),
      updated_at: record.updated_at || new Date().toISOString(),
    };
  }

  function loadState() {
    state.email = normalizeEmail(localStorage.getItem(STORAGE_KEYS.email) || "");
    const stored = readJSON(STORAGE_KEYS.records, []);
    state.records = Array.isArray(stored) ? stored.map(normalizeRecord) : [];
  }

  function saveState() {
    writeJSON(STORAGE_KEYS.records, state.records);
    localStorage.setItem(STORAGE_KEYS.email, state.email);
  }

  function setStatus(message, tone = "muted") {
    els.fetchNote.innerHTML = tone === "error" ? `<strong>${escapeHtml(message)}</strong>` : escapeHtml(message);
    els.fetchNote.dataset.tone = tone;
  }

  function renderIdentity() {
    els.teamEmail.value = state.email;
    const current = state.email || "-";
    els.identitySummary.innerHTML = `현재 이메일: <strong>${escapeHtml(current)}</strong>`;
    els.submitRequest.disabled = !state.email;
    els.saveEmail.textContent = state.email ? "이메일 저장" : "이메일 저장";
  }

  function filteredRecords() {
    if (!state.email) return [];
    return state.records
      .filter((record) => record.requester_email === state.email)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
            <td>${escapeHtml(formatMoney(record.estimated_amount))}</td>
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

  function setDraftFromRecord(record, { overwrite = true } = {}) {
    if (!record) return;
    if (overwrite || !els.referenceLink.value.trim()) {
      els.referenceLink.value = record.reference_link || "";
    }
    if (overwrite || !els.bookTitle.value.trim()) {
      els.bookTitle.value = record.book_title || "";
    }
    if (overwrite || !els.bookAuthor.value.trim()) {
      els.bookAuthor.value = record.author || "";
    }
    if (overwrite || !els.bookAmount.value.trim()) {
      els.bookAmount.value = record.estimated_amount ? formatAmountInput(record.estimated_amount) : "";
    }
  }

  function parseMeta(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const content = node?.getAttribute("content") || node?.textContent || "";
      if (content.trim()) return content.trim();
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
        const stack = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of stack) {
          if (!item || typeof item !== "object") continue;
          if (item["@graph"] && Array.isArray(item["@graph"])) {
            stack.push(...item["@graph"]);
          }
          const type = item["@type"];
          const typeText = Array.isArray(type) ? type.join(" ") : String(type || "");
          if (/Book|Product/i.test(typeText) || item.name || item.headline) {
            return item;
          }
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

  function extractTitleFromText(text) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.find((line) => line.length > 3 && line.length < 120) || "";
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

  function extractPriceFromLd(ld) {
    if (!ld || typeof ld !== "object") return 0;
    const offers = ld.offers;
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const offer of offerList) {
      const rawPrice = offer?.price ?? offer?.lowPrice ?? offer?.highPrice;
      const amount = parseAmount(rawPrice);
      if (amount) return amount;
    }
    return 0;
  }

  function extractAuthorFromLd(ld) {
    if (!ld || typeof ld !== "object") return "";
    const author = ld.author;
    if (typeof author === "string") return author.trim();
    if (Array.isArray(author)) {
      const values = author
        .map((item) => (typeof item === "string" ? item : item?.name || ""))
        .filter(Boolean);
      if (values.length) return values.join(", ");
    }
    if (author && typeof author === "object" && author.name) return String(author.name).trim();
    return "";
  }

  function extractTitleFromLd(ld) {
    if (!ld || typeof ld !== "object") return "";
    return String(ld.name || ld.headline || ld.title || "").trim();
  }

  async function loadText(url) {
    const attempts = [];
    const trimmed = String(url || "").trim();
    attempts.push(trimmed);
    if (/^https?:\/\//i.test(trimmed)) {
      attempts.push(`https://r.jina.ai/http://${trimmed.replace(/^https?:\/\//i, "")}`);
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

  function parseBookData(sourceText) {
    const text = String(sourceText || "").trim();
    if (!text) {
      return { title: "", author: "", amount: 0 };
    }

    if (/^\s*</.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const ld = readJsonLd(doc);
      const title =
        parseMeta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[property="book:title"]']) ||
        extractTitleFromLd(ld) ||
        doc.title ||
        "";
      const author =
        parseMeta(doc, ['meta[name="author"]', 'meta[property="book:author"]', 'meta[property="article:author"]']) ||
        extractAuthorFromLd(ld) ||
        extractAuthorFromText(doc.body?.innerText || "");
      const amount =
        extractPriceFromLd(ld) ||
        parseAmount(parseMeta(doc, ['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]'])) ||
        extractAmountFromText(doc.body?.innerText || "");
      return {
        title: title.trim(),
        author: author.trim(),
        amount,
      };
    }

    const title =
      text.match(/(?:도서명|제목|title)[:\s]+([^\n]+)/i)?.[1]?.trim() ||
      extractTitleFromText(text);
    const author = extractAuthorFromText(text);
    const amount = extractAmountFromText(text);
    return { title, author, amount };
  }

  async function extractBookInfo({ overwrite = true } = {}) {
    const link = els.referenceLink.value.trim();
    if (!link) {
      setStatus("참고 링크를 먼저 입력해 주세요.", "error");
      return;
    }

    const sequence = ++state.extractionSequence;
    setStatus("책 정보를 불러오는 중입니다...");
    els.fetchBook.disabled = true;
    try {
      const text = await loadText(link);
      if (sequence !== state.extractionSequence) return;
      const parsed = parseBookData(text);
      if (!parsed.title && !parsed.author && !parsed.amount) {
        throw new Error("추출할 정보가 충분하지 않습니다.");
      }
      setDraftFromRecord(
        {
          reference_link: link,
          book_title: parsed.title,
          author: parsed.author,
          estimated_amount: parsed.amount,
        },
        { overwrite }
      );
      const parts = [];
      if (parsed.title) parts.push(`도서명: ${parsed.title}`);
      if (parsed.author) parts.push(`저자: ${parsed.author}`);
      if (parsed.amount) parts.push(`금액: ${formatMoney(parsed.amount)}`);
      setStatus(parts.join(" / ") || "책 정보를 불러왔습니다.", "success");
    } catch (error) {
      setStatus(error?.message || "자동 추출에 실패했습니다. 직접 수정해 주세요.", "error");
    } finally {
      if (sequence === state.extractionSequence) {
        els.fetchBook.disabled = false;
      }
    }
  }

  function addRequest(event) {
    event.preventDefault();

    if (!state.email) {
      setStatus("먼저 팀 이메일을 저장해 주세요.", "error");
      els.teamEmail.focus();
      return;
    }

    const referenceLink = els.referenceLink.value.trim();
    const bookTitle = els.bookTitle.value.trim();
    const author = els.bookAuthor.value.trim();
    const amount = parseAmount(els.bookAmount.value);

    if (!referenceLink) {
      setStatus("참고 링크를 입력해 주세요.", "error");
      els.referenceLink.focus();
      return;
    }

    if (!bookTitle) {
      setStatus("도서명을 확인해 주세요.", "error");
      els.bookTitle.focus();
      return;
    }

    const record = normalizeRecord({
      id: randomId(),
      requester_email: state.email,
      reference_link: referenceLink,
      book_title: bookTitle,
      author,
      estimated_amount: amount,
      request_note: els.requestNote.value.trim(),
      purchase_status: "구매요청",
      share_status: "검토중",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    state.records.unshift(record);
    saveState();
    els.requestForm.reset();
    els.referenceLink.focus();
    renderAll();
    setStatus("신청이 등록되었습니다.", "success");
  }

  function saveEmail() {
    state.email = normalizeEmail(els.teamEmail.value);
    if (!state.email) {
      setStatus("팀 이메일을 입력해 주세요.", "error");
      renderAll();
      return;
    }
    saveState();
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
    ];

    filteredRecords().forEach((record) => {
      rows.push([
        record.created_at,
        record.requester_email,
        record.book_title,
        record.author,
        String(record.estimated_amount || 0),
        record.purchase_status,
        record.share_status,
        record.reference_link,
        record.request_note,
      ]);
    });

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "book-purchase-support.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV 파일을 내려받았습니다.", "success");
  }

  function wireEvents() {
    els.saveEmail.addEventListener("click", saveEmail);
    els.clearEmail.addEventListener("click", clearEmail);
    els.requestForm.addEventListener("submit", addRequest);
    els.fetchBook.addEventListener("click", () => extractBookInfo({ overwrite: true }));
    els.downloadCsv.addEventListener("click", exportCSV);

    els.teamEmail.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEmail();
      }
    });

    els.referenceLink.addEventListener("input", () => {
      clearTimeout(state.extractionTimer);
      const value = els.referenceLink.value.trim();
      if (!value) {
        setStatus("링크를 넣으면 도서 정보를 자동으로 불러옵니다.");
        return;
      }
      state.extractionTimer = setTimeout(() => {
        extractBookInfo({ overwrite: true });
      }, 700);
    });

    els.bookAmount.addEventListener("blur", () => {
      els.bookAmount.value = formatAmountInput(els.bookAmount.value);
    });

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEYS.email || event.key === STORAGE_KEYS.records) {
        loadState();
        renderAll();
      }
    });
  }

  function init() {
    loadState();
    renderAll();
    wireEvents();
    if (state.email) {
      setStatus("팀 이메일이 저장되어 있습니다. 참고 링크만 넣고 신청하세요.");
    } else {
      setStatus("팀 이메일을 저장한 뒤 신청을 시작하세요.");
    }
  }

  init();
})();
