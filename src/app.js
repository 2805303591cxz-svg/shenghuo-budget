import {
  ACCOUNT_IDS,
  ACCOUNT_NAMES,
  DEFAULT_SAFETY_RATE,
  addExpense,
  addFunding,
  addPlannedItem,
  addTransfer,
  cloneState,
  computeCycleTotals,
  computeScenarioCaps,
  createInitialState,
  deleteExpense,
  deleteFunding,
  deletePlannedItem,
  deleteTransfer,
  formatCny,
  formatDateCN,
  getActiveCycle,
  getCycleCategories,
  inclusiveDays,
  isISODate,
  markPlannedPaid,
  parseYuanToCents,
  recordPackageUse,
  releaseReserve,
  startAnnualCycle,
  todayLocalISO,
  updateCategoryBudget,
  updatePlanningEndDate,
  validateState
} from "./logic.js";
import { loadState, requestPersistentStorage, saveState } from "./db.js";

const appView = document.getElementById("app-view");
const modalRoot = document.getElementById("modal-root");
const cycleEyebrow = document.getElementById("cycle-eyebrow");
const quickAdd = document.getElementById("quick-add");
const toastEl = document.getElementById("toast");

let state = null;
let currentTab = "home";
let recordTab = "expenses";
let installPrompt = null;
let toastTimer = null;
let lastToday = todayLocalISO();

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents, alwaysCents = false) {
  return formatCny(cents, { alwaysCents });
}

function centsToInput(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2).replace(/\.00$/, "");
}

function fullDate(iso) {
  if (!isISODate(iso)) return iso || "";
  const [year, month, day] = iso.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function shortDate(iso) {
  if (!isISODate(iso)) return iso || "";
  return iso.slice(5).replace("-", "/");
}

function weekday(iso) {
  if (!isISODate(iso)) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(iso + "T12:00:00").getDay()];
}

function getCategory(categoryId) {
  return state.categories.find((item) => item.id === categoryId) || null;
}

function accountName(accountId) {
  return ACCOUNT_NAMES[accountId] || "未知账户";
}

function accountOptions(selectedId = "wechat") {
  return ACCOUNT_IDS.map((accountId) => `
    <option value="${h(accountId)}" ${accountId === selectedId ? "selected" : ""}>${h(accountName(accountId))}</option>
  `).join("");
}

function categoriesOfActiveCycle() {
  const cycle = getActiveCycle(state);
  return cycle ? getCycleCategories(state, cycle.id) : [];
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
}

async function commit(nextState, message) {
  const previous = state;
  state = nextState;
  try {
    validateState(state);
    await saveState(state);
    renderApp();
    if (message) showToast(message);
    return true;
  } catch (error) {
    state = previous;
    renderApp();
    throw error;
  }
}

function categoryRows(stats, editable) {
  if (!stats.length) {
    return `<div class="empty-state"><p>还没有分类预算</p></div>`;
  }
  return `<div class="category-list">${stats.map((stat) => {
    const progress = Math.max(0, Math.min(1, stat.progress));
    const tone = stat.progress >= 1 ? "danger" : stat.progress >= 0.8 ? "warning" : "";
    const budgetText = stat.budgetCents > 0
      ? `${money(stat.spentCents)} / ${money(stat.budgetCents)}`
      : `未设预算 · 已花 ${money(stat.spentCents)}`;
    return `
      <div class="category-row" data-category-id="${h(stat.id)}">
        <div class="category-icon" style="color:${h(stat.color)}">${h(stat.icon)}</div>
        <div class="category-main">
          <div class="category-name-row">
            <span class="category-name">${h(stat.name)}</span>
            <span class="category-numbers">${budgetText}</span>
          </div>
          <div class="progress ${tone}" aria-label="${h(stat.name)}预算进度 ${Math.round(progress * 100)}%">
            <span style="width:${progress * 100}%"></span>
          </div>
        </div>
        ${editable ? `<button type="button" class="category-edit" data-action="edit-budget" data-id="${h(stat.id)}" aria-label="修改${h(stat.name)}预算">⋯</button>` : `<span></span>`}
      </div>`;
  }).join("")}</div>`;
}

function scenarioSection(totals) {
  const cycle = totals.cycle;
  if (cycle.type !== "bridge") return "";
  const candidateDates = ["2026-11-30", "2026-12-15", cycle.loanWindowEnd || "2026-12-31"]
    .filter((date, index, arr) => date >= lastToday && arr.indexOf(date) === index);
  const scenarios = computeScenarioCaps(state, cycle.id, candidateDates, lastToday);
  return `
    <section class="card scenario-card">
      <div class="section-head">
        <div>
          <h2>到账日未知，先按最坏情况</h2>
          <p>日期一确定，就点下方日期更新</p>
        </div>
      </div>
      <div class="scenario-grid">
        ${scenarios.map((item) => `
          <button type="button" class="scenario ${item.date === cycle.endDate ? "is-selected" : ""}" data-action="set-scenario-date" data-date="${h(item.date)}">
            <span>${shortDate(item.date)} 到账</span>
            <strong>${money(item.dailyCapCents, true)}</strong>
            <em>每天 · 剩 ${item.days} 天</em>
          </button>`).join("")}
      </div>
      <p class="small-muted" style="margin:12px 2px 0">当前按 <strong>${formatDateCN(cycle.endDate)}</strong> 到账来保守计算。实际到账越早，每天可花越多。</p>
    </section>`;
}

