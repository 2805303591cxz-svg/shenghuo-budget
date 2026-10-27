import test from "node:test";
import assert from "node:assert/strict";
import {
  addExpense,
  addFunding,
  addPlannedItem,
  addTransfer,
  computeCycleTotals,
  computeScenarioCaps,
  createInitialState,
  deleteExpense,
  inclusiveDays,
  markPlannedPaid,
  parseYuanToCents,
  recordPackageUse,
  releaseReserve,
  startAnnualCycle,
  updateCategoryBudget,
  updatePlanningEndDate,
  validateState
} from "../src/logic.js";

const TODAY = "2026-10-27";

function initialState() {
  return createInitialState(TODAY);
}

test("金额解析避免浮点误差", () => {
  assert.equal(parseYuanToCents("120"), 12000);
  assert.equal(parseYuanToCents("¥1.45"), 145);
  assert.equal(parseYuanToCents("0.01"), 1);
  assert.equal(parseYuanToCents("1,234.5"), 123450);
  assert.throws(() => parseYuanToCents("1.234"), /两位小数/);
  assert.throws(() => parseYuanToCents("abc"), /金额/);
});

test("日期按自然日计算并包含两端", () => {
  assert.equal(inclusiveDays("2026-10-27", "2026-10-27"), 1);
  assert.equal(inclusiveDays("2026-10-27", "2026-12-31"), 66);
  assert.equal(inclusiveDays("2026-12-31", "2026-10-27"), 0);
});

test("122 元、20% 缓冲、最晚 12 月 31 日到账时每日上限为 1.47 元", () => {
  const state = initialState();
  const totals = computeCycleTotals(state, state.settings.activeCycleId, TODAY);
  assert.equal(totals.fundingCents, 12200);
  assert.equal(totals.protectedReserveCents, 2440);
  assert.equal(totals.spendableCents, 9760);
  assert.equal(totals.daysRemaining, 66);
  assert.equal(totals.dailyCapCents, 147);
  assert.equal(totals.todayRemainingCents, 147);
  assert.equal(totals.totalBudgetCents, 9760);
});

test("不确定到账日时显示三种情景", () => {
  const state = initialState();
  const scenarios = computeScenarioCaps(
    state,
    state.settings.activeCycleId,
    ["2026-11-30", "2026-12-15", "2026-12-31"],
    TODAY
  );
  assert.deepEqual(scenarios.map((item) => item.dailyCapCents), [278, 195, 147]);
});

test("修改预计到账日会更新剩余天数，并限制在贷款窗口内", () => {
  const state = initialState();
  const next = updatePlanningEndDate(state, "2026-11-30");
  const totals = computeCycleTotals(next, next.settings.activeCycleId, TODAY);
  assert.equal(totals.daysRemaining, 35);
  assert.equal(totals.dailyCapCents, 278);
  assert.throws(() => updatePlanningEndDate(state, "2027-01-01"), /11 月 1 日至 12 月 31 日/);
});

test("释放安全缓冲后每日额度增加并留下记录", () => {
  const state = initialState();
  const next = releaseReserve(state, 2440, TODAY, "测试释放");
  const totals = computeCycleTotals(next, next.settings.activeCycleId, TODAY);
  assert.equal(totals.protectedReserveCents, 0);
  assert.equal(totals.spendableCents, 12200);
  assert.equal(totals.dailyCapCents, 184);
  assert.equal(next.reserveReleases.length, 1);
});

test("消费和补记到账都即时反映在现金中", () => {
  let state = initialState();
  const cycleId = state.settings.activeCycleId;
  const food = state.categories.find((item) => item.key === "food");
  state = addExpense(state, { amountCents: 500, categoryId: food.id, accountId: "wechat", date: TODAY, note: "午饭" });
  let totals = computeCycleTotals(state, cycleId, TODAY);
  assert.equal(totals.expenseCents, 500);
  assert.equal(totals.cashCents, 11700);
  assert.equal(totals.accountBalancesCents.wechat, 6800);
  assert.equal(totals.accountBalancesCents.alipay, 4900);
  assert.equal(totals.spentTodayCents, 500);

  state = addFunding(state, { amountCents: 1000, source: "父母", accountId: "wechat", date: TODAY, note: "补给" });
  totals = computeCycleTotals(state, cycleId, TODAY);
  assert.equal(totals.fundingCents, 13200);
  assert.equal(totals.cashCents, 12700);
});

