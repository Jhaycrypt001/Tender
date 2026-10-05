/**
 * A QR encoder, written out rather than installed.
 *
 * Why this exists: a QR code is not decoration on this page. The research
 * behind Tender names "missing QR codes" as one of the four causes of crypto
 * checkout abandonment — a buyer paying from a phone wallet will not retype a
 * 42-character address, they will give up. So the checkout cannot ship without
 * one.
 *
 * Why not a package: this runs on the buyer's phone, on a page whose whole job
 * is to load fast on a bad connection, and a QR encoder is a fixed, forty-year-
 * old specification that will never need updating. ~200 lines with no supply
 * chain beats a dependency here.
 *
 * Scope: byte mode, error-correction level M, versions 1–10 (up to 213 bytes).
 * That covers every blockchain address and payment URI by a wide margin. Longer
 * input throws rather than silently producing an unscannable code.
 *
 * Reference: ISO/IEC 18004. The tables below are from the spec and are not
 * derivable — they are transcribed constants, like a CRC polynomial.
 */

/** Total data codewords available at error-correction level M, versions 1-10. */
const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];

/** EC codewords per block, level M, versions 1-10. */
const EC_CODEWORDS_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

/** Number of EC blocks, level M, versions 1-10. */
const EC_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** Alignment-pattern centre coordinates by version. */
const ALIGNMENT: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// --- GF(256) arithmetic, for Reed-Solomon ------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // The QR standard's primitive polynomial, x^8 + x^4 + x^3 + x^2 + 1.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial of the given degree. */
function generator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon error-correction codewords for one block. */
function ecCodewords(data: Uint8Array, count: number): Uint8Array {
  const gen = generator(count);
  const out = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[count - 1] = 0;
    for (let i = 0; i < count; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

// --- Bit buffer --------------------------------------------------------------

class Bits {
  private bytes: number[] = [];
  private length = 0;

  push(value: number, width: number) {
    for (let i = width - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      if (this.length % 8 === 0) this.bytes.push(0);
      if (bit) this.bytes[this.bytes.length - 1] |= 0x80 >>> this.length % 8;
      this.length++;
    }
  }

  get bitLength() {
    return this.length;
  }

  toBytes(): number[] {
    return this.bytes;
  }
}

// --- Encoding ----------------------------------------------------------------

/** Smallest version 1-10 that fits `byteCount` in byte mode at level M. */
function pickVersion(byteCount: number): number {
  for (let v = 1; v <= 10; v++) {
    // 4 bits mode + 8 or 16 bits length + the data itself.
    const lengthBits = v < 10 ? 8 : 16;
    const needed = 4 + lengthBits + byteCount * 8;
    if (needed <= DATA_CODEWORDS_M[v] * 8) return v;
  }
  throw new Error(
    `QR: ${byteCount} bytes exceeds version 10 at error-correction level M`,
  );
}

function buildCodewords(data: Uint8Array, version: number): Uint8Array {
  const total = DATA_CODEWORDS_M[version];
  const bits = new Bits();

  bits.push(0b0100, 4); // byte mode
  bits.push(data.length, version < 10 ? 8 : 16);
  for (const b of data) bits.push(b, 8);

  // Terminator, up to four zero bits, then pad to a byte boundary.
  const remaining = total * 8 - bits.bitLength;
  bits.push(0, Math.min(4, remaining));
  while (bits.bitLength % 8 !== 0) bits.push(0, 1);

  const out = bits.toBytes();
  // Pad bytes alternate 0xEC / 0x11, per the spec.
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < total; i++) out.push(PAD[i % 2]);

  // Split into blocks, generate EC, then interleave.
  const blockCount = EC_BLOCKS_M[version];
  const ecPerBlock = EC_CODEWORDS_M[version];
  const shortLength = Math.floor(total / blockCount);
  const longCount = total % blockCount;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const length = shortLength + (i >= blockCount - longCount ? 1 : 0);
    const block = Uint8Array.from(out.slice(offset, offset + length));
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, ecPerBlock));
  }

  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }

  return Uint8Array.from(result);
}

// --- Matrix ------------------------------------------------------------------

type Matrix = {
  size: number;
  /** 1 = dark, 0 = light. */
  cells: Uint8Array;
  /** 1 where the module is a function pattern and must not be masked. */
  reserved: Uint8Array;
};

function makeMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  return {
    size,
    cells: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

function set(m: Matrix, x: number, y: number, dark: number, reserve = true) {
  m.cells[y * m.size + x] = dark;
  if (reserve) m.reserved[y * m.size + x] = 1;
}

function placeFinder(m: Matrix, cx: number, cy: number) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const inRing =
        (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
        (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
      const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      set(m, x, y, inRing || inCore ? 1 : 0);
    }
  }
}

