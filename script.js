(() => {
  "use strict";

  const STORAGE_KEY = "nomikai-settlement-v2";
  const LEGACY_STORAGE_KEY = "nomikai-settlement-v1";

  const roles = [
    { name: "社長", rate: 3.0 },
    { name: "部長", rate: 2.0 },
    { name: "室長", rate: 2.0 },
    { name: "次長", rate: 1.8 },
    { name: "課長", rate: 1.5 },
    { name: "調査役", rate: 1.3 },
    { name: "一般", rate: 1.0 },
  ];

  const adjustments = [
    { name: "なし", rate: 1.0 },
    { name: "女性", rate: 0.8 },
    { name: "パート", rate: 0.5 },
    { name: "学生", rate: 0.5 },
  ];

  const state = {
    eventName: "",
    totalAmount: 0,
    roundUnit: 100,
    adjustmentMode: "organizer",
    members: [],
  };

  const elements = {};
  let latestResult = null;
  let toastTimer = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    renderCategoryOptions();
    loadState();
    renderAll();
    bindEvents();
  }

  function bindElements() {
    const ids = [
      "eventName",
      "totalAmount",
      "roundUnit",
      "adjustmentMode",
      "memberList",
      "newName",
      "newRole",
      "newAdjustment",
      "newRate",
      "newFixed",
      "addMember",
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

    elements.newRate.addEventListener("input", () => {
      elements.newRate.dataset.custom = "true";
    });

    elements.addMember.addEventListener("click", addMember);
    elements.copyLine.addEventListener("click", copyForLine);
    elements.saveData.addEventListener("click", () => {
      saveState();
      showToast("保存しました");
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

    elements.newRole.innerHTML = roleOptions;
    elements.newAdjustment.innerHTML = adjustmentOptions;
    elements.newRole.value = "一般";
    elements.newAdjustment.value = "なし";
    elements.newRate.value = "1";
  }

  function renderAll() {
    elements.eventName.value = state.eventName;
    elements.totalAmount.value = state.totalAmount ? String(state.totalAmount) : "";
    elements.roundUnit.value = String(state.roundUnit);
    elements.adjustmentMode.value = state.adjustmentMode;
    renderMembers();
    renderResults();
  }

  function renderMembers() {
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

        return `
          <div class="member-row" data-index="${index}">
            <label class="field">
              <span>名前</span>
              <input class="member-name" type="text" autocomplete="off" value="${escapeHtml(member.name)}">
            </label>
            <label class="field">
              <span>役職</span>
              <select class="member-role">${roleOptions}</select>
            </label>
            <label class="field">
              <span>調整</span>
              <select class="member-adjustment">${adjustmentOptions}</select>
            </label>
            <label class="field small-member-field">
              <span>倍率</span>
              <input class="member-rate" type="number" inputmode="decimal" min="0" step="0.1" value="${formatInputNumber(member.rate)}">
            </label>
            <label class="field small-member-field">
              <span>固定額</span>
              <input class="member-fixed" type="number" inputmode="numeric" min="0" step="1" value="${member.fixedAmount || ""}" placeholder="任意">
            </label>
            <button class="delete-button" type="button" aria-label="${escapeHtml(member.name)}を削除">×</button>
          </div>
        `;
      })
      .join("");

    elements.memberList.querySelectorAll(".member-row").forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector(".member-name").addEventListener("input", (event) => {
        state.members[index].name = event.target.value.trim();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-role").addEventListener("change", (event) => {
        state.members[index].role = event.target.value;
        state.members[index].rate = getCombinedRate(state.members[index].role, state.members[index].adjustment);
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-adjustment").addEventListener("change", (event) => {
        state.members[index].adjustment = event.target.value;
        state.members[index].rate = getCombinedRate(state.members[index].role, state.members[index].adjustment);
        renderMembers();
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-rate").addEventListener("input", (event) => {
        state.members[index].rate = readNumber(event.target.value);
        renderResults();
        persistQuietly();
      });

      row.querySelector(".member-fixed").addEventListener("input", (event) => {
        state.members[index].fixedAmount = readNumber(event.target.value);
        renderResults();
        persistQuietly();
      });

      row.querySelector(".delete-button").addEventListener("click", () => {
        state.members.splice(index, 1);
        renderMembers();
        renderResults();
        persistQuietly();
      });
    });
  }

  function addMember() {
    const name = elements.newName.value.trim();
    const roleName = elements.newRole.value;
    const adjustmentName = elements.newAdjustment.value;
    const rate = readNumber(elements.newRate.value) || getCombinedRate(roleName, adjustmentName);
    const fixedAmount = readNumber(elements.newFixed.value);

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
      rate,
      fixedAmount,
    });

    elements.newName.value = "";
    elements.newFixed.value = "";
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

    if (latestResult.rows.length === 0) {
      elements.resultList.innerHTML = '<p class="empty-state">参加者と総額を入れると自動計算します。</p>';
      return;
    }

    elements.resultList.innerHTML = latestResult.rows
      .map((row) => {
        const fixedLabel = row.isFixed ? "固定額" : `${formatInputNumber(row.rate)}倍`;
        const adjustmentLabel = row.adjustment === "なし" ? "" : ` / ${escapeHtml(row.adjustment)}`;
        return `
          <div class="result-row">
            <div>
              <span class="result-name">${escapeHtml(row.name)}</span>
              <span class="result-meta">${escapeHtml(row.role)}${adjustmentLabel} / ${fixedLabel}</span>
            </div>
            <strong class="result-amount">${yen(row.finalAmount)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function calculatePayments() {
    const total = Math.max(0, state.totalAmount);
    const roundUnit = Math.max(1, state.roundUnit);
    const members = state.members.map((member) => ({
      ...member,
      name: member.name || "名無し",
      role: normalizeRole(member.role || member.category),
      adjustment: normalizeAdjustment(member.adjustment || member.category),
      rate: Math.max(0, Number(member.rate) || 0),
      fixedAmount: Math.max(0, Number(member.fixedAmount) || 0),
    }));

    const fixedTotal = members.reduce((sum, member) => sum + member.fixedAmount, 0);
    const variableMembers = members.filter((member) => member.fixedAmount <= 0);
    const rateTotal = variableMembers.reduce((sum, member) => sum + member.rate, 0);
    const remaining = Math.max(0, total - fixedTotal);
    const unitPrice = rateTotal > 0 ? remaining / rateTotal : 0;

    // 固定額の人は倍率配分から外し、それ以外の人だけで残額を分けます。
    const rows = members.map((member) => {
      const rawAmount = member.fixedAmount > 0 ? member.fixedAmount : member.rate * unitPrice;
      return {
        ...member,
        isFixed: member.fixedAmount > 0,
        rawAmount,
        roundedAmount: ceilBy(rawAmount, roundUnit),
        finalAmount: ceilBy(rawAmount, roundUnit),
      };
    });

    const roundedTotal = rows.reduce((sum, row) => sum + row.roundedAmount, 0);
    const adjustment = total - roundedTotal;
    let note = "";

    // 切り上げ後に出た差額を、選択された運用ルールに合わせて処理します。
    if (rows.length === 0 || total === 0) {
      note = "総額と参加者を入れると、支払額がここに表示されます。";
    } else if (fixedTotal > total) {
      note = "固定額の合計が総額を超えています。固定額を確認してください。";
    } else if (state.adjustmentMode === "organizer") {
      note = `丸め差額 ${signedYen(total - roundedTotal)} は幹事側で調整します。`;
    } else if (state.adjustmentMode === "top") {
      applyTopAdjustment(rows, adjustment);
      note = "丸め差額は最も倍率が高い参加者で調整しています。";
    } else {
      applyEvenAdjustment(rows, adjustment);
      note = "丸め差額は全員で均等に調整しています。";
    }

    const finalTotal = rows.reduce((sum, row) => sum + row.finalAmount, 0);

    return {
      rows,
      fixedTotal,
      roundedTotal,
      finalTotal,
      difference: total - finalTotal,
      note,
    };
  }

  function applyTopAdjustment(rows, adjustment) {
    if (rows.length === 0 || adjustment === 0) return;

    const target = rows.reduce((best, row) => {
      if (!best) return row;
      if (row.rate > best.rate) return row;
      return best;
    }, null);

    target.finalAmount = Math.max(0, target.finalAmount + adjustment);
  }

  function applyEvenAdjustment(rows, adjustment) {
    if (rows.length === 0 || adjustment === 0) return;

    const base = Math.trunc(adjustment / rows.length);
    let remainder = adjustment - base * rows.length;

    rows.forEach((row) => {
      row.finalAmount = Math.max(0, row.finalAmount + base);
      if (remainder !== 0) {
        const step = remainder > 0 ? 1 : -1;
        row.finalAmount = Math.max(0, row.finalAmount + step);
        remainder -= step;
      }
    });
  }

  function copyForLine() {
    if (!latestResult || latestResult.rows.length === 0) {
      showToast("コピーする結果がありません");
      return;
    }

    const title = state.eventName ? `【${state.eventName} 清算】` : "【飲み会清算】";
    const lines = latestResult.rows.map((row) => `${row.name}　${yen(row.finalAmount)}`);
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
      document.execCommand("copy");
      showToast("LINE用にコピーしました");
    } catch {
      showToast("コピーできませんでした");
    } finally {
      textarea.remove();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function persistQuietly() {
    saveState();
  }

  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      state.eventName = parsed.eventName || "";
      state.totalAmount = Number(parsed.totalAmount) || 0;
      state.roundUnit = Number(parsed.roundUnit) || 100;
      state.adjustmentMode = parsed.adjustmentMode || "organizer";
      state.members = Array.isArray(parsed.members) ? parsed.members.map(normalizeMember) : [];
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function resetData() {
    const ok = window.confirm("入力内容をリセットしますか？");
    if (!ok) return;

    state.eventName = "";
    state.totalAmount = 0;
    state.roundUnit = 100;
    state.adjustmentMode = "organizer";
    state.members = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    renderAll();
    showToast("リセットしました");
  }

  function updateNewRateFromPresets() {
    if (elements.newRate.dataset.custom === "true") return;
    elements.newRate.value = formatInputNumber(getCombinedRate(elements.newRole.value, elements.newAdjustment.value));
  }

  function getCombinedRate(roleName, adjustmentName) {
    const role = findRole(roleName);
    const adjustment = findAdjustment(adjustmentName);
    return roundRate((role ? role.rate : 1) * (adjustment ? adjustment.rate : 1));
  }

  function findRole(name) {
    return roles.find((role) => role.name === name);
  }

  function findAdjustment(name) {
    return adjustments.find((adjustment) => adjustment.name === name);
  }

  function normalizeMember(member) {
    const role = normalizeRole(member.role || member.category);
    const adjustment = normalizeAdjustment(member.adjustment || member.category);
    const savedRate = Number(member.rate);

    return {
      id: member.id || createId(),
      name: member.name || "",
      role,
      adjustment,
      rate: Number.isFinite(savedRate) && savedRate > 0 ? savedRate : getCombinedRate(role, adjustment),
      fixedAmount: Math.max(0, Number(member.fixedAmount) || 0),
    };
  }

  function normalizeRole(value) {
    return findRole(value) ? value : "一般";
  }

  function normalizeAdjustment(value) {
    return findAdjustment(value) ? value : "なし";
  }

  function roundRate(value) {
    return Math.round(value * 100) / 100;
  }

  function readNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function ceilBy(amount, unit) {
    if (amount <= 0) return 0;
    return Math.ceil(amount / unit) * unit;
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