function accountSection(totals, cycle) {
  const visibleAccounts = ACCOUNT_IDS.filter((accountId) => ["wechat", "alipay"].includes(accountId) || totals.accountBalancesCents[accountId] !== 0);
  const icons = { wechat: "微", alipay: "支", bank: "卡", cash: "现" };
  return `
    <section class="card account-card">
      <div class="section-head">
        <div><h2>钱分别在哪里</h2><p>总计 ${money(totals.cashCents)}，记账时请选对账户</p></div>
        <button type="button" class="button ghost small" data-action="add-transfer">账户互转</button>
      </div>
      <div class="account-grid">
        ${visibleAccounts.map((accountId) => `
          <div class="account-tile ${accountId === "alipay" ? "is-alipay" : ""}" data-account="${h(accountId)}">
            <span class="account-badge">${h(icons[accountId] || "账")}</span>
            <div><small>${h(accountName(accountId))}</small><strong class="money ${totals.accountBalancesCents[accountId] < 0 ? "negative" : ""}">${money(totals.accountBalancesCents[accountId], true)}</strong></div>
          </div>`).join("")}
      </div>
      ${totals.accountBalancesCents.alipay <= 0 ? `<div class="notice danger" style="margin:12px 0 0"><span class="notice-icon">!</span><div><strong>支付宝余额已经不够</strong>洗衣机和吹风机只能支付宝付款，请马上补充或停止这两项消费。</div></div>` : ""}
      ${cycle.type === "bridge" ? `
        <div class="quick-spend-row">
          <button type="button" class="quick-spend" data-action="quick-laundry"><span>🧺</span><div><strong>洗衣 ¥0.60</strong><small>支付宝</small></div></button>
          <button type="button" class="quick-spend" data-action="quick-hairdryer"><span>💨</span><div><strong>吹风 ¥1.00</strong><small>支付宝</small></div></button>
          <button type="button" class="quick-spend" data-action="quick-shop"><span>🧴</span><div><strong>学校商店</strong><small>核对付款账户</small></div></button>
        </div>
        <p class="account-tip">支付宝要优先留给洗衣和吹风；微信余额再多，也不能拿来启动洗衣机。早晚饭先用宿舍面包顶上。</p>` : ""}
    </section>`;
}

function renderHome() {
  const cycle = getActiveCycle(state);
  if (!cycle) return `<div class="notice danger">找不到当前预算周期，请从设置恢复备份。</div>`;
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  const tight = totals.dailyCapCents < 500;
  const overToday = totals.spentTodayCents > 0 && totals.todayRemainingCents === 0;
  const allocated = totals.totalBudgetCents;
  const categoryStats = totals.categoryStats.filter((item) => item.budgetCents > 0 || item.spentCents > 0);
  const annualProgress = totals.spendableCents + totals.expenseCents > 0
    ? Math.min(1, totals.expenseCents / Math.max(1, totals.expenseCents + totals.spendableCents))
    : 0;

  return `
    <section class="hero ${tight ? "hero-tight" : ""}" data-testid="home-hero">
      <div class="hero-head">
        <p class="hero-label">今天还能花</p>
        <span class="hero-date">${formatDateCN(lastToday)} · ${weekday(lastToday)}</span>
      </div>
      <div class="hero-number-row">
        <strong class="hero-number" data-testid="daily-cap">${money(totals.todayRemainingCents, true)}</strong>
        <span class="hero-unit">元</span>
      </div>
      <p class="hero-sub">${cycle.type === "bridge"
        ? `按 ${formatDateCN(cycle.endDate)} 到账保守计算，本轮还剩 ${totals.daysRemaining} 天`
        : `本轮还剩 ${totals.daysRemaining} 天 · 每天总上限 ${money(totals.dailyCapCents, true)}`}</p>
      <div class="hero-stats">
        <div class="hero-stat"><span>手头现金</span><strong>${money(totals.cashCents)}</strong></div>
        <div class="hero-stat"><span>安全缓冲</span><strong>${money(totals.protectedReserveCents)}</strong></div>
        <div class="hero-stat"><span>今日已花</span><strong>${money(totals.spentTodayCents)}</strong></div>
      </div>
    </section>

    ${overToday ? `<div class="notice danger"><span class="notice-icon">!</span><div><strong>今天的计划额度已经用完</strong>还能继续记，但明天的额度会相应变少。尽量先停掉非必要开销。</div></div>` : ""}
    ${tight && !overToday ? `<div class="notice"><span class="notice-icon">!</span><div><strong>现在是很紧的生存模式</strong>按最晚日期算，每天额度低于 5 元。到账日期一确定，请马上更新计划日期。</div></div>` : ""}
    ${cycle.type === "annual" && totals.totalBudgetCents === 0 ? `<div class="notice calm"><span class="notice-icon">→</span><div><strong>年度预算还没分到分类</strong>每日额度已按总现金计算；去“计划”页把吃饭、健身课等金额分好，会更清楚。</div></div>` : ""}

    ${accountSection(totals, cycle)}

    ${scenarioSection(totals)}

    ${cycle.type === "bridge" ? `
      <section class="card">
        <div class="loan-window">
          <div>
            <p class="small-muted" style="margin:0 0 2px">下一笔到账</p>
            <div class="loan-date">11月—12月</div>
            <span class="window-pill">助学贷款 · 具体日期未知</span>
          </div>
          <span style="font-size:30px" aria-hidden="true">🎓</span>
        </div>
        <p class="small-muted" style="margin:13px 0 0">后续年度生活费按 ${money(cycle.nextFundingEstimateCents || 2000000)} 预估，实际到账后重新确认。</p>
        <div class="button-row">
          <button type="button" class="button secondary small" data-action="adjust-date">调整到账日</button>
          <button type="button" class="button small" data-action="loan-arrived">贷款到了</button>
        </div>
      </section>` : `
      <section class="card">
        <div class="section-head">
          <div><h2>年度总览</h2><p>${fullDate(cycle.startDate)} — ${fullDate(cycle.endDate)}</p></div>
          <strong class="money">${Math.round(annualProgress * 100)}%</strong>
        </div>
        <div class="progress ${annualProgress >= 0.8 ? "warning" : ""}"><span style="width:${annualProgress * 100}%"></span></div>
        <div class="info-grid" style="margin-top:14px">
          <div class="info-tile"><span>已到账</span><strong>${money(totals.fundingCents)}</strong></div>
          <div class="info-tile"><span>计划未付</span><strong>${money(totals.plannedOutstandingCents)}</strong></div>
        </div>
      </section>`}

    <section class="card">
      <div class="section-head">
        <div><h2>分类进度</h2><p>${monthLabel(totals.month)}本月已花 · 分类预算按整轮计算</p></div>
        <strong class="money" data-testid="month-spent">${money(totals.monthExpenseCents)}</strong>
      </div>
      ${categoryRows(categoryStats, false)}
      <div class="budget-summary">
        <span>分类预算已分配</span>
        <strong>${money(allocated)} / ${money(totals.fundingCents - totals.protectedReserveCents)}</strong>
      </div>
    </section>
  `;
}

