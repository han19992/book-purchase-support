(() => {
  const bootstrap = window.__BOOTSTRAP__ || {};
  const program = bootstrap.program || {};
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
    csvLink: document.querySelector('a[href="/api/export.csv"]'),
  };

  const state = {
    records: Array.isArray(bootstrap.records) ? bootstrap.records.slice() : [],
    privateById: {},
    search: "",
    statusFilter: "",
    managerPassword: sessionStorage.getItem("managerPassword") || "",
  };

  const money = new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  });

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

  function updateHeader() {
    els.currentQuarter.textContent = program.current_quarter || "-";
    els.quarterBudget.textContent = money.format(program.quarter_budget || 50000);
    els.nextDeadline.textContent = formatDeadline(program.next_deadline);
    els.deadlineDetail.textContent = program.purchase_deadline || "";
    els.sheetStatus.textContent = program.sheet_status || "미설정";
    els.sheetLink.href = program.sheet_url || "#";
    els.sheetLink.textContent = program.sheet_url ? "구글 시트 열기" : "시트 링크 없음";
    els.purchaseManager.value = program.purchase_manager?.split(" (")[0] || "Kristy";
    els.requestQuarter.value = program.current_quarter || "";
    els.budgetNote.textContent = `개인당 분기 예산은 ${money.format(program.quarter_budget || 50000)}이며, 같은 분기 내 누적 신청 금액이 이를 넘을 수 없습니다.`;
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

    const statusControls = bootstrap.manager_password_set || state.managerPassword
      ? `
          <div class="row-actions">
            <select class="small" data-field="purchase_status">
              ${statusOptions
                .map((status) => `<option value="${escapeHtml(status)}" ${record.purchase_status === status ? "selected" : ""}>${escapeHtml(status)}</option>`)
                .join("")}
            </select>
            <select class="small" data-field="share_status">
              ${shareOptions
                .map((status) => `<option value="${escapeHtml(status)}" ${record.share_status === status ? "selected" : ""}>${escapeHtml(status)}</option>`)
                .join("")}
            </select>
            <input class="small" data-field="purchase_manager" value="${escapeHtml(record.purchase_manager || "")}" />
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

  function renderAll() {
    updateHeader();
    renderRules();
    renderStatusbar();
    renderRecords();
    renderUnlockResult();
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

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || response.statusText || "요청에 실패했습니다.");
    }
    return data;
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = new FormData(els.requestForm);
    const payload = Object.fromEntries(form.entries());
    payload.urgent_request = form.get("urgent_request") === "on";
    payload.share_status = form.get("share_status") === "on";
    try {
      const data = await fetchJSON("/api/request", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.records.unshift(data.record);
      els.requestForm.reset();
      els.purchaseManager.value = program.purchase_manager?.split(" (")[0] || "Kristy";
      els.requestQuarter.value = program.current_quarter || "";
      toast("신청이 등록되었습니다.");
      renderAll();
    } catch (error) {
      toast(error.message);
    }
  }

  async function unlockPrivate(recordId, password) {
    const data = await fetchJSON("/api/unlock", {
      method: "POST",
      body: JSON.stringify({ record_id: recordId, password }),
    });
    state.privateById[data.private.id] = data.private.shipping_address;
    els.unlockId.value = data.private.id;
    els.unlockPassword.value = "";
    toast("배송지를 열람했습니다.");
    renderAll();
    renderUnlockResult(data.private);
  }

  async function saveAdminRow(row) {
    const recordId = row.dataset.recordId;
    const payload = {
      record_id: recordId,
      manager_password: state.managerPassword,
      purchase_status: row.querySelector('[data-field="purchase_status"]')?.value || "",
      share_status: row.querySelector('[data-field="share_status"]')?.value || "",
      purchase_manager: row.querySelector('[data-field="purchase_manager"]')?.value || "",
    };
    const data = await fetchJSON("/api/admin/update", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const updated = data.record;
    state.records = state.records.map((item) => (item.id === updated.id ? updated : item));
    toast("상태를 저장했습니다.");
    renderAll();
  }

  function syncFilters() {
    state.search = els.search.value;
    state.statusFilter = els.statusFilter.value;
    renderRecords();
  }

  function initFilters() {
    els.statusFilter.innerHTML = ["<option value=\"\">전체 상태</option>"]
      .concat(statusOptions.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`))
      .join("");
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
        toast(error.message);
      }
    });

    els.adminLoginBtn.addEventListener("click", () => {
      const password = prompt("관리자 비밀번호를 입력하세요");
      if (!password) return;
      state.managerPassword = password;
      sessionStorage.setItem("managerPassword", password);
      toast("관리자 모드가 활성화되었습니다. 이제 각 행에서 상태를 수정할 수 있습니다.");
      renderAll();
    });

    els.recordsBody.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const row = event.target.closest("tr");
      if (!row) return;
      if (button.dataset.action === "unlock") {
        const recordId = row.dataset.recordId;
        const password = prompt("배송지를 열람할 비밀번호를 입력하세요");
        if (!password) return;
        try {
          await unlockPrivate(recordId, password);
        } catch (error) {
          toast(error.message);
        }
      }
      if (button.dataset.action === "save") {
        if (!state.managerPassword) {
          toast("관리자 비밀번호를 먼저 설정하세요.");
          return;
        }
        try {
          await saveAdminRow(row);
        } catch (error) {
          toast(error.message);
        }
      }
    });

    els.csvLink.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const response = await fetch("/api/export.csv", {
          headers: state.managerPassword ? { "X-Manager-Password": state.managerPassword } : {},
        });
        if (!response.ok) throw new Error("CSV 다운로드에 실패했습니다.");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "book-purchase-support.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast(state.managerPassword ? "전체 CSV를 내려받았습니다." : "마스킹된 CSV를 내려받았습니다.");
      } catch (error) {
        toast(error.message);
      }
    });
  }

  function bootstrapStatus() {
    els.sheetLink.href = program.sheet_url || "#";
    initFilters();
    bindEvents();
    renderAll();
    if (state.managerPassword) {
      toast("저장된 관리자 비밀번호로 모드를 복원했습니다.");
    }
  }

  bootstrapStatus();
})();
