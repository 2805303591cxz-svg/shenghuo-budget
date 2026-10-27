/* browser.mjs —— 极简 CDP 驱动（只用 Node 内置 WebSocket，不装任何依赖）
 * 用法：
 *   import { launch } from "./browser.mjs";
 *   const br = await launch({ viewport: { width: 375, height: 812 }, mobile: true, name: "e2e" });
 *   await br.goto("http://127.0.0.1:8123/index.html");
 *   await br.waitFor("!!document.querySelector('#app')");
 *   await br.evaluate("window.foo = 1");
 *   await br.screenshot("out.png");
 *   await br.close();
 * 注意：默认 --no-proxy-server（用户机器上的系统代理可能没节点，会把 HTTPS 全弄挂）；
 *      每个实例用独立 profile，可选 profileDir 复用（保留 Service Worker 缓存）、
 *      useSystemProxy: true 走系统代理。
 *//* browser.js —— 极简 CDP 驱动（用 Node 内置 WebSocket，不装任何依赖）
 * 提供：launch({viewport,mobile,name}) → {goto, evaluate, screenshot, waitFor, logs, close}
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TMP = path.join(HERE, "..", "_tmp");

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

export function findBrowser() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error("找不到 Edge/Chrome，测试无法进行");
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SEND_TIMEOUT = 60000;          // 普通请求超时（断了就报错，绝不永久挂起）
const EVAL_TIMEOUT = 150000;         // 页面脚本可能跑很久（OCR 等）

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { reject(e); return; }
    let id = 0;
    let dead = null;
    const pending = new Map();
    const listeners = [];
    const failAll = (err) => {
      dead = err;
      for (const [mid, p] of pending) { clearTimeout(p.timer); p.rej(err); }
      pending.clear();
    };
    const api = {
      send(method, params, timeoutMs) {
        if (dead) return Promise.reject(dead);
        return new Promise((res, rej) => {
          const mid = ++id;
          const timer = setTimeout(() => {
            pending.delete(mid);
            rej(new Error("CDP 超时（" + method + "），可能是页面卡住或连接已断"));
          }, timeoutMs || SEND_TIMEOUT);
          pending.set(mid, { res: res, rej: rej, timer: timer });
          try { ws.send(JSON.stringify({ id: mid, method: method, params: params || {} })); }
          catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch (e) { /* ignore */ } }
    };
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", () => { const e = new Error("CDP WebSocket 连接失败"); failAll(e); reject(e); });
    ws.addEventListener("close", () => failAll(new Error("CDP WebSocket 已断开（浏览器可能被挂起或关闭）")));
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.rej(new Error(msg.error.message + " (" + JSON.stringify(msg.error.data || "") + ")"));
        else p.res(msg.result);
        return;
      }
      if (msg.method) for (const fn of listeners) fn(msg);
    });
  });
}

export async function launch(opt) {
  const o = Object.assign({ viewport: { width: 1280, height: 900 }, mobile: false, name: "run" }, opt || {});
  fs.mkdirSync(TMP, { recursive: true });
  const ownProfile = !o.profileDir;
  const profile = o.profileDir || path.join(TMP, "profile-" + o.name + "-" + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  // 预先写好 Preferences：跳过 Edge 的首次运行/欢迎页/同步确认（否则会往测试浏览器里塞
  // ChatGPT 扩展安装页和 edge://sync-confirmation-dialog，甚至把浏览器实例搞崩）
  try {
    fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Default", "Preferences"), JSON.stringify({
      first_run_complete: true,
      exit_type: "Normal",
      profile: { exit_type: "Normal" },
      browser: { has_seen_welcome_page: true, check_default_browser: false },
      sync: { requested: false, stopped: true },
      distribution: { skip_first_run_ui: true, import_bookmarks: false, import_search_engine: false, do_not_create_desktop_shortcut: true, do_not_create_taskbar_shortcut: true },
      edge_first_run: false,
      onboarding: { onboarding_done: true }
    }), "utf8");
  } catch (e) { /* ignore */ }
  const bin = findBrowser();
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-session-crashed-bubble", "--disable-extensions", "--disable-sync",
    "--no-service-autorun", "--disable-background-networking", "--disable-component-update",
    "--enable-automation", "--disable-search-engine-choice-screen",
    "--disable-features=Translate,msEdgeFirstRunExperience,msEdgeSync,msEdgeIdentity,msEdgeSidebarV2,msEdgeCollections,EdgeShoppingAssistant",
    "--remote-debugging-port=0", "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--window-size=" + o.viewport.width + "," + o.viewport.height,
    (o.useSystemProxy ? "--no-proxy-server=0" : "--no-proxy-server"),   // 默认不走系统代理（用户机器上的 Clash 可能没节点）
    "about:blank"
  ];
  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("浏览器启动超时\n" + buf)), 40000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.on("exit", (c) => { clearTimeout(t); reject(new Error("浏览器提前退出 code=" + c + "\n" + buf)); });
  });

  // 取页面 target
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    target = list.find(t => t.type === "page");
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("拿不到页面调试目标");

  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  if (o.viewport) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: o.viewport.width, height: o.viewport.height, deviceScaleFactor: 1, mobile: !!o.mobile
    });
  }

  const logs = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push("[console." + msg.params.type + "] " + msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      logs.push("[exception] " + (d.exception && d.exception.description ? d.exception.description : d.text));
    } else if (msg.method === "Log.entryAdded") {
      logs.push("[log." + msg.params.entry.level + "] " + msg.params.entry.text);
    }
  });
  await cdp.send("Log.enable").catch(() => {});

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { cdp.close(); } catch (e) { /* ignore */ }
    await sleep(120);
    try { proc.kill(); } catch (e) { /* ignore */ }
    await new Promise((r) => spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" }).on("exit", r));
    if (ownProfile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  }

  return {
    port: port,
    logs: logs,
    cdp: cdp,
    async goto(url, waitMs) {
      const done = new Promise((res) => {
        const t = setTimeout(res, waitMs === undefined ? 20000 : waitMs);
        cdp.on((m) => { if (m.method === "Page.loadEventFired") { clearTimeout(t); res(); } });
      });
      await cdp.send("Page.navigate", { url: url });
      await done;
      await sleep(120);
    },
    async evaluate(expression, awaitPromise) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: expression,
        awaitPromise: awaitPromise !== false,
        returnByValue: true,
        userGesture: true,
        timeout: 180000
      }, EVAL_TIMEOUT);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error("页面脚本异常：" + ((d.exception && (d.exception.description || d.exception.value)) || d.text || JSON.stringify(d)));
      }
      return r.result.value;
    },
    async waitFor(expression, timeoutMs, intervalMs) {
      const t = timeoutMs === undefined ? 20000 : timeoutMs;
      const iv = intervalMs || 200;
      const deadline = Date.now() + t;
      while (Date.now() < deadline) {
        const v = await this.evaluate(expression);
        if (v) return v;
        await sleep(iv);
      }
      throw new Error("等待超时：" + expression);
    },
    async screenshot(file) {
      const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    },
    close: close
  };
}