function monthLabel(month) {
  if (!month) return "";
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}

function renderPlanItem(item) {
  const category = getCategory(item.categoryId);
  const isPackage = item.totalSessions > 0;
  const isPaid = item.status === "paid";
  return `
    <div class="plan-item" data-plan-id="${h(item.id)}">
      <div class="plan-item-title">
        <div>
          <h3>${h(item.title)}</h3>
          <p>${h(category ? `${category.icon} ${category.name}` : "未分类")} · ${h(accountName(item.accountId || "wechat"))} · ${fullDate(item.dueDate)}${isPaid ? " 已支付" : " 前计划"}</p>
        </div>
        <strong class="money">${money(item.amountCents)}</strong>
      </div>
      ${isPackage ? `<div class="package-count">${isPaid ? "剩余上课次数" : "购买后共"} ${isPaid ? item.remainingSessions : item.totalSessions} / ${item.totalSessions} 次</div>` : ""}
      <div class="plan-item-actions">
        ${!isPaid ? `<button type="button" class="button small" data-action="mark-paid" data-id="${h(item.id)}">记作已支付</button>
          <button type="button" class="button ghost small" data-action="delete-plan" data-id="${h(item.id)}">删除</button>` : ""}
        ${isPaid && isPackage ? `<button type="button" class="button secondary small" data-action="use-session" data-id="${h(item.id)}" ${item.remainingSessions <= 0 ? "disabled" : ""}>用掉 1 次</button>` : ""}
      </div>
    </div>`;
}

function renderPlan() {
  const cycle = getActiveCycle(state);
  if (!cycle) return `<div class="notice danger">找不到当前预算周期。</div>`;
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  const budgetLimit = Math.max(0, totals.fundingCents - totals.protectedReserveCents);
  const planned = state.plannedItems
    .filter((item) => item.cycleId === cycle.id)
    .sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === "planned" ? -1 : 1));
  const shownPlanned = planned.filter((item) => item.status === "planned" || item.totalSessions > 0);

  return `
    <section class="card">
      <div class="section-head">
        <div><h2>${cycle.type === "bridge" ? "先稳住这一程" : "这一年怎么过"}</h2><p>${h(cycle.name)} · ${fullDate(cycle.startDate)} — ${fullDate(cycle.endDate)}</p></div>
        <span class="window-pill">${cycle.type === "bridge" ? "过渡期" : "年度预算"}</span>
      </div>
      <div class="info-grid">
        <div class="info-tile"><span>剩余现金</span><strong>${money(totals.cashCents)}</strong></div>
        <div class="info-tile"><span>可安排现金</span><strong>${money(Math.max(0, totals.cashCents - totals.protectedReserveCents - totals.plannedOutstandingCents))}</strong></div>
        <div class="info-tile"><span>安全缓冲</span><strong>${money(totals.protectedReserveCents)}</strong></div>
        <div class="info-tile"><span>每日总上限</span><strong>${money(totals.dailyCapCents, true)}</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <div><h2>${Math.round(Number(cycle.safetyRate) * 100)}% 安全缓冲</h2><p>默认不进入每日额度，动用会留下记录</p></div>
        <strong class="money">${money(totals.protectedReserveCents)}</strong>
      </div>
      <p class="small-muted" style="margin:0">目前累计已释放 ${money(totals.reserveReleasedCents)}。这笔钱是你的最后防线，只有真的不够时才动。</p>
      <div class="button-row">
        <button type="button" class="button warn small" data-action="release-reserve" ${totals.protectedReserveCents <= 0 ? "disabled" : ""}>动用缓冲</button>
        <button type="button" class="button ghost small" data-action="edit-safety">修改比例</button>
      </div>
    </section>

    ${cycle.type === "bridge" ? `
      <section class="card">
        <div class="section-head">
          <div><h2>预计到账日期</h2><p>当前按 ${formatDateCN(cycle.endDate)} 计算</p></div>
          <span class="window-pill">11/01—12/31</span>
        </div>
        <p class="small-muted" style="margin:0 0 12px">不确定具体哪天时，建议按最晚日期规划。知道确定日期后立即更新。</p>
        <div class="button-row"><button type="button" class="button secondary small" data-action="adjust-date">更新日期</button></div>
      </section>` : ""}

    <section class="card">
      <div class="section-head">
        <div><h2>分类预算</h2><p>整轮可用 ${money(budgetLimit)}，已分配 ${money(totals.totalBudgetCents)}</p></div>
      </div>
      ${categoryRows(totals.categoryStats, true)}
      <div class="budget-summary">
        <span>${totals.totalBudgetCents > budgetLimit ? "已超出可分配金额" : "尚未分配"}</span>
        <strong class="${totals.totalBudgetCents > budgetLimit ? "negative" : ""}">${money(Math.max(0, budgetLimit - totals.totalBudgetCents))}</strong>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <div><h2>大额计划</h2><p>还没付的钱先预留，不会摊进每日额度</p></div>
        <button type="button" class="button secondary small" data-action="add-plan">＋ 添加</button>
      </div>
      ${shownPlanned.length ? shownPlanned.map(renderPlanItem).join("") : `<div class="empty-state"><div class="empty-icon">🏋️</div><p>健身课、GPT Plus、学校费用等<br>可以提前放在这里</p></div>`}
    </section>

    ${cycle.type === "bridge" ? `
      <button type="button" class="button wide" data-action="loan-arrived">助学贷款到了，开始年度预算</button>
      <p class="small-muted" style="text-align:center;margin:10px 0 0">当前结余会自动结转到新周期</p>` : ""}
  `;
}

