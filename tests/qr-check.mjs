import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "../tools/serve.mjs";
import { launch } from "../tools/browser.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED = "https://2805303591cxz-svg.github.io/shenghuo-budget/";
const OUT = path.join(ROOT, "tests", "screenshots", "live-qr.png");
const require = createRequire(import.meta.url);
const QR_DEPS = process.env.QR_DEPS || "D:/Codex/cache/node-qr/node_modules";
const { PNG } = require(path.join(QR_DEPS, "pngjs"));
const jsQR = require(path.join(QR_DEPS, "jsqr"));

const server = await startServer({ root: ROOT, port: 0, host: "127.0.0.1" });
const br = await launch({ viewport: { width: 500, height: 500 }, mobile: false, name: "qr-check" });
try {
  await br.goto(server.url("/_tmp/qr-check.html"));
  await br.waitFor("window.qrReady === true", 10000);
  await br.screenshot(OUT);
  const png = PNG.sync.read(fs.readFileSync(OUT));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded, "二维码无法反解");
  assert.equal(decoded.data, EXPECTED);
  console.log("二维码反解通过：" + decoded.data);
} finally {
  await br.close();
  await server.close();
}
