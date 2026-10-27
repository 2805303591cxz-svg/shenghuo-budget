import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "src", "icons"));
fs.mkdirSync(OUT, { recursive: true });

const DRAW = `
window.drawIcon = function (size, maskable) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  const pad = maskable ? size * 0.18 : size * 0.08;
  g.fillStyle = "#23573f";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(255,255,255,0.07)";
  g.beginPath(); g.arc(size * 0.82, size * 0.15, size * 0.35, 0, Math.PI * 2); g.fill();

  const x = pad;
  const y = size * 0.28;
  const w = size - pad * 2;
  const h = size * 0.46;
  const r = size * 0.09;
  g.fillStyle = "#fff9ed";
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();

  g.fillStyle = "#e38a48";
  g.beginPath(); g.arc(x + w * 0.76, y + h * 0.55, size * 0.11, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#fff9ed";
  g.lineWidth = size * 0.025;
  g.beginPath(); g.arc(x + w * 0.76, y + h * 0.55, size * 0.045, 0, Math.PI * 2); g.stroke();

  g.strokeStyle = "#23573f";
  g.lineWidth = size * 0.028;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x + w * 0.14, size * 0.18);
  g.lineTo(x + w * 0.14, y + h * 0.95);
  g.stroke();
  g.beginPath();
  g.moveTo(x + w * 0.25, size * 0.18);
  g.lineTo(x + w * 0.56, size * 0.18);
  g.stroke();
  return c.toDataURL("image/png");
};
`;

const PAGE = "<!doctype html><meta charset=utf-8><body style='margin:0'><script>" + DRAW + "</script></body>";
const br = await launch({ viewport: { width: 600, height: 600 }, name: "icons" });
try {
  await br.goto("data:text/html;charset=utf-8," + encodeURIComponent(PAGE), 15000);
  await br.waitFor("typeof window.drawIcon === 'function'", 10000);
  for (const [size, maskable] of [[192, false], [256, false], [512, false], [512, true]]) {
    const dataUrl = await br.evaluate(`window.drawIcon(${size},${maskable})`);
    const name = maskable ? `icon-maskable-${size}.png` : `icon-${size}.png`;
    const buffer = Buffer.from(String(dataUrl).split(",")[1], "base64");
    fs.writeFileSync(path.join(OUT, name), buffer);
    console.log(`已生成 ${name} ${(buffer.length / 1024).toFixed(1)} KB`);
  }
  const png = fs.readFileSync(path.join(OUT, "icon-256.png"));
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(0, 6); head.writeUInt8(0, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(OUT, "icon.ico"), Buffer.concat([head, png]));
  console.log("已生成 icon.ico");
} finally {
  await br.close();
}