function renderRecords() {
  const cycle = getActiveCycle(state);
  if (!cycle) return `<div class="notice danger">找不到当前预算周期。</div>`;
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  const isExpenses = recordTab === "expenses";
  const isTransfers = recordTab === "transfers";
  const records = (isExpenses ? state.expenses : isTransfers ? state.transfers : state.fundings)
    .filter((item) => item.cycleId === cycle.id)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));

  return `
    <div class="segmented three" role="tablist" aria-label="明细类型">
      <button type="button" data-record-tab="expenses" class="${isExpenses ? "is-active" : ""}">消费</button>
      <button type="button" data-record-tab="fundings" class="${!isExpenses && !isTransfers ? "is-active" : ""}">到账</button>
      <button type="button" data-record-tab="transfers" class="${isTransfers ? "is-active" : ""}">互转</button>
    </div>

    <section class="card">
      <div class="section-head">
        <div><h2>${isExpenses ? "这一轮花了什么" : isTransfers ? "账户之间挪钱" : "这一轮到了多少钱"}</h2><p>${fullDate(cycle.startDate)} — ${fullDate(cycle.endDate)}</p></div>
        <button type="button" class="button secondary small" data-action="${isExpenses ? "add-expense" : isTransfers ? "add-transfer" : "add-funding"}">＋ ${isTransfers ? "互转" : "记录"}</button>
      </div>
      ${records.length ? `<div class="record-list">${records.map((item) => renderRecord(item, isExpenses ? "expense" : isTransfers ? "transfer" : "funding")).join("")}</div>` : `
        <div class="empty-state">
          <div class="empty-icon">${isExpenses ? "🧾" : isTransfers ? "↔" : "¥"}</div>
          <p>${isExpenses ? "还没有消费记录<br>花完就顺手记一笔，额度才会准确" : isTransfers ? "还没有账户互转<br>例如微信转支付宝" : "还没有到账记录<br>收到生活费后记一笔"}</p>
        </div>`}
      <div class="budget-summary">
        <span>${isExpenses ? "本轮已花" : isTransfers ? "互转不影响总生活费" : "本轮已到账"}</span>
        <strong>${isTransfers ? `${records.length} 笔` : money(isExpenses ? totals.expenseCents : totals.fundingCents)}</strong>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><div><h2>备份与安装</h2><p>数据只在这台手机的浏览器里</p></div></div>
      <div class="settings-list">
        <button type="button" class="settings-row" data-action="export"><span><strong>导出 JSON 备份</strong><small>换手机或清缓存前保存一份</small></span><span class="chevron">›</span></button>
        <button type="button" class="settings-row" data-action="import"><span><strong>导入备份</strong><small>会先检查文件，再替换本机数据</small></span><span class="chevron">›</span></button>
        <button type="button" class="settings-row" data-action="install-help"><span><strong>添加到手机桌面</strong><small>像普通 App 一样打开，离线也能用</small></span><span class="chevron">›</span></button>
      </div>
      <div class="local-note" style="margin-top:13px">隐私说明：不登录、不上传、不读取银行卡。清除浏览器站点数据会删除账本，请定期导出备份。</div>
    </section>
  `;
}

function renderRecord(item, kind) {
  if (kind === "funding") {
    return `
      <div class="record">
        <div class="record-icon">¥</div>
        <div class="record-main">
          <div class="record-title"><span>${h(item.source || "到账")}</span></div>
          <div class="record-meta">${formatDateCN(item.date)} · ${h(accountName(item.accountId || "wechat"))}${item.note ? ` · ${h(item.note)}` : ""}</div>
        </div>
        <div class="record-line">
          <div class="record-value income">+${money(item.amountCents)}</div>
          <button type="button" class="record-delete" data-action="delete-funding" data-id="${h(item.id)}" aria-label="删除到账记录">×</button>
        </div>
      </div>`;
  }
  if (kind === "transfer") {
    return `
      <div class="record">
        <div class="record-icon">↔</div>
        <div class="record-main">
          <div class="record-title"><span>${h(accountName(item.fromAccountId))} → ${h(accountName(item.toAccountId))}</span></div>
          <div class="record-meta">${formatDateCN(item.date)}${item.note ? ` · ${h(item.note)}` : ""}</div>
        </div>
        <div class="record-line">
          <div class="record-value">${money(item.amountCents)}</div>
          <button type="button" class="record-delete" data-action="delete-transfer" data-id="${h(item.id)}" aria-label="删除互转记录">×</button>
        </div>
      </div>`;
  }
  const category = getCategory(item.categoryId);
  return `
    <div class="record">
      <div class="record-icon">${h(category?.icon || "•")}</div>
      <div class="record-main">
        <div class="record-title"><span>${h(category?.name || "其他")}</span></div>
        <div class="record-meta">${formatDateCN(item.date)} · ${h(accountName(item.accountId || "wechat"))}${item.note ? ` · ${h(item.note)}` : ""}</div>
      </div>
      <div class="record-line">
        <div class="record-value">-${money(item.amountCents)}</div>
        <button type="button" class="record-delete" data-action="delete-expense" data-id="${h(item.id)}" aria-label="删除消费记录">×</button>
      </div>
    </div>`;
}

function renderApp() {
  if (!state) return;
  ensureToday();
  const cycle = getActiveCycle(state);
  if (cycleEyebrow) cycleEyebrow.textContent = cycle?.type === "bridge" ? "助学贷款前 · 生存模式" : "年度生活费 · 仅本机保存";
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === currentTab));
  const output = currentTab === "plan" ? renderPlan() : currentTab === "records" ? renderRecords() : renderHome();
  appView.innerHTML = output;
  appView.style.animation = "none";
  void appView.offsetWidth;
  appView.style.animation = "";
}


