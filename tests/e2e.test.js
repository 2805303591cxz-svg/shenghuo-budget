import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../tools/serve.mjs";
import { launch, sleep } from "../tools/browser.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "tests", "screenshots");

async function setInput(br, selector, value) {
  await br.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error(${JSON.stringify("找不到输入框 " + selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function submitModal(br) {
  await br.evaluate(`document.querySelector("#modal-form").requestSubmit()`);
  await br.waitFor("!document.querySelector('#modal-form')", 8000);
}

test("手机端主流程、持久化、年度切换与离线可用", async () => {
  const server = await startServer({ root: path.join(ROOT, "dist"), port: 0, host: "127.0.0.1" });
  const br = await launch({ viewport: { width: 375, height: 812 }, mobile: true, name: "budget-e2e" });
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    await br.goto(server.url("/index.html"));
    await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 12000);
    assert.equal(await br.evaluate("document.querySelector('[data-testid=daily-cap]').textContent.trim()"), "¥1.47");
    assert.match(await br.evaluate("document.body.innerText"), /11月—12月/);
    assert.match(await br.evaluate("document.body.innerText"), /助学贷款 · 具体日期未知/);
    assert.match(await br.evaluate("document.body.innerText"), /微信[\s\S]*¥73\.00[\s\S]*支付宝[\s\S]*¥49\.00/);
    assert.match(await br.evaluate("document.body.innerText"), /洗衣 ¥0\.60[\s\S]*支付宝/);
    assert.equal(await br.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await br.screenshot(path.join(SHOTS, "home-bridge-375x812.png"));
    await br.evaluate("document.querySelector('[data-action=quick-laundry]').click()");
    await br.waitFor("!!document.querySelector('#modal-form')", 5000);
    assert.equal(await br.evaluate("document.querySelector('input[name=amount]').value"), "0.60");
    assert.equal(await br.evaluate("document.querySelector('select[name=accountId]').value"), "alipay");
    await submitModal(br);
    await br.waitFor("document.querySelector('[data-account=alipay] strong').textContent.includes('48.40')", 5000);

    await br.evaluate("document.querySelector('[data-action=add-expense]').click()");
    await br.waitFor("!!document.querySelector('#modal-form')", 5000);
    await setInput(br, 'input[name="amount"]', "5");
    await setInput(br, 'input[name="note"]', "午饭");
    await submitModal(br);
    await br.waitFor("document.querySelector('[data-testid=daily-cap]').textContent.includes('0.00')", 5000);
    assert.equal(await br.evaluate("document.querySelector('[data-testid=month-spent]').textContent.trim()"), "¥5.60");

    await br.goto(server.url("/index.html"));
    await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 8000);
    assert.equal(await br.evaluate("document.querySelector('[data-testid=daily-cap]').textContent.trim()"), "¥0.00");

    await br.evaluate("document.querySelector('.tab[data-tab=plan]').click()");
    await br.waitFor("document.body.innerText.includes('先稳住这一程')", 5000);
    await br.evaluate("document.querySelector('[data-action=adjust-date]').click()");
    await br.waitFor("!!document.querySelector('#modal-form')", 5000);
    await setInput(br, 'input[name="date"]', "2026-11-30");
    await submitModal(br);
    await br.waitFor("document.body.innerText.includes('当前按') && document.body.innerText.includes('11月30日')", 5000);

    await br.evaluate("navigator.serviceWorker.ready.then(() => true)");
    const controlled = await br.evaluate("navigator.serviceWorker.controller !== null");
    assert.equal(controlled, true);

    await br.cdp.send("Network.enable");
    await br.cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    await br.evaluate("location.reload(); true");
    await sleep(900);
    await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 12000);
    assert.match(await br.evaluate("document.body.innerText"), /生活费规划/);
    await br.cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });

    await br.evaluate("document.querySelector('.tab[data-tab=plan]').click()");
    await br.waitFor("document.body.innerText.includes('先稳住这一程')", 5000);
    await br.evaluate("document.querySelector('[data-action=loan-arrived]').click()");
    await br.waitFor("!!document.querySelector('#modal-form')", 5000);
    await setInput(br, 'input[name="amount"]', "20000");
    await setInput(br, 'input[name="startDate"]', "2026-12-01");
    await submitModal(br);
    await br.waitFor("document.body.innerText.includes('这一年怎么过')", 8000);
    assert.match(await br.evaluate("document.body.innerText"), /年度预算/);
    assert.match(await br.evaluate("document.body.innerText"), /2026—2027 年度生活费/);

    fs.mkdirSync(SHOTS, { recursive: true });
    await br.screenshot(path.join(SHOTS, "plan-375x812.png"));
    await br.evaluate("document.querySelector('.tab[data-tab=home]').click()");
    await br.waitFor("document.body.innerText.includes('年度总览')", 5000);
    await br.screenshot(path.join(SHOTS, "home-375x812.png"));
    assert.equal(await br.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.equal(br.logs.some((line) => line.startsWith("[exception]")), false, br.logs.join("\n"));
  } finally {
    await br.close();
    await server.close();
  }
});









test("390×844 视口布局和互转入口正常", async () => {
  const server = await startServer({ root: path.join(ROOT, "dist"), port: 0, host: "127.0.0.1" });
  const br = await launch({ viewport: { width: 390, height: 844 }, mobile: true, name: "budget-390" });
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    await br.goto(server.url("/index.html"));
    await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 12000);
    assert.equal(await br.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.equal(await br.evaluate("!!document.querySelector('[data-action=add-transfer]')"), true);
    await br.evaluate("document.querySelector('.tab[data-tab=records]').click()");
    await br.waitFor("document.body.innerText.includes('账户互转') || document.body.innerText.includes('互转')", 5000);
    assert.equal(await br.evaluate("document.querySelectorAll('[data-record-tab]').length"), 3);
    await br.screenshot(path.join(SHOTS, "records-390x844.png"));
    assert.equal(br.logs.some((line) => line.startsWith("[exception]")), false, br.logs.join("\n"));
  } finally {
    await br.close();
    await server.close();
  }
});
