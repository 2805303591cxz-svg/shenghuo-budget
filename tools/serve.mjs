/* serve.mjs —— 零依赖静态文件服务器（本机预览 / 测试用）
 * 用法： node serve.mjs --root dist --port 8123
 *      import { startServer } from "./serve.mjs"
 * 也可直接拷进项目的 tools/ 目录使用。
 *//* serve.js —— 零依赖静态文件服务器（本地测试 / 电脑上直接打开用）
 * 用法： node tools/serve.js --root dist --port 8123
 *      import { startServer } from "./serve.js"
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".traineddata": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

export function startServer(opt) {
  const o = Object.assign({ root: "dist", port: 0, host: "127.0.0.1" }, opt || {});
  const root = path.resolve(o.root);
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.resolve(root, "." + rel);
      if (!file.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("404 " + rel);
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      const size = fs.statSync(file).size;
      if (ext === ".gz") {
        res.writeHead(200, { "content-type": type, "content-length": size, "cache-control": "public, max-age=31536000" });
      } else {
        res.writeHead(200, { "content-type": type, "content-length": size, "cache-control": "no-store" });
      }
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("500 " + e.message);
    }
  });
  return new Promise((resolve) => {
    server.listen(o.port, o.host, () => {
      const port = server.address().port;
      resolve({
        server: server,
        port: port,
        origin: "http://" + o.host + ":" + port,
        url: (p) => "http://" + o.host + ":" + port + (p || "/"),
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
  const s = await startServer({ root: get("root", "dist"), port: Number(get("port", 8123)), host: get("host", "0.0.0.0") });
  console.log("本地服务已启动： " + s.origin + "  （根目录 " + path.resolve(get("root", "dist")) + "）");
  console.log("按 Ctrl+C 停止");
}