function categoryOptions(selectedId) {
  return categoriesOfActiveCycle().map((category) => `
    <option value="${h(category.id)}" ${category.id === selectedId ? "selected" : ""}>${h(category.icon)} ${h(category.name)}</option>
  `).join("");
}

function openModal({ title, description = "", body = "", formType = "", submitLabel = "保存", hideSubmit = false }) {
  const form = formType
    ? `<form id="modal-form" data-form="${h(formType)}">${body}<div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button>${hideSubmit ? "" : `<button type="submit" class="button">${h(submitLabel)}</button>`}</div></form>`
    : body;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-handle"></div>
        <div class="modal-head">
          <div><h2 id="modal-title">${h(title)}</h2>${description ? `<p>${description}</p>` : ""}</div>
          <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        ${form}
      </section>
    </div>`;
  document.body.classList.add("modal-open");
  setTimeout(() => {
    const first = modalRoot.querySelector("input:not([type=hidden]), button, select, textarea");
    if (first) first.focus();
  }, 60);
}

function closeModal() {
  modalRoot.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function openExpenseModal(options = {}) {
  const preset = typeof options === "string" ? { categoryId: options } : options;
  const categories = categoriesOfActiveCycle();
  const firstCategory = categories.find((item) => item.kind === "essential") || categories[0];
  const categoryId = preset.categoryId || firstCategory?.id;
  const accountId = ACCOUNT_IDS.includes(preset.accountId) ? preset.accountId : "wechat";
  const cycle = getActiveCycle(state);
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  openModal({
    title: preset.title || "记一笔",
    description: accountId === "alipay"
      ? "这笔从支付宝扣。洗衣机、吹风机只能支付宝付款，保存后会同时更新支付宝余额。"
      : "金额按实际花出去的现金记录，保存后每日额度和账户余额会立即重算。",
    formType: "expense",
    submitLabel: "记下来",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>花了多少钱</span><input name="amount" data-testid="expense-amount" inputmode="decimal" autocomplete="off" value="${preset.amountCents ? centsToInput(preset.amountCents) : ""}" placeholder="0.00" required><small class="form-help">单位：元</small></label>
        <label class="field"><span>分类</span><select name="categoryId" data-testid="expense-category">${categoryOptions(categoryId)}</select></label>
        <label class="field"><span>付款账户</span><select name="accountId" data-testid="expense-account">${accountOptions(accountId)}</select><small class="form-help">微信 ${money(totals.accountBalancesCents.wechat, true)} · 支付宝 ${money(totals.accountBalancesCents.alipay, true)}</small></label>
        <label class="field"><span>日期</span><input name="date" type="date" value="${lastToday}" required></label>
        <label class="field"><span>备注（可选）</span><input name="note" maxlength="80" value="${h(preset.note || "")}" placeholder="比如：午饭、公交"></label>
      </div>`
  });
}

function openFundingModal() {
  openModal({
    title: "记一笔到账",
    description: "金额随时都能补记，并注明钱到了微信还是支付宝。",
    formType: "funding",
    submitLabel: "记录到账",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>到账金额</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" required><small class="form-help">单位：元</small></label>
        <label class="field"><span>到账账户</span><select name="accountId">${accountOptions("wechat")}</select></label>
        <label class="field"><span>来源</span><input name="source" maxlength="30" value="生活费" required></label>
        <label class="field"><span>日期</span><input name="date" type="date" value="${lastToday}" required></label>
        <label class="field"><span>备注（可选）</span><input name="note" maxlength="80" placeholder="比如：父母转入"></label>
      </div>`
  });
}

function openTransferModal() {
  const cycle = getActiveCycle(state);
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  openModal({
    title: "账户互转",
    description: "只移动钱的位置，不改变总生活费，也不影响每日额度。",
    formType: "transfer",
    submitLabel: "记录互转",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>转账金额</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" required><small class="form-help">单位：元，不会计入消费</small></label>
        <label class="field"><span>从哪个账户转出</span><select name="fromAccountId">${accountOptions("wechat")}</select></label>
        <label class="field"><span>转到哪个账户</span><select name="toAccountId">${accountOptions("alipay")}</select></label>
        <label class="field"><span>日期</span><input name="date" type="date" value="${lastToday}" required></label>
        <label class="field"><span>备注（可选）</span><input name="note" maxlength="80" placeholder="例如：留出洗衣和吹风钱"></label>
        <p class="form-help">当前余额：微信 ${money(totals.accountBalancesCents.wechat, true)} · 支付宝 ${money(totals.accountBalancesCents.alipay, true)}</p>
      </div>`
  });
}

function openBudgetModal(categoryId) {
  const category = getCategory(categoryId);
  if (!category) return;
  const cycle = getActiveCycle(state);
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  const limit = Math.max(0, totals.fundingCents - totals.protectedReserveCents);
  const maxForThis = Math.max(0, limit - totals.totalBudgetCents + category.budgetCents);
  openModal({
    title: `修改「${category.name}」预算`,
    description: `整轮最多可分配 ${money(limit)}；这个分类最多能设为 ${money(maxForThis)}。`,
    formType: "budget",
    submitLabel: "更新预算",
    body: `
      <input type="hidden" name="categoryId" value="${h(category.id)}">
      <div class="form-grid">
        <label class="field amount-field"><span>整轮预算</span><input name="amount" inputmode="decimal" autocomplete="off" value="${centsToInput(category.budgetCents)}" required><small class="form-help">填 0 可以取消这个分类的预算</small></label>
      </div>`
  });
}

