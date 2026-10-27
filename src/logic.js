export const SCHEMA_VERSION = 1;
export const DEFAULT_SAFETY_RATE = 0.2;
export const INITIAL_CASH_CENTS = 12200;
export const INITIAL_LOAN_WINDOW = { start: "2026-11-01", end: "2026-12-31" };
export const ACCOUNT_IDS = ["wechat", "alipay", "bank", "cash"];
export const ACCOUNT_NAMES = {
  wechat: "微信",
  alipay: "支付宝",
  bank: "银行卡",
  cash: "现金"
};

const CATEGORY_TEMPLATES = [
  { key: "food", name: "吃饭", icon: "🍚", kind: "essential", color: "#2f6b50", bridgeBudgetCents: 7000 },
  { key: "laundry", name: "洗衣机", icon: "🧺", kind: "essential", color: "#4d7288", bridgeBudgetCents: 600 },
  { key: "hairdryer", name: "吹风机", icon: "💨", kind: "essential", color: "#8a6a3e", bridgeBudgetCents: 400 },
  { key: "daily", name: "日用/商店", icon: "🧴", kind: "essential", color: "#9b7047", bridgeBudgetCents: 1760 },
  { key: "transport", name: "交通", icon: "🚌", kind: "flexible", color: "#587685", bridgeBudgetCents: 0 },
  { key: "other", name: "其他", icon: "•", kind: "flexible", color: "#7b746b", bridgeBudgetCents: 0 },
  { key: "fitness", name: "健身课", icon: "🏋️", kind: "planned", color: "#b75b42", bridgeBudgetCents: 0 },
  { key: "gptplus", name: "GPT Plus", icon: "✦", kind: "planned", color: "#5e5a88", bridgeBudgetCents: 0 },
  { key: "shopping", name: "购物", icon: "🛍️", kind: "flexible", color: "#a25d73", bridgeBudgetCents: 0 },
  { key: "school", name: "学校费用", icon: "🎓", kind: "planned", color: "#48698c", bridgeBudgetCents: 0 },
  { key: "haircut", name: "理发", icon: "✂️", kind: "flexible", color: "#736252", bridgeBudgetCents: 0 }
];

export function makeId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function todayLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(iso, amount) {
  assert(isISODate(iso), "日期格式无效");
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + amount));
  return dt.toISOString().slice(0, 10);
}

export function inclusiveDays(fromIso, toIso) {
  if (!isISODate(fromIso) || !isISODate(toIso)) return 0;
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (to < from) return 0;
  return Math.floor((to - from) / 86400000) + 1;
}

export function parseYuanToCents(input) {
  const text = String(input ?? "").trim().replace(/[¥,\s]/g, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) throw new Error("请输入正确的金额，最多两位小数");
  const [yuan, fraction = ""] = text.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("金额过大");
  return cents;
}

export function formatCny(cents, options = {}) {
  const n = Number.isFinite(cents) ? cents : 0;
  const abs = Math.abs(Math.trunc(n));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const trail = options.alwaysCents || fen !== 0 ? `.${String(fen).padStart(2, "0")}` : "";
  return `${n < 0 ? "-" : ""}¥${yuan.toLocaleString("zh-CN")}${trail}`;
}

