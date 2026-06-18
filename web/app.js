(() => {
  const STORAGE_KEY = "book-purchase-support-state-v2";
  const bootstrap = window.__BOOTSTRAP__ || {};
  const program = {
    start_month: "7월",
    purchase_deadline: "매월 1일 오전 10시 마감, 매월 5일까지 주문",
    purchase_manager: "Kristy (3개월)",
    sheet_manager: "Saige",
    quarter_budget: 50000,
    sheet_url: "https://docs.google.com/spreadsheets/d/1Ei5rmKQk6kZj7Dfj7DRvrDLz20nVuEq3iUglUMeBaGE/edit?gid=0#gid=0",
    sheet_status: "구글 시트 연결됨",
    current_quarter: formatQuarter(new Date()),
    next_deadline: "",
    rules: [],
    ...(bootstrap.program || {}),
  };
  const statusOptions = ["구매요청", "구매중", "구매완료", "소장용", "공유 가능"];
  const shareOptions = ["검토중", "공유 가능", "개인 보관"];

  const els = {
    currentQuarter: document.getElementById("current-quarter"),
    quarterBudget: document.getElementById("quarter-budget"),
    nextDeadline: document.getElementById("next-deadline"),
    deadlineDetail: document.getElementById("deadline-detail"),
    sheetStatus: document.getElementById("sheet-status"),
    sheetLink: document.getElementById("sheet-link"),
    rules: document.getElementById("rules"),
    statusbar: document.getElementById("statusbar"),
    requestForm: document.getElementById("request-form"),
    recordsBody: document.getElementById("records-body"),
    emptyState: document.getElementById("empty-state"),
    search: document.getElementById("search"),
    statusFilter: document.getElementById("status-filter"),
    unlockId: document.getElementById("unlock_id"),
    unlockPassword: document.getElementById("unlock_password"),
    unlockBtn: document.getElementById("unlock-btn"),
    unlockResult: document.getElementById("unlock-result"),
    adminLoginBtn: document.getElementById("admin-login-btn"),
    toast: document.getElementById("toast"),
    budgetNote: document.getElementById("budget-note"),
    purchaseManager: document.getElementById("purchase_manager"),
    requestQuarter: document.getElementById("request_quarter"),
    csvDownload: document.getElementById("csv-download"),
  };

  const state = {
    records: [],
    privateStore: {},
    privateById: {},
    search: "",
    statusFilter: "",
    managerUnlocked: sessionStorage.getItem("bookPurchaseManagerUnlocked") === "1",
  };

  const money = new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  });

  function formatQuarter(date) {
    const year = date.getFullYear();
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${year}년 ${quarter}분기`;
  }

  function nextDeadlineText(date) {
    const next = new Date(date);
    next.setDate(1);
    next.setHours(10, 0, 0, 0);
    if (date.getDate() > 1 || (date.getDate() === 1 && date.getHours() >= 10)) {
      next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  function formatDeadline(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  function maskAddress(address) {
    const text = String(address || "");
    if (!text) return "비밀번호 입력 후 확인";
    if (text.length <= 8) return `${text.slice(0, 2)}***`;
    return `${text.slice(0, 6)}…${text.slice(-4)}`;
  }

  function randomId() {
    return `BK-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
  }

  function normalizeRecord(record) {
    return {
      id: record.id || randomId(),
      requester_name: record.requester_name || "",
      requester_email: record.requester_email || "",
      book_title: record.book_title || "",
      author: record.author || "",
      book_url: record.book_url || "",
      estimated_amount: Number(record.estimated_amount || 0),
      quarter: record.quarter || formatQuarter(new Date()),
      purchase_status: record.purchase_status || "구매요청",
      share_status: record.share_status || "검토중",
      shipping_address_locked: record.shipping_address_locked || "비밀번호 입력 후 확인",
      purchase_manager: record.purchase_manager || "Kristy",
      urgent_request: Boolean(record.urgent_request),
      notes: record.notes || "",
      created_at: record.created_at || new Date().toISOString(),
    };
  }

  function loadBootstrapRecords() {
    const records = Array.isArray(bootstrap.records) ? bootstrap.records : [];
    return records.map(normalizeRecord);
  }

  function loadState() {
    state.records = loadBootstrapRecords();
    state.privateStore = {};

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (Array.isArray(saved.records) && saved.records.length > 0) {
        state.records = saved.records.map(normalizeRecord);
      }
      if (saved.privateStore && typeof saved.privateStore === "object") {
        state.privateStore = saved.privateStore;
      }
    } catch {
      // Keep defaults if storage is unavailable or malformed.
    }
  }

  function persistState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        records: state.records,
        privateStore: state.privateStore,
      })
    );
  }

  async function deriveKey(password, salt, usages) {
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 120000,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      usages
    );
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function encryptAddress(address, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ["encrypt", "decrypt"]);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(address)
    );
    return {
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipher)),
    };
  }

  async function decryptAddress(bundle, password) {
    const salt = base64ToBytes(bundle.salt);
    const iv = base64ToBytes(bundle.iv);
    const key = await deriveKey(password, salt, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(bundle.ciphertext)
    );
    return new TextDecoder().decode(plain);
  }

  async function savePrivateEntry(recordId, address, password, requesterName) {
    state.privateStore[recordId] = {
      ...(await encryptAddress(address, password)),
      requester_name: requesterName,
      updated_at: new Date().toISOString(),
    };
    persistState();
  }

  function renderRules() {
    const labels = [
      ["프로그램 시작", "7월부터 운영을 시작합니다."],
      ["구매 담당자", "Kristy가 3개월 단위로 구매를 맡고, 이후 분기마다 교체합니다."],
      ["시트 관리", "Saige가 구글 시트 데이터를 관리합니다."],
      ["구매 상태", "구매요청, 구매중, 구매완료, 소장용, 공유 가능으로 구분합니다."],
    ];
    els.rules.innerHTML = labels
      .map(
        ([title, text]) => `
          <article class="rule">
            <div class="title">${escapeHtml(title)}</div>
            <div class="text">${escapeHtml(text)}</div>
          </article>
        `
      )
      .join("");
  }

  function updateHeader() {
    els.currentQuarter.textContent = program.current_quarter || formatQuarter(new Date());
    els.quarterBudget.textContent = money.format(program.quarter_budget || 50000);
    const nextDeadline = program.next_deadline || nextDeadlineText(new Date()).toISOString();
    els.nextDeadline.textContent = formatDeadline(nextDeadline);
    els.deadlineDetail.textContent = program.purchase_deadline || "";
    els.sheetStatus.textContent = program.sheet_status || "연결 준비 중";
    els.sheetLink.href = program.sheet_url || "#";
    els.sheetLink.textContent = program.sheet_url ? "구글 시트 열기" : "시트 연결 준비 중";
    els.purchaseManager.value = program.purchase_manager?.split(" (")[0] || "Kristy";
    els.requestQuarter.value = program.current_quarter || formatQuarter(new Date());
    els.budgetNote.textContent = `개인당 분기 예산은 ${money.format(
      program.quarter_budget || 50000
    )}이며, 같은 분기 내 누적 신청 금액이 이를 넘을 수 없습니다.`;
  }

  function renderStatusbar() {
    const counts = state.records.reduce((acc, record) => {
      const key = record.purchase_status || "구매요청";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    els.statusbar.innerHTML = statusOptions
      .map((status) => `<span class="badge">${escapeHtml(status)} ${counts[status] || 0}</span>`)
      .join("");
  }

  function filteredRecords() {
    const term = state.search.trim().toLowerCase();
    return state.records.filter((record) => {
      const statusMatch = !state.statusFilter || record.purchase_status === state.statusFilter;
      const haystack = [
        record.requester_name,
        record.requester_email,
        record.book_title,
        record.author,
        record.purchase_status,
        record.purchase_manager,
        record.id,
      ]
        .join(" ")
        .toLowerCase();
      const searchMatch = !term || haystack.includes(term);
      return statusMatch && searchMatch;
    });
  }

  function renderRow(record) {
    const unlockedAddress = state.privateById[record.id];
    const addressCell = unlockedAddress
      ? `<strong>${escapeHtml(unlockedAddress)}</strong><small>비밀번호 확인 완료</small>`
      : `<strong>잠금</strong><small>${escapeHtml(record.shipping_address_locked || "비밀번호 입력 후 확인")}</small>`;

    const statusControls = state.managerUnlocked
      ? `
        <div class="row-actions">
          <select class="small" data-field="purchase_status">
            ${statusOptions
              .map(
                (status) =>
                  `<option value="${escapeHtml(status)}" ${
                    record.purchase_status === status ? "selected" : ""
                  }>${escapeHtml(status)}</option>`
              )
              .join("")}
          </select>
          <select class="small" data-field="share_status">
            ${shareOptions
              .map(
                (status) =>
                  `<option value="${escapeHtml(status)}" ${
                    record.share_status === status ? "selected" : ""
                  }>${escapeHtml(status)}</option>`
              )
              .join("")}
          </select>
          <input class="small" data-field="purchase_manager" value="${escapeHtml(
            record.purchase_manager || ""
          )}" />
          <button class="secondary small" data-action="save" type="button">저장</button>
        </div>
      `
      : `<span class="muted">${escapeHtml(record.purchase_status || "-")}</span>`;

    return `
      <tr data-record-id="${escapeHtml(record.id)}">
        <td>
          <strong>${escapeHtml(record.requester_name)}</strong>
          <small>${escapeHtml(record.requester_email)}</small>
          <small class="muted">ID: ${escapeHtml(record.id)}</small>
        </td>
        <td>
          <strong>${escapeHtml(record.book_title)}</strong>
          <small>${escapeHtml(record.author || "")}</small>
          <small>${escapeHtml(record.book_url || "")}</small>
        </td>
        <td>
          <strong>${money.format(Number(record.estimated_amount || 0))}</strong>
          <small>${escapeHtml(record.quarter || "")}</small>
        </td>
        <td>${statusControls}</td>
        <td>
          <strong>${escapeHtml(record.share_status || "")}</strong>
          <small>${escapeHtml(record.urgent_request ? "긴급 요청" : "정상 요청")}</small>
        </td>
        <td>${addressCell}</td>
        <td><strong>${escapeHtml(record.purchase_manager || "")}</strong></td>
        <td>
          <div class="row-actions">
            <button class="secondary small" data-action="unlock" type="button">주소 보기</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderRecords() {
    const rows = filteredRecords();
    els.recordsBody.innerHTML = rows.map(renderRow).join("");
    els.emptyState.classList.toggle("hidden", rows.length !== 0);
  }

  function renderUnlockResult(result) {
    if (result) {
      els.unlockResult.classList.remove("hidden");
      els.unlockResult.innerHTML = `
        <div class="rule">
          <div class="title">개인 배송지 열람 완료</div>
          <div class="text">
            <strong>${escapeHtml(result.requester_name)}</strong>
            <br />
            ${escapeHtml(result.shipping_address)}
          </div>
        </div>
      `;
      return;
    }
    if (Object.keys(state.privateById).length === 0) {
      els.unlockResult.classList.add("hidden");
      els.unlockResult.innerHTML = "";
    }
  }

  function renderAll() {
    updateHeader();
    renderRules();
    renderStatusbar();
    renderRecords();
    renderUnlockResult();
    els.adminLoginBtn.textContent = state.managerUnlocked ? "관리자 모드 해제" : "관리자 모드";
  }

  function initFilters() {
    els.statusFilter.innerHTML = ["<option value=\"\">전체 상태</option>"]
      .concat(statusOptions.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`))
      .join("");
  }

  function syncFilters() {
    state.search = els.search.value;
    state.statusFilter = els.statusFilter.value;
    renderRecords();
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = new FormData(els.requestForm);
    const payload = Object.fromEntries(form.entries());
    const shippingAddress = String(payload.shipping_address || "").trim();
    const password = String(payload.private_password || "").trim();

    if (!shippingAddress || !password) {
      toast("배송지와 비밀번호를 모두 입력하세요.");
      return;
    }

    try {
      const id = randomId();
      const encrypted = await savePrivateEntry(
        id,
        shippingAddress,
        password,
        String(payload.requester_name || "")
      );
      void encrypted;

      const record = normalizeRecord({
        id,
        requester_name: payload.requester_name,
        requester_email: payload.requester_email,
        book_title: payload.book_title,
        author: payload.author,
        book_url: payload.book_url,
        estimated_amount: payload.estimated_amount,
        quarter: els.requestQuarter.value || formatQuarter(new Date()),
        purchase_status: "구매요청",
        share_status: payload.share_status === "on" ? "공유 가능" : "검토중",
        shipping_address_locked: maskAddress(shippingAddress),
        purchase_manager: payload.purchase_manager || "Kristy",
        urgent_request: payload.urgent_request === "on",
        notes: payload.notes,
      });

      state.records.unshift(record);
      persistState();
      els.requestForm.reset();
      els.purchaseManager.value = "Kristy";
      els.requestQuarter.value = program.current_quarter || formatQuarter(new Date());
      toast("신청이 등록되었습니다.");
      renderAll();
    } catch (error) {
      toast(error.message || "신청 등록에 실패했습니다.");
    }
  }

  async function unlockPrivate(recordId, password) {
    const privateEntry = state.privateStore[recordId];
    if (!privateEntry) {
      throw new Error("해당 신청 ID를 찾을 수 없습니다.");
    }
    const shippingAddress = await decryptAddress(privateEntry, password);
    state.privateById[recordId] = shippingAddress;
    els.unlockId.value = recordId;
    els.unlockPassword.value = "";
    toast("배송지를 열람했습니다.");
    renderAll();
    renderUnlockResult({
      requester_name: privateEntry.requester_name || "",
      shipping_address: shippingAddress,
    });
  }

  function saveAdminRow(row) {
    const recordId = row.dataset.recordId;
    const payload = {
      purchase_status: row.querySelector('[data-field="purchase_status"]')?.value || "",
      share_status: row.querySelector('[data-field="share_status"]')?.value || "",
      purchase_manager: row.querySelector('[data-field="purchase_manager"]')?.value || "",
    };
    state.records = state.records.map((item) =>
      item.id === recordId ? { ...item, ...payload } : item
    );
    persistState();
    toast("상태를 저장했습니다.");
    renderAll();
  }

  function exportCSV() {
    const rows = [
      [
        "신청ID",
        "신청자",
        "이메일",
        "도서명",
        "저자",
        "금액",
        "분기",
        "구매상태",
        "공유상태",
        "구매담당자",
        "긴급요청",
        "배송지",
      ],
    ];

    state.records.forEach((record) => {
      const shippingAddress = state.privateById[record.id] || record.shipping_address_locked || "";
      rows.push([
        record.id,
        record.requester_name,
        record.requester_email,
        record.book_title,
        record.author,
        String(record.estimated_amount || 0),
        record.quarter,
        record.purchase_status,
        record.share_status,
        record.purchase_manager,
        record.urgent_request ? "Y" : "N",
        shippingAddress,
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
    toast("CSV를 내려받았습니다.");
  }

  function bindEvents() {
    els.requestForm.addEventListener("submit", submitRequest);
    els.search.addEventListener("input", syncFilters);
    els.statusFilter.addEventListener("change", syncFilters);

    els.unlockBtn.addEventListener("click", async () => {
      const recordId = els.unlockId.value.trim();
      const password = els.unlockPassword.value.trim();
      if (!recordId || !password) {
        toast("신청 ID와 비밀번호를 입력하세요.");
        return;
      }
      try {
        await unlockPrivate(recordId, password);
      } catch (error) {
        toast(error.message || "배송지 열람에 실패했습니다.");
      }
    });

    els.adminLoginBtn.addEventListener("click", () => {
      state.managerUnlocked = !state.managerUnlocked;
      sessionStorage.setItem("bookPurchaseManagerUnlocked", state.managerUnlocked ? "1" : "0");
      toast(state.managerUnlocked ? "관리자 모드가 활성화되었습니다." : "관리자 모드를 해제했습니다.");
      renderAll();
    });

    els.recordsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const row = event.target.closest("tr");
      if (!row) return;
      if (button.dataset.action === "unlock") {
        const recordId = row.dataset.recordId;
        const password = prompt("배송지를 열람할 비밀번호를 입력하세요");
        if (!password) return;
        unlockPrivate(recordId, password).catch((error) => toast(error.message || "열람 실패"));
      }
      if (button.dataset.action === "save") {
        if (!state.managerUnlocked) {
          toast("관리자 모드를 먼저 켜주세요.");
          return;
        }
        saveAdminRow(row);
      }
    });

    els.csvDownload.addEventListener("click", exportCSV);

    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        loadState();
        renderAll();
      }
    });
  }

  function bootstrapStatus() {
    loadState();
    initFilters();
    bindEvents();
    renderAll();
    if (state.managerUnlocked) {
      toast("저장된 관리자 모드가 복원되었습니다.");
    }
  }

  bootstrapStatus();
})();