function openDateModal(presetDate = "") {
  const cycle = getActiveCycle(state);
  if (!cycle || cycle.type !== "bridge") return;
  const minDate = cycle.loanWindowStart || "2026-11-01";
  const maxDate = cycle.loanWindowEnd || "2026-12-31";
  const choices = ["2026-11-30", "2026-12-15", maxDate]
    .filter((date, index, arr) => date >= minDate && date <= maxDate && arr.indexOf(date) === index);
  openModal({
    title: "更新预计到账日",
    description: "不知道具体日期时，按最晚可能日期规划最稳。",
    formType: "planning-date",
    submitLabel: "按这个日期计算",
    body: `
      <div class="form-grid">
        <label class="field"><span>预计到账日</span><input name="date" type="date" min="${h(minDate)}" max="${h(maxDate)}" value="${h(presetDate || cycle.endDate)}" required></label>
        <div>
          <span class="small-muted">快速选择</span>
          <div class="choice-row" style="margin-top:8px">${choices.map((date) => `<button type="button" class="choice" data-action="fill-date" data-date="${h(date)}">${formatDateCN(date)}</button>`).join("")}</div>
        </div>
        <p class="form-help">每日额度 = 可安排现金 ÷ 到预计日期的剩余天数。更新后首页会立即重算。</p>
      </div>`
  });
}

function openAnnualArrivalModal() {
  const cycle = getActiveCycle(state);
  if (!cycle) return;
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  const carryover = Math.max(0, totals.cashCents);
  openModal({
    title: "开始年度生活费",
    description: "记录实际到账金额，结束过渡期，并把当前结余一起结转。",
    formType: "annual-arrival",
    submitLabel: "开始年度预算",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>助学贷款到账金额</span><input name="amount" inputmode="decimal" value="20000" required><small class="form-help">按实际到账金额填写，单位：元</small></label>
        <label class="field"><span>钱到哪个账户</span><select name="accountId">${accountOptions("bank")}</select></label>
        <label class="field"><span>年度周期开始日</span><input name="startDate" type="date" value="${lastToday}" required></label>
        <div class="info-tile"><span>从当前周期自动结转</span><strong>${money(carryover)}</strong></div>
        <p class="form-help">新周期默认持续一年，并继续保留 ${Math.round(Number(cycle.safetyRate) * 100)}% 安全缓冲。分类预算额度会重新从 0 开始分配。</p>
      </div>`
  });
}

function openPlanItemModal() {
  const categories = categoriesOfActiveCycle();
  const defaultCategory = categories.find((item) => item.key === "fitness") || categories[0];
  openModal({
    title: "添加大额计划",
    description: "先把未来要付的钱留出来，每日额度就不会被高估。",
    formType: "planned-item",
    submitLabel: "加入计划",
    body: `
      <div class="form-grid">
        <label class="field"><span>计划名称</span><input name="title" maxlength="40" value="健身课 10 次" required></label>
        <label class="field amount-field"><span>预计金额</span><input name="amount" inputmode="decimal" placeholder="900" required><small class="form-help">单位：元</small></label>
        <label class="field"><span>分类</span><select name="categoryId">${categoryOptions(defaultCategory?.id)}</select></label>
        <label class="field"><span>预计付款账户</span><select name="accountId">${accountOptions("wechat")}</select></label>
        <label class="field"><span>预计支付日</span><input name="dueDate" type="date" value="${lastToday}" required></label>
        <label class="field"><span>课程次数（可选）</span><input name="sessions" inputmode="numeric" placeholder="例如：10"><small class="form-help">填了次数后，付款只扣一次钱；以后上课只减次数。</small></label>
        <label class="field"><span>备注（可选）</span><input name="note" maxlength="80" placeholder="例如：900 元 10 节课"></label>
      </div>`
  });
}

function openReserveModal() {
  const cycle = getActiveCycle(state);
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  openModal({
    title: "动用安全缓冲",
    description: "这是最后防线。释放后，这笔钱会重新进入每日可花额度。",
    formType: "release-reserve",
    submitLabel: "确认释放",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>释放金额</span><input name="amount" inputmode="decimal" value="${centsToInput(totals.protectedReserveCents)}" required><small class="form-help">当前最多可释放 ${money(totals.protectedReserveCents)}</small></label>
        <label class="field"><span>原因</span><input name="note" maxlength="80" value="真的不够用了"></label>
      </div>`
  });
}

function openSafetyModal() {
  const cycle = getActiveCycle(state);
  const percent = Math.round(Number(cycle.safetyRate) * 100);
  openModal({
    title: "修改安全缓冲",
    description: "建议保留 20%，只有明确需要时才调低。",
    formType: "safety-rate",
    submitLabel: "更新比例",
    body: `
      <div class="form-grid">
        <label class="field amount-field"><span>安全缓冲比例</span><input name="percent" inputmode="decimal" value="${percent}" required><small class="form-help">可填 0—50，单位 %。修改后会立即重算每日额度。</small></label>
      </div>`
  });
}

function openSettingsModal() {
  const cycle = getActiveCycle(state);
  const totals = computeCycleTotals(state, cycle.id, lastToday);
  openModal({
    title: "设置",
    description: "所有数据仅保存在当前浏览器。",
    body: `
      <div class="settings-list">
        <button type="button" class="settings-row" data-action="edit-safety"><span><strong>安全缓冲 ${Math.round(Number(cycle.safetyRate) * 100)}%</strong><small>当前 ${money(totals.protectedReserveCents)} 未进入每日额度</small></span><span class="chevron">›</span></button>
        ${cycle.type === "bridge" ? `<button type="button" class="settings-row" data-action="adjust-date"><span><strong>预计到账日</strong><small>当前按 ${formatDateCN(cycle.endDate)} 计算</small></span><span class="chevron">›</span></button>` : ""}
        <button type="button" class="settings-row" data-action="export"><span><strong>导出备份</strong><small>保存为 JSON 文件</small></span><span class="chevron">›</span></button>
        <button type="button" class="settings-row" data-action="import"><span><strong>导入备份</strong><small>替换当前本机数据</small></span><span class="chevron">›</span></button>
        <button type="button" class="settings-row" data-action="install-help"><span><strong>安装到手机桌面</strong><small>查看 iPhone / 安卓步骤</small></span><span class="chevron">›</span></button>
      </div>
      <div class="local-note" style="margin-top:14px">版本 1.0 · 人民币 · 无账号、无云端同步。清理浏览器数据会丢失账本，请定期导出备份。</div>`
  });
}

