/* build_site.mjs —— 打发布目录（拷源码 + 大件静态资源 + 数据），带"只准清理项目内 dist"的安全检查
 * 用法： node scripts/build_site.mjs
 * 复用：改 EXTRA 里那两行即可（额外要拷进 dist 的东西）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SRC = path.join(ROOT, "src");

/* 额外要拷进 dist 的：[源路径, dist 里的相对路径] */
const EXTRA = [
  // [path.join(ROOT, "assets", "vendor"), "vendor"],
  // [path.join(ROOT, "data", "dict.json"), "data/dict.json"]
];

function safeClean(dir) {
  const abs = path.resolve(dir);
  if (!abs.startsWith(ROOT + path.sep) || path.basename(abs) !== "dist") {
    throw new Error("拒绝清理非项目内 dist 目录：" + abs);
  }
  if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

safeClean(DIST);
copyDir(SRC, DIST);
for (const pair of EXTRA) {
  const from = pair[0], rel = pair[1];
  if (!fs.existsSync(from)) { console.warn("跳过（不存在）：" + from); continue; }
  const to = path.join(DIST, rel);
  if (fs.statSync(from).isDirectory()) copyDir(from, to);
  else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(DIST);
const total = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log("dist 已生成：" + DIST);
console.log("文件数 = " + files.length + "，总大小 = " + (total / 1024 / 1024).toFixed(2) + " MB");