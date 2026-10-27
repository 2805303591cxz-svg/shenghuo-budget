/* netlify.mjs —— 一条命令搞定：建站点（自动关掉默认的 SSO 访问保护）/ 带云函数部署 / 查状态
 *
 * 用法（在项目根目录执行）：
 *   node scripts/netlify.mjs create <站点名>        # 建站 + 记下 id + 关掉 SSO 保护
 *   node scripts/netlify.mjs deploy [--dir dist] [--functions functions]
 *   node scripts/netlify.mjs unprotect              # 关掉 SSO（新站点默认会开，匿名访问会 401）
 *   node scripts/netlify.mjs status
 *
 * 依赖：Netlify CLI 的登录态（token 从 %APPDATA%\netlify\Config\config.json 读），
 *      或环境变量 NETLIFY_AUTH_TOKEN；deploy 会用 CLI（路径可用 NETLIFY_CLI 指定）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const ID_FILE = path.join(ROOT, ".netlify-site-id");
const API = "https://api.netlify.com/api/v1";

function token() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const candidates = [];
  if (process.env.NETLIFY_CONFIG_DIR) {
    candidates.push(path.join(process.env.NETLIFY_CONFIG_DIR, "config.json"));
  }
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  candidates.push(path.join(appData, "netlify", "Config", "config.json"));
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    const user = Object.values(cfg.users || {})[0];
    if (user && user.auth && user.auth.token) return user.auth.token;
  }
  throw new Error("找不到 Netlify 登录令牌：先登录 Netlify CLI，或设置 NETLIFY_AUTH_TOKEN");
}

async function api(method, url, body) {
  const r = await fetch(API + url, {
    method: method,
    headers: { authorization: "Bearer " + token(), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  if (!r.ok) throw new Error(method + " " + url + " -> " + r.status + " " + (text || "").slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function siteId() {
  if (process.env.NETLIFY_SITE_ID) return process.env.NETLIFY_SITE_ID.trim();
  if (fs.existsSync(ID_FILE)) return fs.readFileSync(ID_FILE, "utf8").trim();
  throw new Error("找不到站点 id：先跑 create，或写进 .netlify-site-id，或用 NETLIFY_SITE_ID");
}

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const cmd = process.argv[2];

if (cmd === "create") {
  const name = process.argv[3];
  if (!name) { console.error("用法： node netlify.mjs create <站点名>"); process.exit(2); }
  const site = await api("POST", "/sites", { name: name });
  fs.writeFileSync(ID_FILE, site.id, "utf8");
  console.log("建站成功：" + site.ssl_url + "（id 已写入 .netlify-site-id）");
  try {
    await api("PATCH", "/sites/" + site.id, { sso_login: false });
    console.log("已关闭 SSO 访问保护（匿名可访问）");
  } catch (e) {
    console.warn("关 SSO 失败（可稍后跑 unprotect）：" + e.message);
  }
  console.log("下一步： node scripts/netlify.mjs deploy --dir dist --functions functions");
} else if (cmd === "unprotect") {
  await api("PATCH", "/sites/" + siteId(), { sso_login: false });
  console.log("已关闭 SSO 访问保护");
} else if (cmd === "status") {
  const s = await api("GET", "/sites/" + siteId());
  console.log(JSON.stringify({
    name: s.name, url: s.ssl_url, state: s.state,
    sso_login: s.sso_login, has_password: s.has_password,
    published: s.published_deploy ? s.published_deploy.ssl_url : null
  }, null, 2));
} else if (cmd === "deploy") {
  const dir = arg("dir", "dist");
  const functions = arg("functions", "");
  const cli = process.env.NETLIFY_CLI || "netlify";
  const args = ["deploy", "--prod", "--dir", path.resolve(ROOT, dir)];
  if (functions && fs.existsSync(path.join(ROOT, functions))) {
    args.push("--functions", path.resolve(ROOT, functions));
  }
  args.push("--site", siteId());
  console.log("执行：" + cli + " " + args.join(" "));
  const r = spawnSync(cli, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error("部署失败。若提示找不到 netlify 命令，用 NETLIFY_CLI 指定 CLI 的 js 路径；或先 npm i -g netlify-cli。");
    process.exit(r.status || 1);
  }
} else {
  console.log("用法： create <name> | deploy [--dir dist] [--functions functions] | unprotect | status");
}
