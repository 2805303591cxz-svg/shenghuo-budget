import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ID_FILE = path.join(ROOT, ".netlify-site-id");
const API = "https://api.netlify.com/api/v1";

function token() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const candidates = [];
  if (process.env.NETLIFY_CONFIG_DIR) candidates.push(path.join(process.env.NETLIFY_CONFIG_DIR, "config.json"));
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  candidates.push(path.join(appData, "netlify", "Config", "config.json"));
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const user = Object.values(config.users || {})[0];
    if (user?.auth?.token) return user.auth.token;
  }
  throw new Error("找不到 Netlify 登录令牌");
}

function siteId() {
  if (process.env.NETLIFY_SITE_ID) return process.env.NETLIFY_SITE_ID.trim();
  if (!fs.existsSync(ID_FILE)) throw new Error("缺少 .netlify-site-id，请先创建站点");
  return fs.readFileSync(ID_FILE, "utf8").trim();
}

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(full);
  }
  return output;
}

async function request(method, endpoint, body, contentType = "application/json") {
  const response = await fetch(API + endpoint, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": contentType },
    body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} → ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const id = siteId();
const files = walk(DIST);
const manifest = {};
for (const file of files) {
  const relative = "/" + path.relative(DIST, file).split(path.sep).join("/");
  manifest[relative] = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

console.log(`准备部署 ${files.length} 个文件到站点 ${id}`);
const deploy = await request("POST", `/sites/${id}/deploys`, JSON.stringify({ draft: false, files: manifest }));
console.log(`部署已创建：${deploy.id}，需要上传 ${(deploy.required || []).length} 个文件`);
for (const relative of deploy.required || []) {
  const local = path.join(DIST, relative.replace(/^\//, "").split("/").join(path.sep));
  const response = await fetch(`${API}/deploys/${deploy.id}/files${relative}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/octet-stream" },
    body: fs.readFileSync(local)
  });
  if (!response.ok) throw new Error(`上传失败 ${relative} → ${response.status} ${(await response.text()).slice(0, 300)}`);
  console.log(`已上传 ${relative}`);
}

for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const current = await request("GET", `/deploys/${deploy.id}`);
  console.log(`部署状态：${current.state}`);
  if (["ready", "current"].includes(current.state)) {
    const site = await request("GET", `/sites/${id}`);
    console.log(`线上地址：${site.ssl_url || site.url}`);
    process.exit(0);
  }
  if (current.state === "error") throw new Error("Netlify 部署进入 error 状态");
}
throw new Error("等待 Netlify 部署完成超时");
