// Draws the app icons (PNG) with no extra packages. Run: node scripts/make-icons.mjs
// Output goes to web/public/. The picture is the same little robot face as the browser tab icon.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/** `maskable` fills the whole square (Android crops it to a circle or rounded shape); otherwise the corners are rounded and see-through. */
function png(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const u = size / 32; // everything is drawn on a 32 x 32 grid
  const inRoundRect = (x, y, rx, ry, w, h, r) => {
    if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
    const cx = Math.min(Math.max(x, rx + r), rx + w - r);
    const cy = Math.min(Math.max(y, ry + r), ry + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const scale = maskable ? 0.7 : 1; // keep the face inside the safe area for maskable icons
  const SS = 3; // 3 x 3 samples per pixel for smooth edges
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / u;
          const y = (py + (sy + 0.5) / SS) / u;
          const fx = (x - 16) / scale + 16;
          const fy = (y - 16) / scale + 16;
          const bg = maskable || inRoundRect(x, y, 0, 0, 32, 32, 7);
          if (!bg) continue;
          let col = [79, 70, 229]; // indigo
          if (inCircle(fx, fy, 11, 14, 3) || inCircle(fx, fy, 21, 14, 3) || inRoundRect(fx, fy, 9, 20, 14, 3, 1.5)) col = [255, 255, 255];
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      const n = SS * SS;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const cover = a / 255;
      raw[o] = cover ? Math.round(r / cover) : 0;
      raw[o + 1] = cover ? Math.round(g / cover) : 0;
      raw[o + 2] = cover ? Math.round(b / cover) : 0;
      raw[o + 3] = Math.round(a / n);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("web/public", { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  writeFileSync(`web/public/${name}`, png(size, maskable));
  console.log("wrote", name);
}
