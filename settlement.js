(function (root) {
  "use strict";

  const roleOrder = ["社長", "部長", "室長", "次長", "課長", "調査役", "一般", "パート"];

  function calculate(state) {
    const rows = state.members.map((member) => ({
      ...member,
      name: member.name || "名無し",
      included: member.included !== false,
      isOrganizer: member.id === state.organizerId,
      isFixed: member.fixedAmount !== null && member.fixedAmount !== undefined,
      rawAmount: 0,
      roundedAmount: 0,
      finalAmount: 0,
    }));
    const active = rows.filter((row) => row.included);
    const fixed = active.filter((row) => row.isFixed);
    const variable = active.filter((row) => !row.isFixed && (state.paymentMode !== "weighted" || row.rate > 0));
    const total = state.totalAmount;
    const unit = state.roundUnit;
    let error = "";
    let note = "固定した金額は変更しません。多め・少なめは自動計算の人同士で調整します。";

    if (!Number.isSafeInteger(total) || total < 0 || ![1, 10, 100, 500, 1000].includes(unit)) {
      error = "総額は0以上の整数の円で入力してください。";
    } else if (fixed.some((row) => !Number.isSafeInteger(row.fixedAmount) || row.fixedAmount < 0)
      || active.filter((row) => !row.isFixed).some((row) => (state.paymentMode !== "weighted" && !Number.isSafeInteger(row.offset || 0))
        || (state.paymentMode === "weighted" && (!Number.isFinite(row.rate) || row.rate < 0)))) {
      error = "固定額・調整額は整数の円で入力してください。";
    }

    const fixedTotal = fixed.reduce((sum, row) => sum + row.fixedAmount, 0);
    if (!error) {
      fixed.forEach((row) => {
        row.rawAmount = row.roundedAmount = row.finalAmount = row.fixedAmount;
      });
      if (fixedTotal > total) {
        error = "固定額の合計が総額を超えています。固定額を確認してください。";
      } else if (active.length === 0) {
        error = "参加する人を追加してください。";
      } else if (variable.length === 0 && fixedTotal < total) {
        error = "残額を分ける人がいません。1人以上を自動計算にしてください。";
      } else if (variable.length > 0) {
        const remaining = total - fixedTotal;
        if (state.paymentMode === "weighted") {
          const rateTotal = variable.reduce((sum, row) => sum + row.rate, 0);
          variable.forEach((row) => { row.rawAmount = remaining * row.rate / rateTotal; });
        } else {
          // 少なめの設定で負担が負にならないよう、0円となる人を外して基準額を再計算する。
          let pool = variable.slice();
          while (pool.length) {
            const base = (remaining - pool.reduce((sum, row) => sum + (row.offset || 0), 0)) / pool.length;
            const positive = pool.filter((row) => base + (row.offset || 0) > 0);
            if (positive.length === pool.length) {
              pool.forEach((row) => { row.rawAmount = base + (row.offset || 0); });
              break;
            }
            pool = positive;
          }
        }

        // 切り捨ててから余りの大きい順に丸め単位を配る。固定額・免除・不参加には触れない。
        variable.forEach((row) => { row.roundedAmount = row.finalAmount = Math.floor(row.rawAmount / unit) * unit; });
        let left = remaining - variable.reduce((sum, row) => sum + row.finalAmount, 0);
        const ranked = variable.slice().sort((a, b) => (b.rawAmount - b.roundedAmount) - (a.rawAmount - a.roundedAmount));
        for (const row of ranked) {
          if (left < unit) break;
          row.finalAmount += unit;
          row.roundedAmount += unit;
          left -= unit;
        }

        if (left > 0) {
          if (state.adjustmentMode === "all") {
            const base = Math.floor(left / variable.length);
            const remainder = left % variable.length;
            variable.forEach((row, index) => { row.finalAmount += base + (index < remainder ? 1 : 0); });
            note = `丸め単位未満の端数 ${left}円は、自動計算の人で均等に調整しています。`;
          } else {
            const byRole = variable.slice().sort((a, b) => {
              const aRank = roleOrder.indexOf(a.role);
              const bRank = roleOrder.indexOf(b.role);
              return (aRank < 0 ? roleOrder.length : aRank) - (bRank < 0 ? roleOrder.length : bRank);
            });
            const organizer = state.adjustmentMode === "organizer" ? variable.find((row) => row.isOrganizer) : null;
            const target = organizer || byRole[0];
            target.finalAmount += left;
            note = `丸め単位未満の端数 ${left}円は${target.name}さんで調整しています。固定額の人は対象外です。`;
          }
        }
      }
    }
    const finalTotal = rows.reduce((sum, row) => sum + row.finalAmount, 0);
    if (!error && finalTotal !== total) error = "総額に合わせて配分できませんでした。金額を確認してください。";
    return { rows, fixedTotal, activeCount: active.length, finalTotal,
      roundedTotal: rows.reduce((sum, row) => sum + row.roundedAmount, 0),
      difference: total - finalTotal, error, note: error || note };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { calculate };
  else root.NomikaiSettlement = { calculate };
})(typeof globalThis !== "undefined" ? globalThis : this);