function openInstallHelpModal() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const button = installPrompt ? `<button type="button" class="button wide" data-action="prompt-install" style="margin-top:15px">立即添加到桌面</button>` : "";
  openModal({
    title: "添加到手机桌面",
    description: "安装后可以像普通 App 一样打开，断网也能查看账本。",
    body: `
      <div class="form-grid">
        <div class="info-tile"><span>${isIOS ? "iPhone / iPad" : "安卓手机"}</span><strong style="font-size:13px;line-height:1.7">${isIOS ? "Safari 底部“分享” → “添加到主屏幕”" : "浏览器菜单 → “安装应用”或“添加到主屏幕”"}</strong></div>
        <p class="form-help">如果找不到入口，请先使用 Chrome（安卓）或 Safari（iPhone）打开本页，并确认地址是 HTTPS。</p>
        ${button}
        <div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">关闭</button></div>
      </div>`
  });
}

async function exportBackup() {
  const stamp = lastToday.replaceAll("-", "");
  const text = JSON.stringify(state, null, 2);
  const filename = `生活费规划-备份-${stamp}.json`;
  const file = new File([text], filename, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "生活费规划备份", files: [file] });
      showToast("备份已分享");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("备份文件已生成");
}

function chooseImportFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      validateState(parsed);
      if (!confirm("导入会覆盖当前手机上的全部账本数据，确定继续吗？")) return;
      closeModal();
      currentTab = "home";
      await commit(parsed, "备份导入成功");
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    }
  });
  input.click();
}

async function handleAction(action, data) {
  switch (action) {
    case "add-expense": openExpenseModal(); break;
    case "quick-laundry": {
      const category = categoriesOfActiveCycle().find((item) => item.key === "laundry");
      openExpenseModal({ title: "记录洗衣机", categoryId: category?.id, accountId: "alipay", amountCents: 60, note: "洗衣机" });
      break;
    }
    case "quick-hairdryer": {
      const category = categoriesOfActiveCycle().find((item) => item.key === "hairdryer");
      openExpenseModal({ title: "记录吹风机", categoryId: category?.id, accountId: "alipay", amountCents: 100, note: "吹风机" });
      break;
    }
    case "quick-shop": {
      const category = categoriesOfActiveCycle().find((item) => item.key === "daily");
      openExpenseModal({ title: "学校商店购物", categoryId: category?.id, accountId: "wechat" });
      break;
    }
    case "add-funding": openFundingModal(); break;
    case "add-transfer": openTransferModal(); break;
    case "edit-budget": openBudgetModal(data.id); break;
    case "adjust-date": openDateModal(); break;
    case "set-scenario-date": openDateModal(data.date); break;
    case "loan-arrived": openAnnualArrivalModal(); break;
    case "release-reserve": openReserveModal(); break;
    case "edit-safety": openSafetyModal(); break;
    case "add-plan": openPlanItemModal(); break;
    case "mark-paid": {
      const item = state.plannedItems.find((entry) => entry.id === data.id);
      if (!item) throw new Error("计划支出不存在");
      if (!confirm(`确认已经支付「${item.title}」${money(item.amountCents)}？`)) return;
      await commit(markPlannedPaid(state, data.id, lastToday), item.totalSessions > 0 ? "已支付，剩余次数已建立" : "已记作支付");
      break;
    }
    case "use-session": {
      const item = state.plannedItems.find((entry) => entry.id === data.id);
      if (!item) throw new Error("课程包不存在");
      await commit(recordPackageUse(state, data.id, lastToday), `已消课，还剩 ${Math.max(0, item.remainingSessions - 1)} 次`);
      break;
    }
    case "delete-plan": {
      const item = state.plannedItems.find((entry) => entry.id === data.id);
      if (!item) throw new Error("计划支出不存在");
      if (!confirm(`删除计划「${item.title}」？`)) return;
      await commit(deletePlannedItem(state, data.id), "计划已删除");
      break;
    }
    case "delete-expense": {
      const item = state.expenses.find((entry) => entry.id === data.id);
      if (!item) throw new Error("消费记录不存在");
      if (!confirm("删除这笔消费记录？如果它属于课程包，次数会恢复。")) return;
      await commit(deleteExpense(state, data.id), "消费记录已删除");
      break;
    }
    case "delete-funding": {
      const item = state.fundings.find((entry) => entry.id === data.id);
      if (!item) throw new Error("到账记录不存在");
      if (!confirm(`删除「${item.source}」${money(item.amountCents)} 这笔到账记录？`)) return;
      const cycle = getActiveCycle(state);
      const totals = computeCycleTotals(state, cycle.id, lastToday);
      if (totals.cashCents - item.amountCents < 0) throw new Error("删除后现金会变成负数，请先核对或删除相关消费记录");
      await commit(deleteFunding(state, data.id), "到账记录已删除");
      break;
    }
    case "delete-transfer": {
      const item = state.transfers.find((entry) => entry.id === data.id);
      if (!item) throw new Error("互转记录不存在");
      if (!confirm(`删除${accountName(item.fromAccountId)} → ${accountName(item.toAccountId)} ${money(item.amountCents)} 这笔互转？`)) return;
      await commit(deleteTransfer(state, data.id), "互转记录已删除");
      break;
    }
    case "export": await exportBackup(); break;
    case "import": chooseImportFile(); break;
    case "install-help": openInstallHelpModal(); break;
    case "prompt-install": {
      if (!installPrompt) { showToast("请按页面步骤手动添加"); return; }
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      closeModal();
      break;
    }
    case "open-settings": openSettingsModal(); break;
    case "fill-date": {
      const input = modalRoot.querySelector('input[name="date"]');
      if (input) input.value = data.date;
      break;
    }
    case "close-modal": closeModal(); break;
    default: break;
  }
}

