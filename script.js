(() => {
  "use strict";

  const STORAGE_KEY = "nomikai-settlement-v4";
  const LEGACY_STORAGE_KEYS = ["nomikai-settlement-v3", "nomikai-settlement-v2", "nomikai-settlement-v1"];
  const TEMPLATE_KEY = "nomikai-member-template-v1";
  const TEMPLATES_KEY = "nomikai-member-templates-v2";

  const roles = [
    { name: "社長", rate: 3.0 },
    { name: "部長", rate: 2.0 },
    { name: "室長", rate: 2.0 },
    { name: "次長", rate: 1.8 },
    { name: "課長", rate: 1.5 },
    { name: "調査役", rate: 1.3 },
    { name: "一般", rate: 1.0 },
    { name: "パート", rate: 0.5 },
  ];

  const adjustments = [
    { name: "なし", rate: 1.0 },
    { name: "女性", rate: 0.8 },
    { name: "学生", rate: 0.5 },
  ];

  const attendanceAdjustments = [
    { name: "通常", rate: 1.0 },
    { name: "遅刻", rate: 0.9 },
    { name: "早退", rate: 0.9 },
    { name: "遅刻＋早退", rate: 0.8 },
  ];

  const state = {
    schemaVersion: 4,
    paymentMode: "amount",
    eventName: "",
    totalAmount: 0,
    roundUnit: 100,
    adjustmentMode: "organizer",
    organizerId: "",
    members: [],
  };

  const elements = {};
  let latestResult = null;
  let toastTimer = 0;
  let templates = [null, null, null];
  let deletedMember = null;
  let resolveConfirmation = null;
  const lockedStorageKeys = new Set();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    renderCategoryOptions();
    loadState();
    loadTemplates();
    renderAll();
    bindEvents();
  }

  function bindElements() {
    const ids = [
      "backupPreview",
      "backupText",
      "backupInput",
      "restoreBackupText",
      "confirmDialog",
      "confirmMessage",
      "confirmAccept",
      "confirmCancel",
      "paymentMode",
      "paymentHelp",
      "templateSlot",
      "templateName",
      "saveStatus",
      "exportBackup",
      "importBackup",
      "undoBar",
      "undoDelete",
      "newOffset",
      "eventName",
      "totalAmount",
      "roundUnit",
      "adjustmentMode",
      "memberList",
      "memberCount",
      "balanceStatus",
      "newName",
      "newRole",
      "newAdjustment",
      "newAttendance",
      "newRate",
      "newFixed",
      "newOrganizer",
      "addMember",
      "saveTemplate",
      "loadTemplate",
      "summaryTotal",
      "summaryRounded",
      "summaryDifference",
      "calculationNote",
      "resultList",
      "copyLine",
      "saveData",
      "resetData",
      "toast",
    ];

    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    elements.confirmAccept.addEventListener("click", () => finishConfirmation(true));
    elements.confirmCancel.addEventListener("click", () => finishConfirmation(false));
    elements.confirmDialog.addEventListener("cancel", (event) => { event.preventDefault(); finishConfirmation(false); });
    elements.paymentMode.addEventListener("change", () => {
      state.paymentMode = elements.paymentMode.value;
      renderPaymentMode();
      renderMembers();
      renderResults();
      persistQuietly();
    });
    elements.templateSlot.addEventListener("change", renderTemplateSelection);
    elements.undoDelete.addEventListener("click", undoDelete);
    elements.exportBackup.addEventListener("click", exportBackup);
    elements.importBackup.addEventListener("change", importBackup);
    elements.restoreBackupText.addEventListener("click", () => restoreBackup(elements.backupInput.value));
    elements.eventName.addEventListener("input", () => {
      state.eventName = elements.eventName.value.trim();
      persistQuietly();
    });

    elements.totalAmount.addEventListener("input", () => {
      state.totalAmount = readNumber(elements.totalAmount.value);
      renderResults();
      persistQuietly();
    });

    elements.roundUnit.addEventListener("change", () => {
      state.roundUnit = readNumber(elements.roundUnit.value) || 100;
      renderResults();
      persistQuietly();
    });

    elements.adjustmentMode.addEventListener("change", () => {
      state.adjustmentMode = elements.adjustmentMode.value;
      renderResults();
      persistQuietly();
    });

    elements.newRole.addEventListener("change", updateNewRateFromPresets);
    elements.newAdjustment.addEventListener("change", updateNewRateFromPresets);
    elements.newAttendance.addEventListener("change", updateNewRateFromPresets);

    elements.newRate.addEventListener("input", () => {
      elements.newRate.dataset.custom = "true";
    });

    elements.addMember.addEventListener("click", addMember);
    elements.saveTemplate.addEventListener("click", saveMemberTemplate);
    elements.loadTemplate.addEventListener("click", loadMemberTemplate);
    elements.copyLine.addEventListener("click", copyForLine);
    elements.saveData.addEventListener("click", () => {
      showToast(saveState() ? "この端末のブラウザ内に保存しました" : "保存できませんでした。バックアップを保存してください");
    });
    elements.resetData.addEventListener("click", resetData);
  }

  function renderCategoryOptions() {
    const roleOptions = roles
      .map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`)
      .join("");
    const adjustmentOptions = adjustments
      .map((adjustment) => `<option value="${escapeHtml(adjustment.name)}">${escapeHtml(adjustment.name)}</option>`)
      .join("");
    const attendanceOptions = attendanceAdjustments
      .map((attendance) => `<option value="${escapeHtml(attendance.name)}">${escapeHtml(attendance.name)}</option>`)
      .join("");

    elements.newRole.innerHTML = roleOptions;
    elements.newAdjustment.innerHTML = adjustmentOptions;
    elements.newAttendance.innerHTML = attendanceOptions;
    elements.newRole.value = "一般";
    elements.newAdjustment.value = "なし";
    elements.newAttendance.value = "通常";
    elements.newRate.value = "1";
  }

  function renderPaymentMode() {
    elements.paymentMode.value = state.paymentMode;
    document.querySelectorAll(".weighted-setting").forEach((field) => { field.hidden = state.paymentMode !== "weighted"; });
    document.querySelectorAll(".amount-setting").forEach((field) => { field.hidden = state.paymentMode === "weighted"; });
    elements.paymentHelp.textContent = state.paymentMode === "amount"
      ? "上司の金額を固定し、残りを多め・少なめで調整できます。0円を固定すると免除になります。"
      : "以前の倍率設定を引き継いでいます。金額で調整する方式にも切り替えられます。";
  }

  function renderAll() {
    renderPaymentMode();
    renderTemplates();
    elements.eventName.value = state.eventName;
    elements.totalAmount.value = state.totalAmount ? String(state.totalAmount) : "";
    elements.roundUnit.value = String(state.roundUnit);
    elements.adjustmentMode.value = state.adjustmentMode;
    renderMembers();
    renderResults();
  }

  function renderMembers() {
    const openIds = new Set(Array.from(elements.memberList.querySelectorAll(".member-card[open]"), (card) => card.dataset.memberId));
    const focusedInput = document.activeElement;
    const focusedCard = focusedInput && focusedInput.closest(".member-card");
    const focusedId = focusedCard ? focusedCard.dataset.memberId : "";
    const focusedClass = focusedCard ? Array.from(focusedInput.classList).find((name) => name.startsWith("member-")) : "";
    elements.memberCount.textContent = `${state.members.filter((member) => member.included).length}人参加`;
    if (state.members.length === 0) {
      elements.memberList.innerHTML = '<p class="empty-state">参加者を追加すると、ここに一覧が表示されます。</p>';
      return;
    }

    elements.memberList.innerHTML = state.members
      .map((member, index) => {
        const roleOptions = roles
          .map((role) => {
            const selected = role.name === member.role ? " selected" : "";
            return `<option value="${escapeHtml(role.name)}"${selected}>${escapeHtml(role.name)}</option>`;
          })
          .join("");
        const adjustmentOptions = adjustments
          .map((adjustment) => {
            const selected = adjustment.name === member.adjustment ? " selected" : "";
            return `<option value="${escapeHtml(adjustment.name)}"${selected}>${escapeHtml(adjustment.name)}</option>`;
          })
          .join("");
        const attendanceOptions = attendanceAdjustments
          .map((attendance) => {
            const selected = attendance.name === member.attendance ? " selected" : "";
            return `<option value="${escapeHtml(attendance.name)}"${selected}>${escapeHtml(attendance.name)}</option>`;
          })
          .join("");
        const organizerChecked = member.id === state.organizerId ? " checked" : "";

        return `
          <details class="member-card" data-member-id="${escapeHtml(member.id)}"${openIds.has(String(member.id)) ? " open" : ""}>
            <summary class="member-summary">
              <span class="member-summary-main">
                <span class="member-summary-name">${escapeHtml(member.name || "名無し")}</span>
                <span class="member-summary-meta">${escapeHtml(member.role)}</span>
              </span>
              <span class="member-summary-payment">
                <strong class="member-summary-amount">—</strong>
                <span class="member-edit-hint">編集 <span aria-hidden="true">⌄</span></span>
              </span>
            </summary>
          <div class="member-row" data-index="${index}">
            <label class="check-field"><input class="member-included" type="checkbox"${member.included ? " checked" : ""}><span>今回参加する</span></label>
            <label class="field">
              <span>名前</span>
              <input class="member-name" type="text" autocomplete="off" value="${escapeHtml(member.name)}">
            </label>
            <label class="field">
              <span>役職</span>
              <select class="member-role">${roleOptions}</select>
            </label>
            <label class="field weighted-setting"${state.paymentMode === "weighted" ? "" : " hidden"}>
              <span>調整</span>
              <select class="member-adjustment">${adjustmentOptions}</select>
            </label>
            <label class="field weighted-setting"${state.paymentMode === "weighted" ? "" : " hidden"}>
              <span>参加状況</span>
              <select class="member-attendance">${attendanceOptions}</select>
            </label>
            <label class="field small-member-field weighted-setting"${state.paymentMode === "weighted" ? "" : " hidden"}>
              <span>倍率</span>
              <input class="member-rate" type="number" inputmode="decimal" min="0" step="0.1" value="${formatInputNumber(member.rate)}">
            </label>
            <label class="field small-member-field">
              <span>金額を固定（0円＝免除）</span>
              <input class="member-fixed" type="number" inputmode="numeric" min="0" step="1" value="${member.fixedAmount === null ? "" : member.fixedAmount}" placeholder="空欄は自動計算">
            </label>
            <label class="field offset-field amount-setting"${state.paymentMode === "weighted" ? " hidden" : ""}>
              <span>多め・少なめの差（円）</span>
              <input class="member-offset" type="number" inputmode="decimal" step="500" value="${member.offset}"${member.fixedAmount !== null ? " disabled" : ""}>
              <span class="offset-hint">丸め前の基準額との差。希望額を決めるときは金額を固定。</span>
            </label>
            <div class="amount-stepper amount-setting"${state.paymentMode === "weighted" ? " hidden" : ""}>
              <button class="member-less secondary-button" type="button"${member.fixedAmount !== null ? " disabled" : ""}>差を−500円</button>
              <button class="member-more secondary-button" type="button"${member.fixedAmount !== null ? " disabled" : ""}>差を＋500円</button>
            </div>
            <label class="organizer-choice">
              <input class="member-organizer" type="radio" name="organizer"${organizerChecked}>
              <span>幹事</span>
            </label>
            <button class="delete-button" type="button" aria-label="${escapeHtml(member.name)}を削除">参加者を削除</button>
          </div>
          </details>
        `;
      })
      .join("");

    elements.memberList.querySelectorAll(".member-row").forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector(".member-included").addEventListener("change", (event) => {
        state.members[index].included = event.target.checked;
        renderMembers();
        renderResults();
        persistQuietly();
      });
      row.querySelector(".member-offset").addEventListener("input", (event) => {
        state.members[index].offset = readNumber(event.target.value);
        renderResults();
        persistQuietly();
      });
      for (const [selector, delta] of [[".member-less", -500], [".member-more", 500]]) {
        row.querySelector(selector).addEventListener("click", () => {
          state.members[index].offset += delta;
          renderMembers();
          renderResults();
          persistQuietly();
        });
      }
      row.querySelector(".member-name").addEventListener("input", (event) => {
        state.members[index].name = event.target.value.trim();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-role").addEventListener("change", (event) => {
        state.members[index].role = event.target.value;
        if (!state.members[index].customRate) state.members[index].rate = getCombinedRate(state.members[index].role, state.members[index].adjustment, state.members[index].attendance);
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-adjustment").addEventListener("change", (event) => {
        state.members[index].adjustment = event.target.value;
        if (!state.members[index].customRate) state.members[index].rate = getCombinedRate(state.members[index].role, state.members[index].adjustment, state.members[index].attendance);
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-attendance").addEventListener("change", (event) => {
        state.members[index].attendance = event.target.value;
        if (!state.members[index].customRate) state.members[index].rate = getCombinedRate(state.members[index].role, state.members[index].adjustment, state.members[index].attendance);
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-organizer").addEventListener("change", () => {
        state.organizerId = state.members[index].id;
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-rate").addEventListener("input", (event) => {
        state.members[index].rate = readNumber(event.target.value);
        state.members[index].customRate = true;
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-fixed").addEventListener("input", (event) => {
        state.members[index].fixedAmount = readOptionalAmount(event.target.value);
        const fixed = state.members[index].fixedAmount !== null;
        row.querySelector(".member-offset").disabled = fixed;
        row.querySelector(".member-less").disabled = fixed;
        row.querySelector(".member-more").disabled = fixed;
        renderResults();
        persistQuietly();
      });

      row.querySelector(".delete-button").addEventListener("click", () => {
        const removed = state.members.splice(index, 1)[0];
        deletedMember = { member: removed, index, wasOrganizer: removed.id === state.organizerId };
        elements.undoBar.hidden = false;
        if (removed && removed.id === state.organizerId) {
          state.organizerId = "";
        }
        renderMembers();
        renderResults();
        persistQuietly();
      });
    });

    if (focusedId && focusedClass) {
      const card = Array.from(elements.memberList.querySelectorAll(".member-card")).find((item) => item.dataset.memberId === focusedId);
      if (card) card.querySelector(`.${focusedClass}`).focus({ preventScroll: true });
    }
  }

  function addMember() {
    const name = elements.newName.value.trim();
    const roleName = elements.newRole.value;
    const adjustmentName = elements.newAdjustment.value;
    const attendanceName = elements.newAttendance.value;
    const rate = elements.newRate.value === "" ? getCombinedRate(roleName, adjustmentName, attendanceName) : readNumber(elements.newRate.value);
    const fixedAmount = readOptionalAmount(elements.newFixed.value);
    const isOrganizer = elements.newOrganizer.checked;

    if (!name) {
      showToast("名前を入力してください");
      elements.newName.focus();
      return;
    }

    state.members.push({
      id: createId(),
      name,
      role: roleName,
      adjustment: adjustmentName,
      attendance: attendanceName,
      rate,
      fixedAmount,
      offset: readNumber(elements.newOffset.value),
      included: true,
      customRate: elements.newRate.dataset.custom === "true",
    });

    if (isOrganizer) {
      state.organizerId = state.members[state.members.length - 1].id;
    }

    elements.newName.value = "";
    elements.newFixed.value = "";
    elements.newOffset.value = "0";
    elements.newOrganizer.checked = false;
    elements.newRate.dataset.custom = "";
    updateNewRateFromPresets();
    elements.newName.focus();

    renderMembers();
    renderResults();
    persistQuietly();
  }

  function renderResults() {
    latestResult = calculatePayments();

    elements.summaryTotal.textContent = yen(state.totalAmount);
    elements.summaryRounded.textContent = yen(latestResult.finalTotal);
    elements.summaryDifference.textContent = signedYen(latestResult.difference);
    elements.calculationNote.textContent = latestResult.note;

    const issue = getCopyIssue();
    elements.copyLine.disabled = Boolean(issue);
    elements.balanceStatus.textContent = issue || `${latestResult.activeCount}人 · 合計 ${yen(latestResult.finalTotal)} · 差額なし`;
    elements.balanceStatus.classList.toggle("has-difference", latestResult.difference !== 0);

    elements.memberList.querySelectorAll(".member-card").forEach((card, index) => {
      const row = latestResult.rows[index];
      if (!row) return;
      card.querySelector(".member-summary-name").textContent = row.name;
      card.classList.toggle("is-excluded", !row.included);
      card.querySelector(".member-summary-meta").textContent = [row.role, row.isOrganizer ? "幹事" : "", row.isFixed ? (row.fixedAmount === 0 ? "免除" : "金額固定") : (state.paymentMode === "amount" && row.offset ? signedYen(row.offset) : "自動計算")].filter(Boolean).join(" · ");
      card.querySelector(".member-summary-amount").textContent = !row.included ? "不参加" : (state.totalAmount > 0 ? yen(row.finalAmount) : "—");
    });

    if (latestResult.rows.length === 0) {
      elements.resultList.innerHTML = '<p class="empty-state">参加者と総額を入れると自動計算します。</p>';
      return;
    }

    elements.resultList.innerHTML = latestResult.rows.filter((row) => row.included)
      .map((row) => {
        const fixedLabel = row.isFixed ? (row.fixedAmount === 0 ? "免除" : "金額固定") : (state.paymentMode === "amount" ? (row.offset ? signedYen(row.offset) : "自動計算") : `${formatInputNumber(row.rate)}倍`);
        const adjustmentLabel = state.paymentMode !== "weighted" || row.adjustment === "なし" ? "" : ` / ${escapeHtml(row.adjustment)}`;
        const attendanceLabel = state.paymentMode !== "weighted" || row.attendance === "通常" ? "" : ` / ${escapeHtml(row.attendance)}`;
        const organizerLabel = row.isOrganizer ? "幹事" : "";
        return `
          <div class="result-row">
            <div>
              <span class="result-name">${escapeHtml(row.name)}${organizerLabel ? `<span class="organizer-badge">${organizerLabel}</span>` : ""}</span>
              <span class="result-meta">${escapeHtml(row.role)}${adjustmentLabel}${attendanceLabel} / ${fixedLabel}</span>
            </div>
            <strong class="result-amount">${yen(row.finalAmount)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function calculatePayments() {
    return NomikaiSettlement.calculate(state);
  }

  function getCopyIssue() {
    if (!latestResult || latestResult.rows.length === 0 || state.totalAmount <= 0) {
      return "参加者と総額を入力してください";
    }
    if (latestResult.error) return latestResult.error;
    if (!Number.isSafeInteger(state.totalAmount) || latestResult.rows.some((row) => !Number.isSafeInteger(row.finalAmount))) {
      return "金額は整数の円で入力してください";
    }
    if (latestResult.fixedTotal > state.totalAmount) return "固定額の合計が総額を超えています";
    if (latestResult.difference > 0) return `あと ${yen(latestResult.difference)} 不足しています`;
    if (latestResult.difference < 0) return `${yen(-latestResult.difference)} 多く集める計算です`;
    return "";
  }

  function copyForLine() {
    const issue = getCopyIssue();
    if (issue) {
      showToast(issue);
      return;
    }

    const title = state.eventName ? `【${state.eventName} 清算】` : "【飲み会清算】";
    const lines = latestResult.rows.filter((row) => row.included).map((row) => `${row.name}${row.isOrganizer ? "（幹事）" : ""}　${yen(row.finalAmount)}`);
    const text = [title, "", ...lines, "", `合計：${yen(latestResult.finalTotal)}`].join("\n");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("LINE用にコピーしました"))
        .catch(() => fallbackCopy(text));
      return;
    }

    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const copied = document.execCommand("copy");
      showToast(copied ? "LINE用にコピーしました" : "コピーできませんでした");
    } catch {
      showToast("コピーできませんでした");
    } finally {
      textarea.remove();
    }
  }

  function confirmAction(message, label = "置き換える") {
    elements.confirmAccept.textContent = label;
    if (resolveConfirmation) return Promise.resolve(false);
    elements.confirmMessage.textContent = message;
    elements.confirmDialog.showModal();
    elements.confirmCancel.focus();
    return new Promise((resolve) => { resolveConfirmation = resolve; });
  }

  function finishConfirmation(accepted) {
    elements.confirmDialog.close();
    if (resolveConfirmation) resolveConfirmation(accepted);
    resolveConfirmation = null;
  }

  function setSaveStatus(message, failed = false) {
    elements.saveStatus.textContent = message;
    elements.saveStatus.classList.toggle("save-failed", failed);
  }

  function storageRead(key) {
    try { return localStorage.getItem(key); }
    catch { setSaveStatus("端末保存が利用できません。バックアップを保存してください。", true); return null; }
  }

  function storageWrite(key, data) {
    if (lockedStorageKeys.has(key)) {
      setSaveStatus("読み込めない保存データを保護しています。バックアップを保存してください。", true);
      return false;
    }
    try { localStorage.setItem(key, JSON.stringify(data)); return true; }
    catch { setSaveStatus("端末保存に失敗しました。バックアップを保存してください。", true); return false; }
  }

  function saveState() {
    const ok = storageWrite(STORAGE_KEY, state);
    if (ok) setSaveStatus(lockedStorageKeys.size ? "読み込めないテンプレを保護しています。バックアップを保存してください。" : "このブラウザに自動保存済み", lockedStorageKeys.size > 0);
    return ok;
  }

  function renderTemplates() {
    const selected = elements.templateSlot.value || "0";
    elements.templateSlot.innerHTML = templates.map((slot, index) =>
      `<option value="${index}">${index + 1}：${slot ? `${escapeHtml(slot.name)}（${slot.members.length}人）` : "未保存"}</option>`).join("");
    elements.templateSlot.value = selected;
    renderTemplateSelection();
  }

  function renderTemplateSelection() {
    const slot = templates[Number(elements.templateSlot.value)];
    elements.templateName.value = slot ? slot.name : "";
    elements.loadTemplate.disabled = !slot;
  }

  async function saveMemberTemplate() {
    if (!state.members.length) { showToast("保存する参加者がいません"); return; }
    const index = Number(elements.templateSlot.value);
    const name = elements.templateName.value.trim() || `テンプレ${index + 1}`;
    if (templates[index] && !await confirmAction(`「${templates[index].name}」を今の参加者で上書きしますか？`, "上書きする")) return;
    const next = templates.slice();
    next[index] = {
      schemaVersion: 4, name, paymentMode: state.paymentMode,
      organizerId: state.organizerId,
      members: state.members.map(resetTemplateMember),
    };
    if (!storageWrite(TEMPLATES_KEY, { schemaVersion: 4, slots: next })) { showToast("テンプレを保存できませんでした"); return; }
    templates = next;
    renderTemplates();
    showToast(`「${name}」を保存しました`);
  }

  async function loadMemberTemplate() {
    const slot = templates[Number(elements.templateSlot.value)];
    if (!slot) { showToast("この枠にテンプレがありません"); return; }
    if (state.members.length && !await confirmAction(`今の参加者を「${slot.name}」に置き換えますか？総額とイベント名は残ります。`, "呼び出す")) return;
    const members = slot.members.map((member) => ({ ...resetTemplateMember(member), id: createId() }));
    const organizerIndex = slot.members.findIndex((member) => member.id === slot.organizerId);
    state.members = members;
    state.organizerId = members[organizerIndex] ? members[organizerIndex].id : "";
    state.paymentMode = slot.paymentMode;
    clearUndo();
    renderAll();
    persistQuietly();
    showToast(`「${slot.name}」を呼び出しました`);
  }

  function readStateData(parsed) {
    if (!parsed || !Array.isArray(parsed.members) || parsed.members.length > 1000) throw new Error("invalid data");
    const legacy = parsed.schemaVersion !== 4;
    const members = parsed.members.map((member) => normalizeMember(member, legacy));
    const seen = new Set();
    members.forEach((member) => { if (seen.has(member.id)) member.id = createId(); seen.add(member.id); });
    return {
      schemaVersion: 4,
      eventName: String(parsed.eventName || "").slice(0, 120),
      totalAmount: Number(parsed.totalAmount) || 0,
      roundUnit: [1, 10, 100, 500, 1000].includes(Number(parsed.roundUnit)) ? Number(parsed.roundUnit) : 100,
      paymentMode: ["amount", "weighted"].includes(parsed.paymentMode) ? parsed.paymentMode : (legacy ? "weighted" : "amount"),
      adjustmentMode: ["organizer", "top", "all"].includes(parsed.adjustmentMode) ? parsed.adjustmentMode : "organizer",
      organizerId: members.some((member) => member.id === parsed.organizerId) ? parsed.organizerId : "",
      members,
    };
  }

  function resetTemplateMember(member) {
    return { ...member, included: true, attendance: "通常",
      rate: member.customRate ? member.rate : getCombinedRate(member.role, member.adjustment, "通常") };
  }

  function readTemplateData(parsed) {
    if (!parsed || !Array.isArray(parsed.slots) || parsed.slots.length > 3) throw new Error("invalid templates");
    return Array.from({ length: 3 }, (_, index) => {
      const slot = parsed.slots[index];
      if (!slot) return null;
      const normalized = readStateData(slot);
      return { schemaVersion: 4, name: String(slot.name || `テンプレ${index + 1}`).slice(0, 80),
        paymentMode: normalized.paymentMode, organizerId: normalized.organizerId,
        members: normalized.members.map(resetTemplateMember) };
    });
  }

  function loadTemplates() {
    const saved = storageRead(TEMPLATES_KEY);
    if (saved) {
      try { templates = readTemplateData(JSON.parse(saved)); }
      catch { lockedStorageKeys.add(TEMPLATES_KEY); setSaveStatus("テンプレを読み込めません。元データは保持しています。", true); }
      return;
    }
    const legacy = storageRead(TEMPLATE_KEY);
    if (!legacy) return;
    try {
      const old = JSON.parse(legacy);
      templates = readTemplateData({ slots: [{ ...old, name: "以前のテンプレ" }] });
    } catch { setSaveStatus("以前のテンプレを読み込めません。元データは保持しています。", true); }
  }

  function persistQuietly() { saveState(); }

  function loadState() {
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      const saved = storageRead(key);
      if (!saved) continue;
      try { Object.assign(state, readStateData(JSON.parse(saved))); }
      catch { lockedStorageKeys.add(STORAGE_KEY); setSaveStatus("保存データを読み込めません。元データは保持しています。", true); }
      return;
    }
  }

  function clearUndo() { deletedMember = null; elements.undoBar.hidden = true; }

  function undoDelete() {
    if (!deletedMember) return;
    const { member, index, wasOrganizer } = deletedMember;
    state.members.splice(Math.min(index, state.members.length), 0, member);
    if (wasOrganizer && !state.organizerId) state.organizerId = member.id;
    clearUndo();
    renderMembers();
    renderResults();
    persistQuietly();
    showToast("参加者の削除を取り消しました");
  }

  async function resetData() {
    if (!await confirmAction("今回の入力をリセットしますか？3つのテンプレは残ります。", "リセットする")) return;
    Object.assign(state, { schemaVersion: 4, eventName: "", totalAmount: 0, roundUnit: 100,
      paymentMode: "amount", adjustmentMode: "organizer", organizerId: "", members: [] });
    lockedStorageKeys.delete(STORAGE_KEY);
    clearUndo();
    renderAll();
    showToast(saveState() ? "今回の入力をリセットしました" : "入力をリセットしましたが、端末保存に失敗しました");
  }

  function exportBackup() {
    const backup = { kind: "nomikai-backup", schemaVersion: 1, exportedAt: new Date().toISOString(),
      state, templates: { schemaVersion: 4, slots: templates },
      unreadable: Array.from(lockedStorageKeys, (key) => ({ key, raw: storageRead(key) })),
      legacyState: LEGACY_STORAGE_KEYS.map((key) => ({ key, raw: storageRead(key) })).filter((entry) => entry.raw),
      legacyTemplate: storageRead(TEMPLATE_KEY) };
    const text = JSON.stringify(backup, null, 2);
    elements.backupText.value = text;
    elements.backupPreview.hidden = false;
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.href = url;
    link.download = "nomikai-backup.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast("バックアップの保存先を確認してください");
  }

  async function importBackup() {
    const file = elements.importBackup.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("too large");
      await restoreBackup(await file.text());
    } catch { showToast("このバックアップは読み込めませんでした。入力内容は保持しています"); }
    finally { elements.importBackup.value = ""; }
  }

  async function restoreBackup(text) {
    try {
      if (!text || text.length > 2 * 1024 * 1024) throw new Error("invalid size");
      const parsed = JSON.parse(text);
      if (parsed.kind !== "nomikai-backup" || parsed.schemaVersion !== 1) throw new Error("invalid backup");
      const restored = readStateData(parsed.state);
      const restoredTemplates = readTemplateData(parsed.templates);
      if (!await confirmAction("現在の入力と3つのテンプレをバックアップの内容に置き換えますか？", "復元する")) return;
      Object.assign(state, restored);
      templates = restoredTemplates;
      lockedStorageKeys.clear();
      clearUndo();
      renderAll();
      const templateOk = storageWrite(TEMPLATES_KEY, { schemaVersion: 4, slots: templates });
      const stateOk = saveState();
      if (!templateOk) setSaveStatus("テンプレの保存に失敗しました。バックアップを保持してください。", true);
      showToast(templateOk && stateOk ? "バックアップを復元しました" : "画面に復元しましたが、端末保存に失敗しました");
    } catch { showToast("このバックアップは読み込めませんでした。入力内容は保持しています"); }
  }

  function updateNewRateFromPresets() {
    if (elements.newRate.dataset.custom === "true") return;
    elements.newRate.value = formatInputNumber(getCombinedRate(elements.newRole.value, elements.newAdjustment.value, elements.newAttendance.value));
  }

  function getCombinedRate(roleName, adjustmentName, attendanceName) {
    const role = findRole(roleName);
    const adjustment = findAdjustment(adjustmentName);
    const attendance = findAttendance(attendanceName);
    return roundRate((role ? role.rate : 1) * (adjustment ? adjustment.rate : 1) * (attendance ? attendance.rate : 1));
  }

  function findRole(name) {
    return roles.find((role) => role.name === name);
  }

  function findAdjustment(name) {
    return adjustments.find((adjustment) => adjustment.name === name);
  }

  function findAttendance(name) {
    return attendanceAdjustments.find((attendance) => attendance.name === name);
  }

  function normalizeMember(member, legacy = false) {
    if (!member || typeof member !== "object") throw new Error("invalid member");
    const legacyCategory = member.category;
    const role = normalizeRole(member.role || legacyCategory);
    const adjustment = normalizeAdjustment(member.adjustment || legacyCategory);
    const attendance = normalizeAttendance(member.attendance);
    const preset = getCombinedRate(role, adjustment, attendance);
    const savedRate = Number(member.rate);
    const hasRate = member.rate !== null && member.rate !== undefined && member.rate !== "";
    const rate = hasRate && Number.isFinite(savedRate) && savedRate >= 0 ? savedRate : preset;
    let fixedAmount = readOptionalAmount(member.fixedAmount);
    if (legacy && !(fixedAmount > 0)) fixedAmount = rate === 0 ? 0 : null;
    return {
      id: String(member.id || createId()), name: String(member.name || ""), role, adjustment, attendance,
      rate, fixedAmount, offset: Number(member.offset) || 0, included: member.included !== false,
      customRate: typeof member.customRate === "boolean" ? member.customRate : Math.abs(rate - preset) > 0.000001,
    };
  }

  function readOptionalAmount(value) {
    return value === null || value === undefined || value === "" ? null : Number(value);
  }

  function normalizeRole(value) {
    return findRole(value) ? value : "一般";
  }

  function normalizeAdjustment(value) {
    if (value === "パート") return "なし";
    return findAdjustment(value) ? value : "なし";
  }

  function normalizeAttendance(value) {
    return findAttendance(value) ? value : "通常";
  }

  function roundRate(value) {
    return Math.round(value * 100) / 100;
  }

  function readNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function yen(amount) {
    return `${Math.round(amount).toLocaleString("ja-JP")}円`;
  }

  function signedYen(amount) {
    const rounded = Math.round(amount);
    if (rounded === 0) return "0円";
    return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toLocaleString("ja-JP")}円`;
  }

  function formatInputNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Number.isInteger(number) ? String(number) : String(number);
  }

  function createId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2200);
  }
})();