export function formatDateCN(iso) {
  if (!isISODate(iso)) return iso || "";
  const [, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function categoriesForCycle(cycleId, mode) {
  return CATEGORY_TEMPLATES.map((item) => ({
    id: `${cycleId}-${item.key}`,
    cycleId,
    key: item.key,
    name: item.name,
    icon: item.icon,
    kind: item.kind,
    color: item.color,
    budgetCents: mode === "bridge" ? item.bridgeBudgetCents : 0
  }));
}

export function createInitialState(todayIso = todayLocalISO()) {
  assert(isISODate(todayIso), "初始日期无效");
  const cycleId = makeId("cycle");
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      activeCycleId: cycleId,
      safetyRate: DEFAULT_SAFETY_RATE,
      createdAt: now,
      updatedAt: now
    },
    cycles: [{
      id: cycleId,
      type: "bridge",
      name: "撑到助学贷款",
      startDate: todayIso,
      endDate: INITIAL_LOAN_WINDOW.end,
      loanWindowStart: INITIAL_LOAN_WINDOW.start,
      loanWindowEnd: INITIAL_LOAN_WINDOW.end,
      expectedFundingLabel: "助学贷款",
      nextFundingEstimateCents: 2000000,
      targetFundingCents: INITIAL_CASH_CENTS,
      safetyRate: DEFAULT_SAFETY_RATE,
      status: "active",
      createdAt: now
    }],
    categories: categoriesForCycle(cycleId, "bridge"),
    fundings: [
      {
        id: makeId("fund"),
        cycleId,
        date: todayIso,
        amountCents: 7300,
        source: "微信余额",
        accountId: "wechat",
        note: "按 10 月 27 日实际余额初始化",
        createdAt: now
      },
      {
        id: makeId("fund"),
        cycleId,
        date: todayIso,
        amountCents: 4900,
        source: "支付宝余额",
        accountId: "alipay",
        note: "洗衣机和吹风机只能用支付宝",
        createdAt: now
      }
    ],
    expenses: [],
    transfers: [],
    plannedItems: [],
    packageUses: [],
    reserveReleases: []
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function getActiveCycle(state) {
  return state.cycles.find((cycle) => cycle.id === state.settings.activeCycleId) || null;
}

export function getCycleCategories(state, cycleId) {
  return state.categories.filter((category) => category.cycleId === cycleId);
}

export function computeCycleTotals(state, cycleId, todayIso = todayLocalISO()) {
  const cycle = state.cycles.find((item) => item.id === cycleId);
  assert(cycle, "找不到预算周期");
  const fundings = state.fundings.filter((item) => item.cycleId === cycleId);
  const expenses = state.expenses.filter((item) => item.cycleId === cycleId);
  const transfers = (state.transfers || []).filter((item) => item.cycleId === cycleId);
  const categories = getCycleCategories(state, cycleId);
  const releases = state.reserveReleases.filter((item) => item.cycleId === cycleId);
  const planned = state.plannedItems.filter((item) => item.cycleId === cycleId);

  const fundingCents = fundings.reduce((sum, item) => sum + item.amountCents, 0);
  const expenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
  const cashCents = fundingCents - expenseCents;
  const accountBalancesCents = Object.fromEntries(ACCOUNT_IDS.map((id) => [id, 0]));
  for (const item of fundings) {
    const accountId = ACCOUNT_IDS.includes(item.accountId) ? item.accountId : "cash";
    accountBalancesCents[accountId] += item.amountCents;
  }
  for (const item of expenses) {
    const accountId = ACCOUNT_IDS.includes(item.accountId) ? item.accountId : "cash";
    accountBalancesCents[accountId] -= item.amountCents;
  }
  for (const item of transfers) {
    accountBalancesCents[item.fromAccountId] -= item.amountCents;
    accountBalancesCents[item.toAccountId] += item.amountCents;
  }
  const reserveTargetCents = Math.round(fundingCents * Number(cycle.safetyRate ?? DEFAULT_SAFETY_RATE));
  const reserveReleasedCents = releases.reduce((sum, item) => sum + item.amountCents, 0);
  const protectedReserveCents = Math.max(0, reserveTargetCents - reserveReleasedCents);
  const plannedOutstandingCents = planned
    .filter((item) => item.status === "planned")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const spendableCents = Math.max(0, cashCents - protectedReserveCents - plannedOutstandingCents);
  const daysRemaining = inclusiveDays(todayIso, cycle.endDate);
  const dailyCapCents = daysRemaining > 0 ? Math.floor(spendableCents / daysRemaining) : 0;
  const spentTodayCents = expenses
    .filter((item) => item.date === todayIso)
    .reduce((sum, item) => sum + item.amountCents, 0);
  const todayRemainingCents = Math.max(0, dailyCapCents - spentTodayCents);

  const categoryStats = categories.map((category) => {
    const spentCents = expenses
      .filter((item) => item.categoryId === category.id)
      .reduce((sum, item) => sum + item.amountCents, 0);
    const remainingCents = category.budgetCents - spentCents;
    return {
      ...category,
      spentCents,
      remainingCents,
      progress: category.budgetCents > 0 ? spentCents / category.budgetCents : (spentCents > 0 ? 1 : 0)
    };
  });

  const month = todayIso.slice(0, 7);
  const monthExpenseCents = expenses
    .filter((item) => item.date.startsWith(month))
    .reduce((sum, item) => sum + item.amountCents, 0);
  const monthFundingCents = fundings
    .filter((item) => item.date.startsWith(month))
    .reduce((sum, item) => sum + item.amountCents, 0);
  const totalBudgetCents = categoryStats.reduce((sum, item) => sum + item.budgetCents, 0);
  const paidPackages = planned.filter((item) => item.status === "paid" && item.totalSessions > 0);
  const packageUses = (state.packageUses || []).filter((item) => item.cycleId === cycleId);

  return {
    cycle,
    fundingCents,
    expenseCents,
    cashCents,
    accountBalancesCents,
    reserveTargetCents,
    reserveReleasedCents,
    protectedReserveCents,
    plannedOutstandingCents,
    spendableCents,
    daysRemaining,
    dailyCapCents,
    spentTodayCents,
    todayRemainingCents,
    categoryStats,
    totalBudgetCents,
    unallocatedBudgetCents: Math.max(0, fundingCents - protectedReserveCents - totalBudgetCents),
    month,
    monthExpenseCents,
    monthFundingCents,
    paidPackages,
    packageUses,
    projectedCashAfterPlannedCents: cashCents - plannedOutstandingCents
  };
}

export function computeScenarioCaps(state, cycleId, dates, todayIso = todayLocalISO()) {
  const totals = computeCycleTotals(state, cycleId, todayIso);
  return [...new Set(dates)].filter(isISODate).map((date) => {
    const days = inclusiveDays(todayIso, date);
    return {
      date,
      days,
      dailyCapCents: days > 0 ? Math.floor(totals.spendableCents / days) : 0
    };
  });
}

export function budgetLimitCents(state, cycleId) {
  const totals = computeCycleTotals(state, cycleId);
  return Math.max(0, totals.fundingCents - totals.protectedReserveCents);
}

export function updateCategoryBudget(state, categoryId, nextBudgetCents) {
  assert(Number.isSafeInteger(nextBudgetCents) && nextBudgetCents >= 0, "预算金额无效");
  const category = state.categories.find((item) => item.id === categoryId);
  assert(category, "分类不存在");
  const totals = computeCycleTotals(state, category.cycleId);
  const nextTotal = totals.totalBudgetCents - category.budgetCents + nextBudgetCents;
  const limit = Math.max(0, totals.fundingCents - totals.protectedReserveCents);
  assert(nextTotal <= limit, `分类预算合计不能超过 ${formatCny(limit, { alwaysCents: true })}`);
  const next = cloneState(state);
  next.categories.find((item) => item.id === categoryId).budgetCents = nextBudgetCents;
  touch(next);
  return next;
}

export function updatePlanningEndDate(state, date) {
  assert(isISODate(date), "日期格式无效");
  const next = cloneState(state);
  const cycle = next.cycles.find((item) => item.id === next.settings.activeCycleId);
  assert(cycle, "找不到当前周期");
  if (cycle.type === "bridge") {
    assert(cycle.loanWindowStart && cycle.loanWindowEnd, "贷款窗口信息缺失");
    assert(date >= cycle.loanWindowStart && date <= cycle.loanWindowEnd, "预计到账日期必须在 11 月 1 日至 12 月 31 日之间");
  }
  assert(date >= cycle.startDate, "预计到账日期不能早于周期开始日期");
  cycle.endDate = date;
  touch(next);
  return next;
}

export function releaseReserve(state, amountCents, date = todayLocalISO(), note = "动用安全缓冲") {
  assert(Number.isSafeInteger(amountCents) && amountCents > 0, "释放金额无效");
  const cycle = getActiveCycle(state);
  assert(cycle, "找不到当前周期");
  const totals = computeCycleTotals(state, cycle.id, date);
  assert(amountCents <= totals.protectedReserveCents, "不能释放超过当前安全缓冲的金额");
  const next = cloneState(state);
  next.reserveReleases.push({ id: makeId("release"), cycleId: cycle.id, date, amountCents, note, createdAt: new Date().toISOString() });
  touch(next);
  return next;
}

export function startAnnualCycle(state, options) {
  const todayIso = options.todayIso || todayLocalISO();
  const amountCents = options.amountCents;
  const startDate = options.startDate || todayIso;
  const accountId = options.accountId || "bank";
  assert(isISODate(todayIso) && isISODate(startDate), "日期格式无效");
  assert(Number.isSafeInteger(amountCents) && amountCents > 0, "助学贷款金额无效");
  assert(ACCOUNT_IDS.includes(accountId), "请选择有效的到账账户");
  assert(startDate >= (getActiveCycle(state)?.startDate || startDate), "新周期开始日期无效");

  const previous = getActiveCycle(state);
  const previousTotals = previous ? computeCycleTotals(state, previous.id, todayIso) : { cashCents: 0, accountBalancesCents: {} };
  const carryoverByAccount = previousTotals.accountBalancesCents || { cash: Math.max(0, previousTotals.cashCents) };
  const carryoverCents = Object.values(carryoverByAccount).reduce((sum, amount) => sum + Math.max(0, amount), 0);
  const previousId = previous?.id || null;
  const next = cloneState(state);
  const now = new Date().toISOString();
  if (previousId) next.cycles.find((item) => item.id === previousId).status = "closed";

  const cycleId = makeId("cycle");
  const endDate = addDays(startDate, 364);
  const cycle = {
    id: cycleId,
    type: "annual",
    name: `${startDate.slice(0, 4)}—${endDate.slice(0, 4)} 年度生活费`,
    startDate,
    endDate,
    loanWindowStart: null,
    loanWindowEnd: null,
    expectedFundingLabel: null,
    nextFundingEstimateCents: 0,
    targetFundingCents: amountCents + carryoverCents,
    safetyRate: Number(next.settings.safetyRate ?? DEFAULT_SAFETY_RATE),
    status: "active",
    createdAt: now
  };
  next.cycles.push(cycle);
  next.categories.push(...categoriesForCycle(cycleId, "annual"));
  next.fundings.push({
    id: makeId("fund"),
    cycleId,
    date: startDate,
    amountCents,
    source: "助学贷款",
    accountId,
    note: "年度生活费到账",
    createdAt: now
  });
  for (const [carryAccount, carryAmount] of Object.entries(carryoverByAccount)) {
    if (Math.max(0, carryAmount) <= 0) continue;
    next.fundings.push({
      id: makeId("fund"),
      cycleId,
      date: startDate,
      amountCents: carryAmount,
      source: `${ACCOUNT_NAMES[carryAccount] || "现金"}结余`,
      accountId: ACCOUNT_IDS.includes(carryAccount) ? carryAccount : "cash",
      note: "从撑到助学贷款周期结转",
      createdAt: now
    });
  }
  next.settings.activeCycleId = cycleId;
  touch(next);
  return next;
}

export function addFunding(state, payload) {
  validateExpenseLikePayload(payload);
  const cycle = getActiveCycle(state);
  assert(cycle, "找不到当前周期");
  const next = cloneState(state);
  next.fundings.push({
    id: makeId("fund"),
    cycleId: cycle.id,
    date: payload.date,
    amountCents: payload.amountCents,
    source: String(payload.source || "生活费").trim() || "生活费",
    accountId: payload.accountId,
    note: String(payload.note || "").trim(),
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function addExpense(state, payload) {
  validateExpenseLikePayload(payload);
  const cycle = getActiveCycle(state);
  assert(cycle, "找不到当前周期");
  const category = state.categories.find((item) => item.id === payload.categoryId && item.cycleId === cycle.id);
  assert(category, "请选择当前周期的消费分类");
  const next = cloneState(state);
  next.expenses.push({
    id: makeId("expense"),
    cycleId: cycle.id,
    date: payload.date,
    amountCents: payload.amountCents,
    categoryId: payload.categoryId,
    accountId: payload.accountId,
    note: String(payload.note || "").trim(),
    plannedItemId: payload.plannedItemId || null,
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function addTransfer(state, payload) {
  validateExpenseLikePayload({ ...payload, accountId: payload.fromAccountId });
  assert(ACCOUNT_IDS.includes(payload.toAccountId), "请选择有效的转入账户");
  assert(payload.fromAccountId !== payload.toAccountId, "转出和转入账户不能相同");
  const cycle = getActiveCycle(state);
  assert(cycle, "找不到当前周期");
  const next = cloneState(state);
  if (!Array.isArray(next.transfers)) next.transfers = [];
  next.transfers.push({
    id: makeId("transfer"),
    cycleId: cycle.id,
    date: payload.date,
    amountCents: payload.amountCents,
    fromAccountId: payload.fromAccountId,
    toAccountId: payload.toAccountId,
    note: String(payload.note || "").trim(),
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function deleteTransfer(state, transferId) {
  assert((state.transfers || []).some((item) => item.id === transferId), "转账记录不存在");
  const next = cloneState(state);
  next.transfers = next.transfers.filter((item) => item.id !== transferId);
  touch(next);
  return next;
}

export function addPlannedItem(state, payload) {
  validateExpenseLikePayload(payload);
  const totalSessions = Number(payload.totalSessions || 0);
  assert(Number.isSafeInteger(totalSessions) && totalSessions >= 0 && totalSessions <= 999, "课程次数无效");
  const cycle = getActiveCycle(state);
  assert(cycle, "找不到当前周期");
  const category = state.categories.find((item) => item.id === payload.categoryId && item.cycleId === cycle.id);
  assert(category, "请选择当前周期的消费分类");
  const next = cloneState(state);
  next.plannedItems.push({
    id: makeId("plan"),
    cycleId: cycle.id,
    categoryId: payload.categoryId,
    accountId: payload.accountId,
    title: String(payload.title || "").trim() || category.name,
    amountCents: payload.amountCents,
    dueDate: payload.dueDate || payload.date,
    status: "planned",
    totalSessions,
    remainingSessions: totalSessions,
    note: String(payload.note || "").trim(),
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function markPlannedPaid(state, itemId, paidDate = todayLocalISO()) {
  assert(isISODate(paidDate), "付款日期无效");
  const item = state.plannedItems.find((entry) => entry.id === itemId);
  assert(item && item.status === "planned", "计划支出不存在或已支付");
  const next = cloneState(state);
  const target = next.plannedItems.find((entry) => entry.id === itemId);
  target.status = "paid";
  target.paidDate = paidDate;
  next.expenses.push({
    id: makeId("expense"),
    cycleId: target.cycleId,
    date: paidDate,
    amountCents: target.amountCents,
    categoryId: target.categoryId,
    accountId: target.accountId || "wechat",
    note: target.title,
    plannedItemId: target.id,
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function recordPackageUse(state, itemId, date = todayLocalISO()) {
  assert(isISODate(date), "消课日期无效");
  const item = state.plannedItems.find((entry) => entry.id === itemId);
  assert(item && item.status === "paid" && item.totalSessions > 0, "课程包不存在或尚未购买");
  assert(item.remainingSessions > 0, "这个课程包已经用完");
  const next = cloneState(state);
  const target = next.plannedItems.find((entry) => entry.id === itemId);
  target.remainingSessions -= 1;
  next.packageUses.push({
    id: makeId("use"),
    cycleId: target.cycleId,
    plannedItemId: target.id,
    date,
    createdAt: new Date().toISOString()
  });
  touch(next);
  return next;
}

export function deleteExpense(state, expenseId) {
  const expense = state.expenses.find((item) => item.id === expenseId);
  assert(expense, "消费记录不存在");
  const next = cloneState(state);
  next.expenses = next.expenses.filter((item) => item.id !== expenseId);
  if (expense.plannedItemId) {
    const planned = next.plannedItems.find((item) => item.id === expense.plannedItemId);
    if (planned) {
      planned.status = "planned";
      delete planned.paidDate;
      next.packageUses = next.packageUses.filter((item) => item.plannedItemId !== planned.id);
      planned.remainingSessions = planned.totalSessions;
    }
  }
  touch(next);
  return next;
}

export function deleteFunding(state, fundingId) {
  assert(state.fundings.some((item) => item.id === fundingId), "到账记录不存在");
  const next = cloneState(state);
  next.fundings = next.fundings.filter((item) => item.id !== fundingId);
  touch(next);
  return next;
}

export function deletePlannedItem(state, itemId) {
  const item = state.plannedItems.find((entry) => entry.id === itemId);
  assert(item, "计划支出不存在");
  assert(item.status === "planned", "已支付的计划不能直接删除，请先删除对应消费记录");
  const next = cloneState(state);
  next.plannedItems = next.plannedItems.filter((entry) => entry.id !== itemId);
  touch(next);
  return next;
}

function validateExpenseLikePayload(payload) {
  assert(payload && Number.isSafeInteger(payload.amountCents) && payload.amountCents > 0, "金额必须大于 0");
  assert(isISODate(payload.date), "日期格式无效");
  assert(ACCOUNT_IDS.includes(payload.accountId), "请选择有效的支付账户");
}

function touch(state) {
  state.settings.updatedAt = new Date().toISOString();
}

export function validateState(state) {
  assert(state && typeof state === "object" && !Array.isArray(state), "备份内容不是有效对象");
  assert(state.schemaVersion === SCHEMA_VERSION, `备份版本不受支持：${state.schemaVersion}`);
  assert(state.settings && typeof state.settings === "object", "缺少设置");
  assert(Array.isArray(state.cycles) && state.cycles.length > 0, "缺少预算周期");
  for (const key of ["categories", "fundings", "expenses", "transfers", "plannedItems", "packageUses", "reserveReleases"]) {
    assert(Array.isArray(state[key]), `字段 ${key} 无效`);
  }
  assert(state.cycles.some((item) => item.id === state.settings.activeCycleId), "当前预算周期不存在");
  const cycleIds = new Set(state.cycles.map((item) => item.id));
  for (const cycle of state.cycles) {
    assert(cycle.id && cycleIds.has(cycle.id), "预算周期编号无效");
    assert(isISODate(cycle.startDate) && isISODate(cycle.endDate), "预算周期日期无效");
    assert(cycle.endDate >= cycle.startDate, "预算周期结束日期早于开始日期");
    assert(Number.isFinite(Number(cycle.safetyRate)) && Number(cycle.safetyRate) >= 0 && Number(cycle.safetyRate) <= 0.5, "安全缓冲比例无效");
  }
  for (const item of [...state.fundings, ...state.expenses]) {
    assert(cycleIds.has(item.cycleId), "记录关联的预算周期不存在");
    assert(isISODate(item.date), "记录日期无效");
    assert(Number.isSafeInteger(item.amountCents) && item.amountCents > 0, "记录金额无效");
    assert(ACCOUNT_IDS.includes(item.accountId), "记录缺少有效支付账户");
  }
  for (const item of state.transfers) {
    assert(cycleIds.has(item.cycleId), "转账关联的预算周期不存在");
    assert(isISODate(item.date), "转账日期无效");
    assert(Number.isSafeInteger(item.amountCents) && item.amountCents > 0, "转账金额无效");
    assert(ACCOUNT_IDS.includes(item.fromAccountId) && ACCOUNT_IDS.includes(item.toAccountId), "转账账户无效");
    assert(item.fromAccountId !== item.toAccountId, "转账账户不能相同");
  }
  for (const category of state.categories) {
    assert(cycleIds.has(category.cycleId), "分类关联的预算周期不存在");
    assert(Number.isSafeInteger(category.budgetCents) && category.budgetCents >= 0, "分类预算无效");
  }
  for (const planned of state.plannedItems) {
    assert(cycleIds.has(planned.cycleId), "计划支出关联的预算周期不存在");
    assert(Number.isSafeInteger(planned.amountCents) && planned.amountCents > 0, "计划支出金额无效");
    assert(["planned", "paid"].includes(planned.status), "计划支出状态无效");
    assert(ACCOUNT_IDS.includes(planned.accountId || "wechat"), "计划支出缺少有效支付账户");
  }
  return state;
}