async function handleFormSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const errorEl = form.querySelector(".form-error");
  const submitButton = form.querySelector('button[type="submit"]');
  if (errorEl) errorEl.classList.remove("is-visible");
  if (submitButton) submitButton.disabled = true;
  try {
    const fd = new FormData(form);
    let message = "";
    if (kind === "expense") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      if (amountCents <= 0) throw new Error("消费金额必须大于 0");
      const next = addExpense(state, {
        amountCents,
        categoryId: String(fd.get("categoryId")),
        accountId: String(fd.get("accountId")),
        date: String(fd.get("date")),
        note: String(fd.get("note") || "")
      });
      await commit(next);
      message = "已记一笔";
    } else if (kind === "funding") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      if (amountCents <= 0) throw new Error("到账金额必须大于 0");
      const next = addFunding(state, {
        amountCents,
        source: String(fd.get("source") || "生活费"),
        accountId: String(fd.get("accountId")),
        date: String(fd.get("date")),
        note: String(fd.get("note") || "")
      });
      await commit(next);
      message = "到账已记录";
    } else if (kind === "transfer") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      if (amountCents <= 0) throw new Error("转账金额必须大于 0");
      const next = addTransfer(state, {
        amountCents,
        fromAccountId: String(fd.get("fromAccountId")),
        toAccountId: String(fd.get("toAccountId")),
        date: String(fd.get("date")),
        note: String(fd.get("note") || "")
      });
      await commit(next);
      message = "账户互转已记录";
    } else if (kind === "budget") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      const next = updateCategoryBudget(state, String(fd.get("categoryId")), amountCents);
      await commit(next);
      message = "分类预算已更新";
    } else if (kind === "planning-date") {
      const next = updatePlanningEndDate(state, String(fd.get("date")));
      await commit(next);
      message = "到账日期已更新";
    } else if (kind === "annual-arrival") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      const next = startAnnualCycle(state, {
        amountCents,
        accountId: String(fd.get("accountId")),
        startDate: String(fd.get("startDate")),
        todayIso: lastToday
      });
      currentTab = "plan";
      await commit(next);
      message = "年度预算已开始";
    } else if (kind === "planned-item") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      const sessionsText = String(fd.get("sessions") || "").trim();
      const plannedItemPayload = {
        title: String(fd.get("title") || ""),
        amountCents,
        categoryId: String(fd.get("categoryId")),
        accountId: String(fd.get("accountId")),
        dueDate: String(fd.get("dueDate")),
        date: String(fd.get("dueDate")),
        totalSessions: sessionsText ? Number(sessionsText) : 0,
        note: String(fd.get("note") || "")
      };
      const next = addPlannedItem(state, plannedItemPayload);
      await commit(next);
      message = "大额计划已加入";
    } else if (kind === "release-reserve") {
      const amountCents = parseYuanToCents(fd.get("amount"));
      const next = releaseReserve(state, amountCents, lastToday, String(fd.get("note") || "真的不够用了"));
      await commit(next);
      message = "安全缓冲已释放";
    } else if (kind === "safety-rate") {
      const percent = Number(fd.get("percent"));
      if (!Number.isFinite(percent) || percent < 0 || percent > 50) throw new Error("比例应在 0—50 之间");
      const rate = percent / 100;
      const next = cloneState(state);
      const cycle = getActiveCycle(next);
      const totals = computeCycleTotals(state, cycle.id, lastToday);
      const newLimit = Math.max(0, totals.fundingCents - Math.round(totals.fundingCents * rate));
      if (totals.totalBudgetCents > newLimit) throw new Error(`现有分类预算已超过新的可分配额度 ${money(newLimit)}，请先调低分类预算`);
      cycle.safetyRate = rate;
      next.settings.safetyRate = rate;
      next.settings.updatedAt = new Date().toISOString();
      await commit(next);
      message = "安全缓冲比例已更新";
    }
    closeModal();
    if (message) showToast(message);
  } catch (error) {
    if (errorEl) {
      errorEl.textContent = error.message || "保存失败，请重试";
      errorEl.classList.add("is-visible");
      errorEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      showToast(error.message || "保存失败");
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const navTab = event.target.closest(".tab[data-tab]");
    if (navTab) {
      currentTab = navTab.dataset.tab;
      renderApp();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const recordButton = event.target.closest("[data-record-tab]");
    if (recordButton) {
      recordTab = recordButton.dataset.recordTab;
      renderApp();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.preventDefault();
      try {
        await handleAction(actionButton.dataset.action, actionButton.dataset);
      } catch (error) {
        showToast(error.message || "操作失败");
      }
      return;
    }
    if (event.target === modalRoot) closeModal();
  });

  document.addEventListener("submit", handleFormSubmit);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    showToast("已添加到手机桌面");
  });

  window.addEventListener("online", () => showToast("网络已恢复"));
  window.addEventListener("offline", () => showToast("当前离线，账本仍可正常使用"));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const before = lastToday;
    lastToday = todayLocalISO();
    if (before !== lastToday) renderApp();
  });

  setInterval(() => {
    const nextToday = todayLocalISO();
    if (nextToday !== lastToday) {
      lastToday = nextToday;
      renderApp();
    }
  }, 60000);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !["http:", "https:"].includes(location.protocol)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    console.warn("Service Worker 注册失败", error);
  }
}

function ensureToday() {
  const nextToday = todayLocalISO();
  if (nextToday !== lastToday) lastToday = nextToday;
}

async function init() {
  try {
    const loaded = await loadState();
    if (loaded) {
      validateState(loaded);
      state = loaded;
    } else {
      state = createInitialState(lastToday);
      await saveState(state);
    }
    bindEvents();
    renderApp();
    requestPersistentStorage().catch(() => false);
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    appView.innerHTML = `<div class="notice danger"><div><strong>账本暂时打不开</strong>${h(error.message || "未知错误")}<br><br>请不要清理浏览器数据，先尝试刷新。</div></div>`;
    quickAdd.disabled = true;
  }
}

init();











