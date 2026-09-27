#!/usr/bin/env node
/**
 * 生成 PWA 与扩展所需的 PNG 图标（零依赖，只用 Node 内置的 zlib 手写 PNG 编码）。
 *
 * 为什么要自己画：
 *   PWA 可安装性（Chrome）要求至少一个 192px+ 的图标，Android 还需要 maskable 版本，
 *   iOS 需要 apple-touch-icon 的 PNG。仓库里只有 SVG，而引入 sharp/canvas 这类
 *   原生依赖只为生成几张图并不划算。
 *
 * 图形：蓝色圆角方块 + 白色八角星 + 中心圆点（与 public/favicon.svg 同一套造型）。
 * 用 3×3 超采样做抗锯齿。
 *
 * 用法：node scripts/gen-icons.mjs
 * 产物已提交到仓库，仅在需要改图标时重新运行。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────── PNG 编码（最小实现） ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ───────────────────────── 图形光栅化 ─────────────────────────

const BG = [59, 130, 246];
const FG = [255, 255, 255];

/** 圆角矩形内部判定 */
function insideRoundedRect(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  if (cx === x && cy === y) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** 生成八角星的多边形顶点（尖角朝上） */
function starPolygon(size, outerRatio, innerRatio) {
  const center = size / 2;
  const points = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 8;
    const radius = (i % 2 === 0 ? outerRatio : innerRatio) * size;
    points.push([center + radius * Math.cos(angle), center + radius * Math.sin(angle)]);
  }
  return points;
}

/** 射线法：点是否在多边形内 */
function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  // maskable 版本必须「出血」铺满，且图形收在中心 80% 安全区内
  const cornerRadius = maskable ? 0 : size * 0.22;
  const star = starPolygon(size, maskable ? 0.32 : 0.42, maskable ? 0.12 : 0.16);
  const dotRadius = size * (maskable ? 0.05 : 0.062);
  const center = size / 2;

  const SS = 3; // 每像素 3×3 超采样
  const step = 1 / SS;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let fgHits = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;

          const inBg = maskable || insideRoundedRect(x, y, size, cornerRadius);
          if (!inBg) continue;
          bgHits += 1;

          const onStar = insidePolygon(x, y, star);
          const onDot = (x - center) ** 2 + (y - center) ** 2 <= dotRadius ** 2;
          if (onStar || onDot) fgHits += 1;
        }
      }

      const total = SS * SS;
      const offset = (py * size + px) * 4;
      if (bgHits === 0) continue; // 透明

      const bgAlpha = bgHits / total;
      const fgRatio = fgHits / bgHits;
      const color = BG.map((channel, index) => Math.round(channel * (1 - fgRatio) + FG[index] * fgRatio));

      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, rgba);
}

// ───────────────────────── 输出 ─────────────────────────

const TARGETS = [
  { path: 'packages/web/public/icons/192.png', size: 192, maskable: false },
  { path: 'packages/web/public/icons/512.png', size: 512, maskable: false },
  { path: 'packages/web/public/icons/512-maskable.png', size: 512, maskable: true },
  { path: 'packages/web/public/icons/apple-touch-icon.png', size: 180, maskable: true },
  { path: 'packages/extension/public/icons/16.png', size: 16, maskable: false },
  { path: 'packages/extension/public/icons/48.png', size: 48, maskable: false },
  { path: 'packages/extension/public/icons/128.png', size: 128, maskable: false },
];

for (const target of TARGETS) {
  const absolute = join(ROOT, target.path);
  mkdirSync(dirname(absolute), { recursive: true });
  const png = renderIcon(target.size, { maskable: target.maskable });
  writeFileSync(absolute, png);
  console.log(`✓ ${target.path}  ${target.size}×${target.size}  ${(png.length / 1024).toFixed(1)} KB`);
}
