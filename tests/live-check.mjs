import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { launch, sleep } from "../tools/browser.mjs";

const LIVE_URL = "https://2805303591cxz-svg.github.io/shenghuo-budget/";
const OUT = path.resolve(import.meta.dirname, "screenshots", "live-home-390x844.png");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const br = await launch({ viewport: { width: 390, height: 844 }, mobile: true, name: "live-check" });
try {
  await br.goto(LIVE_URL, 30000);
  await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 20000);
  assert.equal(await br.evaluate("document.querySelector('[data-testid=daily-cap]').textContent.trim()"), "¥1.47");
  assert.match(await br.evaluate("document.body.innerText"), /微信[\s\S]*¥73\.00[\s\S]*支付宝[\s\S]*¥49\.00/);
  assert.equal(await br.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await br.screenshot(OUT);

  await br.evaluate("navigator.serviceWorker.ready.then(() => true)");
  const controlled = await br.evaluate("navigator.serviceWorker.controller !== null");
  assert.equal(controlled, true, "Service Worker 未接管页面");

  await br.cdp.send("Network.enable");
  await br.cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  });
  await br.evaluate("location.reload(); true");
  await sleep(1000);
  await br.waitFor("!!document.querySelector('[data-testid=daily-cap]')", 15000);
  assert.match(await br.evaluate("document.body.innerText"), /生活费规划/);
  await br.cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  });
  assert.equal(br.logs.some((line) => line.startsWith("[exception]")), false, br.logs.join("\n"));
  console.log("线上验收通过：" + LIVE_URL);
  console.log("截图：" + OUT);
} finally {
  await br.close();
}
