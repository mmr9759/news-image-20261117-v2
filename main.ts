// THE WORLD TODAY — Tuesday 17 November 2026.
// A one-page newspaper front page drawn from scratch in pure Node stdlib.
// No network, no fonts, no images: every pixel is computed here, so the
// program is deterministic and both runs write identical bytes.
// Entry for make.fun news-image-20261117, written from a blank page.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// PNG encoding (truecolour, 8 bit, no interlace, filter 0 per scanline)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Framebuffer + drawing primitives
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const PAPER: RGB = [248, 244, 232];
const INK: RGB = [20, 18, 16];
const RED: RGB = [163, 31, 31];
const BLUE: RGB = [47, 74, 107];
const OCEAN: RGB = [214, 228, 236];
const LAND: RGB = [206, 190, 148];
const LAND_EDGE: RGB = [120, 104, 70];
const GREY: RGB = [110, 104, 92];
const LIGHT_RULE: RGB = [180, 172, 152];

const px = new Uint8Array(W * H * 3);

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      i += 3;
    }
  }
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  fillRect(x, y, w, t, c);
}

function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  fillRect(x, y, t, h, c);
}

function rectOutline(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  hline(x, y, w, c, t);
  hline(x, y + h - t, w, c, t);
  vline(x, y, h, c, t);
  vline(x + w - t, y, h, c, t);
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(x, y, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    setPixel(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}

// Even-odd scanline fill for simple polygons.
function fillPoly(pts: Array<[number, number]>, c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(Math.round(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = xs[k]; x <= xs[k + 1]; x++) setPixel(x, y, c);
    }
  }
}

function polyOutline(pts: Array<[number, number]>, c: RGB): void {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    line(x0, y0, x1, y1, c);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows; each row is a 5-bit value,
// bit 4 = leftmost pixel. Text is rendered upper-case only.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 6, 4, 0, 4],
  "%": [25, 26, 2, 4, 8, 19, 25],
  "+": [0, 4, 4, 31, 4, 4, 0],
  $: [4, 15, 20, 14, 5, 30, 4],
  "x": [0, 17, 10, 4, 10, 17, 0], // multiplication cross, used for scores
  "*": [0, 4, 21, 14, 21, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
};

// Normalise a character to a glyph key. Lower-case folds to upper-case;
// curly quotes and dashes fold to their ASCII twins; anything unknown
// becomes a blank.
function glyphFor(ch: string): number[] | null {
  if (ch === " ") return null;
  const up = ch.toUpperCase();
  if (GLYPHS[up]) return GLYPHS[up];
  if (ch === "\u2019" || ch === "\u2018" || ch === "\u02bc") return GLYPHS["'"];
  if (ch === "\u2013" || ch === "\u2014") return GLYPHS["-"];
  if (ch === "\u00d7") return GLYPHS["x"];
  if (ch === "\u2022") return [0, 0, 12, 12, 0, 0, 0];
  return null;
}

function textWidth(text: string, scale: number): number {
  // 6 units per character cell (5 glyph + 1 gap), minus the trailing gap.
  return Math.max(0, text.length * 6 * scale - scale);
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    if (ch !== " ") {
      const g = glyphFor(ch);
      if (g) {
        for (let row = 0; row < 7; row++) {
          const bits = g[row];
          for (let col = 0; col < 5; col++) {
            if (bits & (1 << (4 - col))) {
              fillRect(cx + col * scale, y + row * scale, scale, scale, c);
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentred(text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

function drawTextRight(text: string, right: number, y: number, scale: number, c: RGB): void {
  drawText(text, right - textWidth(text, scale), y, scale, c);
}

// Greedy word wrap. Returns lines that fit maxWidth px at the given scale.
function wrapText(text: string, maxWidth: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxWidth || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawPara(text: string, x: number, y: number, maxWidth: number, scale: number, c: RGB, lineGap = 3): number {
  const lines = wrapText(text, maxWidth, scale);
  let yy = y;
  for (const ln of lines) {
    drawText(ln, x, yy, scale, c);
    yy += 7 * scale + lineGap;
  }
  return yy;
}

// ---------------------------------------------------------------------------
// Small pictograms for the lead stories (plain vector shapes)
// ---------------------------------------------------------------------------

function drawBridgeIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const deckY = y + Math.floor(h * 0.62);
  hline(x, deckY, w, c, 3);
  const t1 = x + Math.floor(w * 0.22);
  const t2 = x + Math.floor(w * 0.72);
  vline(t1, y + 4, deckY - y - 2, c, 3);
  vline(t2, y + 4, deckY - y - 2, c, 3);
  line(t1, y + 6, x + Math.floor(w * 0.5), deckY - 2, c);
  line(t2, y + 6, x + Math.floor(w * 0.5), deckY - 2, c);
  line(x + 2, deckY - 2, t1, y + 8, c);
  line(x + w - 2, deckY - 2, t2, y + 8, c);
  // water under the deck
  for (let i = 0; i < 4; i++) {
    const wx = x + 6 + i * Math.floor((w - 12) / 4);
    line(wx, deckY + 8, wx + 10, deckY + 8, c);
  }
}

function drawDroneIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  const a = Math.floor(w * 0.32);
  const b = Math.floor(h * 0.3);
  line(cx - a, cy - b, cx + a, cy + b, c);
  line(cx + a, cy - b, cx - a, cy + b, c);
  disc(cx, cy, 5, c);
  disc(cx - a, cy - b, 6, c);
  disc(cx + a, cy - b, 6, c);
  disc(cx - a, cy + b, 6, c);
  disc(cx + a, cy + b, 6, c);
  hline(cx - a - 8, cy - b, 16, c, 2);
  hline(cx + a - 8, cy - b, 16, c, 2);
  hline(cx - a - 8, cy + b, 16, c, 2);
  hline(cx + a - 8, cy + b, 16, c, 2);
}

function drawTankerIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const hullY = y + Math.floor(h * 0.55);
  fillPoly(
    [
      [x + 4, hullY],
      [x + w - 4, hullY],
      [x + w - 12, hullY + 14],
      [x + 12, hullY + 14],
    ],
    c,
  );
  fillRect(x + Math.floor(w * 0.2), hullY - 12, Math.floor(w * 0.55), 12, c);
  vline(x + w - 14, hullY - 22, 22, c, 3);
  for (let i = 0; i < 3; i++) {
    const wx = x + 8 + i * Math.floor((w - 16) / 3);
    line(wx, hullY + 22, wx + 10, hullY + 22, c);
  }
}

function drawChipIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const s = Math.min(w, h) - 16;
  const ox = x + Math.floor((w - s) / 2);
  const oy = y + Math.floor((h - s) / 2);
  rectOutline(ox, oy, s, s, c, 3);
  const inner = Math.floor(s * 0.45);
  fillRect(ox + Math.floor((s - inner) / 2), oy + Math.floor((s - inner) / 2), inner, inner, c);
  for (let i = 0; i < 3; i++) {
    const off = Math.floor(s * (0.25 + i * 0.25));
    hline(ox - 8, oy + off, 8, c, 2);
    hline(ox + s, oy + off, 8, c, 2);
    vline(ox + off, oy - 8, 8, c, 2);
    vline(ox + off, oy + s, 8, c, 2);
  }
}

function drawBallIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  const r = Math.floor(Math.min(w, h) / 2) - 2;
  ring(cx, cy, r, c);
  ring(cx, cy, Math.floor(r * 0.45), c);
  line(cx, cy - r, cx, cy - Math.floor(r * 0.45), c);
  line(cx, cy + Math.floor(r * 0.45), cx, cy + r, c);
  line(cx - r, cy, cx - Math.floor(r * 0.45), cy, c);
  line(cx + Math.floor(r * 0.45), cy, cx + r, cy, c);
}

function drawFlagsIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const cols: RGB[] = [RED, INK, BLUE];
  for (let i = 0; i < 3; i++) {
    const fx = x + 4 + i * Math.floor((w - 8) / 3);
    vline(fx, y + 4, h - 8, c, 2);
    fillRect(fx + 2, y + 4, Math.floor((w - 8) / 3) - 6, 12, cols[i]);
  }
}

// ---------------------------------------------------------------------------
// Schematic world map. Rough continent shapes on a pale ocean, red pins
// marking the day's flashpoints. Coordinates are inside the map rectangle.
// ---------------------------------------------------------------------------

function drawMap(mx: number, my: number, mw: number, mh: number): void {
  fillRect(mx, my, mw, mh, OCEAN);
  rectOutline(mx, my, mw, mh, INK, 2);
  // graticule
  for (let gx = mx + 120; gx < mx + mw; gx += 120) vline(gx, my + 2, mh - 4, LIGHT_RULE, 1);
  for (let gy = my + 25; gy < my + mh; gy += 25) hline(mx + 2, gy, mw - 4, LIGHT_RULE, 1);

  const P = (pts: Array<[number, number]>): Array<[number, number]> =>
    pts.map(([px0, py0]) => [mx + Math.round((px0 / 968) * mw), my + Math.round((py0 / 100) * mh)] as [number, number]);

  const continents: Array<Array<[number, number]>> = [
    // North America
    [
      [40, 8], [150, 4], [210, 12], [230, 30], [200, 45], [170, 42],
      [150, 58], [120, 52], [90, 58], [55, 45], [30, 25],
    ],
    // Greenland
    [[225, 2], [250, 2], [255, 12], [230, 14]],
    // South America
    [[210, 55], [250, 52], [275, 62], [265, 85], [240, 98], [220, 80], [205, 65]],
    // Europe
    [[455, 8], [500, 4], [520, 12], [510, 28], [480, 32], [455, 22]],
    // Africa
    [[455, 35], [500, 32], [525, 42], [520, 70], [495, 92], [470, 80], [452, 55]],
    // Asia
    [
      [525, 5], [650, 2], [800, 6], [880, 15], [900, 30], [860, 45],
      [800, 55], [720, 60], [650, 50], [580, 40], [540, 25],
    ],
    // Australia
    [[820, 72], [880, 70], [895, 82], [860, 92], [825, 85]],
  ];
  for (const cont of continents) {
    const poly = P(cont);
    fillPoly(poly, LAND);
    polyOutline(poly, LAND_EDGE);
  }
  // island dots: SE Asia, Japan, UK, Madagascar
  for (const [ix, iy] of [
    [830, 62], [852, 64], [700, 78], [445, 14], [540, 88], [905, 26],
  ] as Array<[number, number]>) {
    disc(mx + Math.round((ix / 968) * mw), my + Math.round((iy / 100) * mh), 3, LAND_EDGE);
  }

  // Pins: [label, map-x, map-y]
  const pins: Array<[string, number, number]> = [
    ["1", 515, 15],
    ["2", 600, 45],
    ["3", 840, 35],
    ["4", 868, 58],
    ["5", 898, 18],
    ["6", 585, 62],
  ];
  for (const [label, px0, py0] of pins) {
    const cx = mx + Math.round((px0 / 968) * mw);
    const cy = my + Math.round((py0 / 100) * mh);
    disc(cx, cy, 8, RED);
    ring(cx, cy, 8, PAPER);
    drawText(label, cx - 3, cy - 3, 1, PAPER);
  }
}

// ---------------------------------------------------------------------------
// Content: 40 stories, checked against the day's reporting.
// 2 leads + 6 sections x 5 items + 8 briefs = 40.
// Headlines fit one line at scale 2 in a 314 px column (26 chars);
// decks fit one line at scale 1 (52 chars). The layout code warns on
// stderr if any item wraps beyond that, so a bad line is caught locally.
// ---------------------------------------------------------------------------

interface Lead {
  kicker: string;
  head: string[];
  deck: string;
}

interface Item {
  head: string;
  deck: string;
}

interface Section {
  name: string;
  icon: string;
  items: Item[];
}

const LEADS: Lead[] = [
  {
    kicker: "WAR IN UKRAINE",
    head: ["KERCH BRIDGE", "HIT AGAIN"],
    deck: "Ukraine strikes the Crimea crossing for a second day; a road span falls into the strait. Russia hits bridges in Kyiv, cutting water and power.",
  },
  {
    kicker: "THE GULF",
    head: ["IRAN FIRES DRONES", "AT US RADAR", "IN BAHRAIN"],
    deck: "Third Iranian strike on US targets in the kingdom in days. US jets hit a missile site on Qeshm Island; a tanker burns in Hormuz.",
  },
];

const SECTIONS: Section[] = [
  {
    name: "EUROPE",
    icon: "flags",
    items: [
      { head: "BIGGEST DRONE WAVE YET", deck: "Kyiv launches its largest drone attack of the war" },
      { head: "ESTONIA CLOSES BORDER", deck: "Every crossing with Russia shuts from 1 December" },
      { head: "EU HOLDS SHADOW-FLEET SHIP", deck: "The MV Midag is detained in the Mediterranean" },
      { head: "BRIDGE OP TOOK WEEKS", deck: "Zelenskyy calls the Kerch strike unprecedented" },
      { head: "EU PLANS RWANDA HUB", deck: "Five states plan a deportation centre for 2027" },
    ],
  },
  {
    name: "MIDDLE EAST",
    icon: "tanker",
    items: [
      { head: "THIRD US CARRIER SAILS IN", deck: "USS Theodore Roosevelt reaches the Middle East" },
      { head: "HOUTHIS HIT SAUDI PIPELINE", deck: "Drones target the line bypassing the Strait" },
      { head: "QATAR REVIVES IRAN TALKS", deck: "Doha opens new mediation and warns of stalemate" },
      { head: "IRAN BARS IAEA INSPECTORS", deck: "Tehran blocks nuclear checks until the war ends" },
      { head: "HOUTHIS TAKE BAB EL-MANDEB", deck: "Fighters seize the strait as forces pull to Aden" },
    ],
  },
  {
    name: "ASIA-PACIFIC",
    icon: "drone",
    items: [
      { head: "TRUMP HEADS TO SHENZHEN", deck: "Three-way Xi-Putin meeting set for Thursday" },
      { head: "XI MEETS CARNEY, SHEINBAUM", deck: "China's leader talks tariffs with Canada, Mexico" },
      { head: "JAPAN SCRAMBLES F-15S", deck: "Tokyo protests Russian planes near its airspace" },
      { head: "SAMSUNG JOINS NVIDIA", deck: "Seoul tie-up expands cooperation on AI chips" },
      { head: "NEPAL FIRST FOR LOSS FUND", deck: "UN sets aside flood money for Kathmandu first" },
    ],
  },
  {
    name: "AMERICAS",
    icon: "chip",
    items: [
      { head: "TRUMP IN MANILA FOR ASEAN", deck: "President opens Asia trip at the ASEAN summit" },
      { head: "US BANKS HIT BY GLITCHES", deck: "Service disruptions hit deposits and payments" },
      { head: "COSTA RICA REPORTER SLAIN", deck: "Journalist shot after probing drug corruption" },
      { head: "POPE LEO XIV IN PERU", deck: "Pontiff seeks justice for Amazon defenders" },
      { head: "PARAGUAY EX-LEADER JAILED", deck: "Ousted president moved to a military prison" },
    ],
  },
  {
    name: "AFRICA",
    icon: "ball",
    items: [
      { head: "EBOLA PASSES 11,000 CASES", deck: "DR Congo outbreak: 5,500 dead, Africa CDC says" },
      { head: "17 DEAD IN SA SHOOTINGS", deck: "Two mass shootings in KwaZulu-Natal, Gauteng" },
      { head: "GUINEA MINING CRACKDOWN", deck: "1,263 arrested in the Siguiri gold crackdown" },
      { head: "MOROCCO BOOKS AFCON 2027", deck: "Atlas Lions qualify for the Africa Cup of Nations" },
      { head: "SOUTH SUDAN BISHOPS SPEAK", deck: "Church demands a lawful democratic transition" },
    ],
  },
  {
    name: "MARKETS, TECH & SPORT",
    icon: "bars",
    items: [
      { head: "NVIDIA REVENUE TOPS $115BN", deck: "Board will not bring back ousted CEO Huang" },
      { head: "S&P 500 FALLS 1.03%", deck: "Stocks slide as tech and Iran fears weigh" },
      { head: "BRENT HOLDS NEAR $93", deck: "Hormuz attacks offset fears of a supply glut" },
      { head: "AMAZON SATELLITES LOST", deck: "Rocket failure destroys the payload in flight" },
      { head: "ZVEREV REACHES LAST EIGHT", deck: "German into the ATP Finals knockout stage" },
    ],
  },
];

const BRIEFS: string[] = [
  "Wales stun New Zealand 35-28, a first win over the All Blacks in 73 years.",
  "India beat Pakistan 2-1 to win the SAFF Championship in Dhaka.",
  "Northern Ireland promoted to the Nations League top tier.",
  "Dhoni retires from playing for Chennai Super Kings.",
  "Peter Storey, Arsenal Double winner, dies at 81.",
  "COP31 climate talks strain over the draft deal.",
  "US widens chip-export scrutiny to SE Asia and Brazil.",
  "Anthropic IPO pricing due later in the week.",
];

const TOTAL_STORIES =
  LEADS.length +
  SECTIONS.reduce((n, s) => n + s.items.length, 0) +
  BRIEFS.length;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function drawBarsIcon(x: number, y: number, w: number, h: number, c: RGB): void {
  const bw = Math.floor(w / 4);
  const heights = [0.4, 0.65, 0.5, 0.9];
  for (let i = 0; i < 4; i++) {
    const bh = Math.floor(h * heights[i]);
    fillRect(x + i * bw + 2, y + h - bh, bw - 4, bh, c);
  }
}

function drawSectionIcon(kind: string, x: number, y: number, s: number, c: RGB): void {
  if (kind === "flags") drawFlagsIcon(x, y, s, s, c);
  else if (kind === "tanker") drawTankerIcon(x, y, s, s, c);
  else if (kind === "drone") drawDroneIcon(x, y, s, s, c);
  else if (kind === "chip") drawChipIcon(x, y, s, s, c);
  else if (kind === "ball") drawBallIcon(x, y, s, s, c);
  else if (kind === "bars") drawBarsIcon(x, y, s, s, c);
}

function main(): void {
  if (TOTAL_STORIES !== 40) {
    console.error(`STORY COUNT IS ${TOTAL_STORIES}, EXPECTED 40`);
    process.exit(1);
  }
  fillRect(0, 0, W, H, PAPER);
  rectOutline(8, 8, W - 16, H - 16, INK, 2);

  // Masthead
  drawTextCentred("THE WORLD TODAY", 512, 20, 7, INK);
  hline(28, 76, 968, INK, 2);
  hline(28, 80, 968, INK, 1);
  drawText("TUESDAY, 17 NOVEMBER 2026", 28, 88, 2, INK);
  drawTextRight(`${TOTAL_STORIES} STORIES - SIX CONTINENTS - ONE FRONT PAGE`, 996, 88, 2, RED);
  hline(28, 110, 968, INK, 3);

  // Lead stories
  const leadTop = 122;
  drawText(LEADS[0].kicker, 28, leadTop, 2, RED);
  drawText(LEADS[0].head[0], 28, leadTop + 22, 4, INK);
  drawText(LEADS[0].head[1], 28, leadTop + 54, 4, INK);
  drawBridgeIcon(520, leadTop + 22, 100, 60, BLUE);
  const lead0End = drawPara(LEADS[0].deck, 28, leadTop + 92, 600, 2, INK);
  vline(648, leadTop, 186, LIGHT_RULE, 1);
  drawText(LEADS[1].kicker, 668, leadTop, 2, RED);
  drawText(LEADS[1].head[0], 668, leadTop + 22, 3, INK);
  drawText(LEADS[1].head[1], 668, leadTop + 47, 3, INK);
  drawText(LEADS[1].head[2], 668, leadTop + 72, 3, INK);
  const lead1End = drawPara(LEADS[1].deck, 668, leadTop + 101, 328, 2, INK);
  if (lead0End > 312 || lead1End > 312) {
    console.error(`LEAD OVERFLOW: left ends ${lead0End}, right ends ${lead1End}`);
  }
  hline(28, 314, 968, INK, 2);

  // Map strip
  drawText("THE DAY ON THE MAP", 28, 326, 2, INK);
  drawTextRight("SIX FLASHPOINTS, FROM THE BLACK SEA TO THE PACIFIC", 996, 328, 1, GREY);
  drawMap(28, 348, 968, 100);
  drawTextCentred("1 KERCH BRIDGE   2 BAHRAIN   3 SHENZHEN   4 MANILA   5 TOKYO   6 ADEN", 512, 454, 1, INK);
  hline(28, 472, 968, INK, 2);

  // Section grid: 3 columns x 2 rows
  const colX = [28, 355, 682];
  const colW = 314;
  const rowY = [486, 696];
  const rowH = 200;
  SECTIONS.forEach((sec, si) => {
    const cx = colX[si % 3];
    const cy = rowY[Math.floor(si / 3)];
    drawText(sec.name, cx, cy, 2, RED);
    drawSectionIcon(sec.icon, cx + colW - 26, cy - 4, 26, BLUE);
    hline(cx, cy + 20, colW, INK, 1);
    let iy = cy + 30;
    sec.items.forEach((it, ii) => {
      const headLines = wrapText(it.head, colW, 2);
      const deckLines = wrapText(it.deck, colW, 1);
      if (headLines.length > 1 || deckLines.length > 1) {
        console.error(`OVERFLOW ${sec.name} item ${ii}: head ${headLines.length} lines, deck ${deckLines.length} lines`);
      }
      drawText(it.head, cx, iy, 2, INK);
      iy += 17;
      drawText(it.deck, cx, iy, 1, INK);
      iy += 7 + 9;
    });
    if (iy > cy + rowH) {
      console.error(`SECTION OVERFLOW ${sec.name}: ends ${iy}, row ends ${cy + rowH}`);
    }
  });

  // Also today: 8 briefs, 4 columns x 2 rows
  hline(28, 916, 968, INK, 2);
  drawText("ALSO TODAY", 28, 926, 2, RED);
  const briefX = [28, 272, 516, 760];
  const briefW = 232;
  BRIEFS.forEach((b, i) => {
    const bx = briefX[i % 4];
    const by = 950 + Math.floor(i / 4) * 24;
    const lines = wrapText(b, briefW, 1);
    if (lines.length > 2) console.error(`BRIEF OVERFLOW ${i}: ${lines.length} lines`);
    let yy = by;
    for (const ln of lines) {
      drawText(ln, bx, yy, 1, INK);
      yy += 10;
    }
  });

  // Footer
  hline(28, 998, 968, INK, 1);
  drawTextCentred(
    `THE WORLD TODAY  -  TUESDAY 17 NOVEMBER 2026  -  ${TOTAL_STORIES} STORIES FROM SIX CONTINENTS`,
    512,
    1004,
    1,
    GREY,
  );

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const png = encodePng(px, W, H);
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log(`wrote ${path.join(outDir, "entry.png")} (${png.length} bytes, ${TOTAL_STORIES} stories)`);
}

main();