test("微信和支付宝初始余额分别正确，账户互转不改变总现金", () => {
  let state = initialState();
  const cycleId = state.settings.activeCycleId;
  let totals = computeCycleTotals(state, cycleId, TODAY);
  assert.deepEqual(
    { wechat: totals.accountBalancesCents.wechat, alipay: totals.accountBalancesCents.alipay },
    { wechat: 7300, alipay: 4900 }
  );
  state = addTransfer(state, {
    amountCents: 2000,
    fromAccountId: "wechat",
    toAccountId: "alipay",
    date: TODAY,
    note: "留出洗衣钱"
  });
  totals = computeCycleTotals(state, cycleId, TODAY);
  assert.equal(totals.cashCents, 12200);
  assert.equal(totals.accountBalancesCents.wechat, 5300);
  assert.equal(totals.accountBalancesCents.alipay, 6900);
  assert.throws(() => addTransfer(state, {
    amountCents: 6000,
    fromAccountId: "wechat",
    toAccountId: "alipay",
    date: TODAY
  }), /余额不足/);
});

test("分类预算合计不能超过扣除安全缓冲后的金额", () => {
  const state = initialState();
  const food = state.categories.find((item) => item.key === "food");
  assert.throws(() => updateCategoryBudget(state, food.id, 10000), /不能超过/);
  const next = updateCategoryBudget(state, food.id, 6000);
  assert.equal(next.categories.find((item) => item.id === food.id).budgetCents, 6000);
});

test("助学贷款到账后结转旧现金并开启一年周期", () => {
  const state = initialState();
  const next = startAnnualCycle(state, {
    amountCents: 2000000,
    startDate: "2026-12-01",
    todayIso: "2026-12-01"
  });
  const cycle = next.cycles.find((item) => item.id === next.settings.activeCycleId);
  const totals = computeCycleTotals(next, cycle.id, "2026-12-01");
  assert.equal(cycle.type, "annual");
  assert.equal(cycle.startDate, "2026-12-01");
  assert.equal(cycle.endDate, "2027-11-30");
  assert.equal(totals.fundingCents, 2012200);
  assert.equal(totals.protectedReserveCents, 402440);
  assert.equal(next.cycles.find((item) => item.id === state.settings.activeCycleId).status, "closed");
});

test("900 元课程包付款时扣一次现金，上课只减次数", () => {
  let state = startAnnualCycle(initialState(), {
    amountCents: 2000000,
    startDate: "2026-12-01",
    todayIso: "2026-12-01"
  });
  const cycleId = state.settings.activeCycleId;
  const fitness = state.categories.find((item) => item.cycleId === cycleId && item.key === "fitness");
  state = addPlannedItem(state, {
    title: "健身课 10 次",
    amountCents: 90000,
    categoryId: fitness.id,
    dueDate: "2026-12-02",
    date: "2026-12-02",
    totalSessions: 10,
    accountId: "wechat"
  });
  let totals = computeCycleTotals(state, cycleId, "2026-12-01");
  const beforePayDaily = totals.dailyCapCents;
  const itemId = state.plannedItems[0].id;
  state = markPlannedPaid(state, itemId, "2026-12-02");
  totals = computeCycleTotals(state, cycleId, "2026-12-02");
  const paidExpense = state.expenses.find((item) => item.plannedItemId === itemId);
  assert.equal(paidExpense.amountCents, 90000);
  assert.equal(state.expenses.length, 1);

  state = recordPackageUse(state, itemId, "2026-12-03");
  state = recordPackageUse(state, itemId, "2026-12-04");
  assert.equal(state.plannedItems[0].remainingSessions, 8);
  assert.equal(state.expenses.length, 1);
  assert.equal(state.packageUses.length, 2);
  assert.ok(beforePayDaily > 0);
});

test("删除课程包付款记录会恢复计划状态和课程次数", () => {
  let state = startAnnualCycle(initialState(), {
    amountCents: 2000000,
    startDate: "2026-12-01",
    todayIso: "2026-12-01"
  });
  const cycleId = state.settings.activeCycleId;
  const fitness = state.categories.find((item) => item.cycleId === cycleId && item.key === "fitness");
  state = addPlannedItem(state, {
    title: "健身课", amountCents: 90000, categoryId: fitness.id,
    dueDate: "2026-12-02", date: "2026-12-02", totalSessions: 10, accountId: "wechat"
  });
  const id = state.plannedItems[0].id;
  state = markPlannedPaid(state, id, "2026-12-02");
  state = recordPackageUse(state, id, "2026-12-03");
  const expenseId = state.expenses[0].id;
  state = deleteExpense(state, expenseId);
  assert.equal(state.expenses.length, 0);
  assert.equal(state.plannedItems[0].status, "planned");
  assert.equal(state.plannedItems[0].remainingSessions, 10);
  assert.equal(state.packageUses.length, 0);
});

test("备份结构校验会拒绝缺字段的数据", () => {
  const state = initialState();
  assert.doesNotThrow(() => validateState(structuredClone(state)));
  assert.throws(() => validateState({ schemaVersion: 1, settings: {}, cycles: [] }), /预算周期/);
});