function placeFunctionPatterns(m: Matrix, version: number) {
  placeFinder(m, 0, 0);
  placeFinder(m, m.size - 7, 0);
  placeFinder(m, 0, m.size - 7);

  // Timing patterns.
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    set(m, i, 6, dark);
    set(m, 6, i, dark);
  }

  // Alignment patterns, skipping those that collide with finders.
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx <= 8 && cy <= 8) ||
        (cx >= m.size - 9 && cy <= 8) ||
        (cx <= 8 && cy >= m.size - 9);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          set(m, cx + dx, cy + dy, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  // Reserve the format-information areas; values are written later.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(m, i, 8, 0);
      set(m, 8, i, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(m, m.size - 1 - i, 8, 0);
    set(m, 8, m.size - 1 - i, 0);
  }

  // Version information, versions 7 and up: 6 bits of version plus 12 bits of
  // BCH(18,6) check, written twice (beside the top-right and bottom-left
  // finders). Without it a scanner cannot tell which version it is reading and
  // rejects the whole code. Versions 1-6 carry none.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = (bits >>> i) & 1;
      const a = m.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(m, a, b, dark);
      set(m, b, a, dark);
    }
  }

  // The permanently dark module. Written AFTER the reservation loops above,
  // because the second of them passes over this exact position and would
  // otherwise clear it — the reservation is what protects it from masking.
  set(m, 8, m.size - 8, 1);
}

/** Walks the zigzag data path, writing codeword bits into free modules. */
function placeData(m: Matrix, codewords: Uint8Array) {
  let bitIndex = 0;
  let upward = true;

  for (let right = m.size - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern and is skipped entirely.
    if (right === 6) right = 5;

    for (let step = 0; step < m.size; step++) {
      const y = upward ? m.size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (m.reserved[y * m.size + x]) continue;
        const byte = codewords[bitIndex >>> 3];
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
        m.cells[y * m.size + x] = bit;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number) {
  const fn = MASKS[mask];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.reserved[y * m.size + x]) continue;
      if (fn(x, y)) m.cells[y * m.size + x] ^= 1;
    }
  }
}

/** Format information: EC level M (0b00) plus mask, BCH(15,5) protected. */
function placeFormat(m: Matrix, mask: number) {
  const data = (0b00 << 3) | mask;
  let bch = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  const bits = ((data << 10) | bch) ^ 0b101010000010010;

  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    // Copy one: around the top-left finder.
    if (i < 6) set(m, 8, i, bit);
    else if (i < 8) set(m, 8, i + 1, bit);
    else if (i === 8) set(m, 7, 8, bit);
    else set(m, 14 - i, 8, bit);

    // Copy two: split between the other two finders. The i === 8 case would
    // land on (8, size-8), which is the permanently dark module — the spec
    // places the dark module there instead, so that one position is skipped.
    if (i < 8) set(m, m.size - 1 - i, 8, bit);
    else if (i > 8) set(m, 8, m.size - 15 + i, bit);
  }
}

/** Penalty score used to choose the mask that scans most reliably. */
function penalty(m: Matrix): number {
  const at = (x: number, y: number) => m.cells[y * m.size + x];
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules.
  for (let y = 0; y < m.size; y++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let i = 1; i < m.size; i++) {
        const prev = horizontal ? at(i - 1, y) : at(y, i - 1);
        const cur = horizontal ? at(i, y) : at(y, i);
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < m.size - 1; y++) {
    for (let x = 0; x < m.size - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern appearing in the data.
  const PATTERN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      for (const horizontal of [true, false]) {
        if (horizontal && x + 11 > m.size) continue;
        if (!horizontal && y + 11 > m.size) continue;
        let match = true;
        for (let i = 0; i < 11; i++) {
          const v = horizontal ? at(x + i, y) : at(x, y + i);
          if (v !== PATTERN[i]) {
            match = false;
            break;
          }
        }
        if (match) score += 40;
      }
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let dark = 0;
  for (const c of m.cells) dark += c;
  const ratio = (dark * 100) / (m.size * m.size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * Encodes `text` and returns the module grid as rows of booleans.
 *
 * Deterministic: the same input always produces the same grid, so this can run
 * on the server and be sent as markup rather than drawn in the browser.
 */
export function encodeQR(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);
  const version = pickVersion(data.length);
  const codewords = buildCodewords(data, version);

  let best: Matrix | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const m = makeMatrix(version);
    placeFunctionPatterns(m, version);
    placeData(m, codewords);
    applyMask(m, mask);
    placeFormat(m, mask);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }

  const m = best!;
  const rows: boolean[][] = [];
  for (let y = 0; y < m.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < m.size; x++) row.push(m.cells[y * m.size + x] === 1);
    rows.push(row);
  }
  return rows;
}

/**
 * The grid as a single SVG path string.
 *
 * One path for the whole code rather than one rect per module: a version-10
 * code is 3,249 modules, and 3,249 DOM nodes on a phone is a visible cost for
 * something that is one shape.
 */
export function qrPath(rows: boolean[][]): string {
  const parts: string[] = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}
