/*
 * QR Code encoder — error correction level Q, byte mode, versions 1 to 10.
 *
 * Enough to put a match identity on a printed scorecard and read it back from
 * a photograph. Level Q recovers about a quarter of a damaged symbol, and the
 * three finder patterns survive skew and blur far better than the single clock
 * track of a Data Matrix.
 *
 * encode(bytes) returns a square array of 0/1 rows, function patterns and mask
 * included, ready to draw.
 */

/* Level Q: [ec codewords per block, [[blocks, data codewords per block], ...]] */
const BLOCKS = {
  1: [13, [[1, 13]]],
  2: [22, [[1, 22]]],
  3: [18, [[2, 17]]],
  4: [26, [[2, 24]]],
  5: [18, [[2, 15], [2, 16]]],
  6: [24, [[4, 19]]],
  7: [18, [[2, 14], [4, 15]]],
  8: [22, [[4, 18], [2, 19]]],
  9: [20, [[4, 16], [4, 17]]],
  10: [24, [[6, 19], [2, 20]]],
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/* Bits left over after the codewords, per version. */
const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

const LEVEL_Q = 0b11;

/* ------------------------------------------------------------------ *
 * GF(256), primitive polynomial 0x11D as QR specifies
 * ------------------------------------------------------------------ */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial with roots a^0 .. a^(n-1). */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function remainder(data, count) {
  const poly = generator(count);
  const out = new Array(count).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    if (factor !== 0) for (let i = 0; i < count; i += 1) out[i] ^= mul(poly[i + 1], factor);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */
function pickVersion(byteCount) {
  for (let version = 1; version <= 10; version += 1) {
    const [, groups] = BLOCKS[version];
    const dataCodewords = groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteCount * 8 <= dataCodewords * 8) return version;
  }
  throw new Error("Payload too large for a version 10 QR");
}

function codewords(bytes, version) {
  const [, groups] = BLOCKS[version];
  const capacity = groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  for (let i = 0; i < 4 && bits.length < capacity * 8; i += 1) bits.push(0); // terminator
  while (bits.length % 8) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const padding = [0xec, 0x11];
  while (out.length < capacity) out.push(padding[(out.length - bits.length / 8) % 2]);
  return out;
}

/** Splits into blocks, adds error correction, and interleaves both. */
function interleave(data, version) {
  const [ecCount, groups] = BLOCKS[version];
  const blocks = [];
  let at = 0;
  groups.forEach(([count, size]) => {
    for (let i = 0; i < count; i += 1) {
      const block = data.slice(at, at + size);
      at += size;
      blocks.push({ data: block, ec: remainder(block, ecCount) });
    }
  });

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
  for (let i = 0; i < ecCount; i += 1) blocks.forEach((b) => out.push(b.ec[i]));
  return out;
}

/* ------------------------------------------------------------------ *
 * Matrix
 * ------------------------------------------------------------------ */
function functionPatterns(version) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) matrix[r][c] = v;
  };

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inRing = (r === 0 || r === 6) && c >= 0 && c <= 6;
        const inSide = (c === 0 || c === 6) && r >= 0 && r <= 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(row + r, col + c, inRing || inSide || inCore ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    const on = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = on;
    matrix[i][6] = on;
  }

  const centres = ALIGNMENT[version];
  centres.forEach((row) => {
    centres.forEach((col) => {
      if (matrix[row][col] !== null) return; // overlaps a finder
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.max(Math.abs(r), Math.abs(c));
          set(row + r, col + c, edge === 1 ? 0 : 1);
        }
      }
    });
  });

  matrix[size - 8][8] = 1; // the always-dark module

  // Reserve the format and version areas.
  for (let i = 0; i < 9; i += 1) {
    if (matrix[8][i] === null) matrix[8][i] = 0;
    if (matrix[i][8] === null) matrix[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = 0;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = 0;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        matrix[size - 11 + j][i] = 0;
        matrix[i][size - 11 + j] = 0;
      }
    }
  }
  return matrix;
}

function placeData(matrix, stream, version) {
  const size = matrix.length;
  const bits = [];
  stream.forEach((byte) => {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  });
  for (let i = 0; i < REMAINDER[version]; i += 1) bits.push(0);

  const taken = matrix.map((row) => row.map((v) => v !== null));
  let at = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right <= 6 ? right - 1 : right; // step over the timing column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (!taken[row][c]) {
          matrix[row][c] = at < bits.length ? bits[at] : 0;
          at += 1;
        }
      }
    }
    upward = !upward;
  }
  return taken;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;

  const runs = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) run += 1;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  };
  runs((r, c) => matrix[r][c]);
  runs((c, r) => matrix[r][c]);

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }

  const finderish = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversed = finderish.slice().reverse();
  const matches = (line, at, pattern) => pattern.every((v, i) => line[at + i] === v);
  for (let a = 0; a < size; a += 1) {
    const row = matrix[a];
    const col = matrix.map((r) => r[a]);
    for (let b = 0; b + 11 <= size; b += 1) {
      if (matches(row, b, finderish) || matches(row, b, reversed)) score += 40;
      if (matches(col, b, finderish) || matches(col, b, reversed)) score += 40;
    }
  }

  const dark = matrix.flat().filter((v) => v === 1).length;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

function formatBits(mask) {
  let value = (LEVEL_Q << 3) | mask;
  let rest = value << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0b10100110111 << (i - 10);
  }
  return ((value << 10) | rest) ^ 0b101010000010010;
}

function versionBits(version) {
  let rest = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0b1111100100 << (i - 12);
  }
  return (version << 12) | rest;
}

function writeFormat(matrix, mask) {
  const size = matrix.length;
  const value = formatBits(mask);
  const bits = [];
  for (let i = 14; i >= 0; i -= 1) bits.push((value >> i) & 1); // most significant first

  // Around the top-left finder, then the pair running off the other two.
  const copy1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const copy2 = [];
  for (let r = size - 1; r >= size - 7; r -= 1) copy2.push([r, 8]);
  for (let c = size - 8; c <= size - 1; c += 1) copy2.push([8, c]);

  copy1.forEach(([r, c], i) => { matrix[r][c] = bits[i]; });
  copy2.forEach(([r, c], i) => { matrix[r][c] = bits[i]; });
  matrix[size - 8][8] = 1; // always dark
}

function writeVersion(matrix, version) {
  if (version < 7) return;
  const size = matrix.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const on = (bits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    matrix[row][col] = on;
    matrix[col][row] = on;
  }
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

/** Encodes bytes (or a string's code units) and returns rows of 0/1. */
export function encode(input) {
  const bytes = typeof input === "string" ? Array.from(input, (ch) => ch.charCodeAt(0) & 0xff) : Array.from(input);
  const version = pickVersion(bytes.length);
  const stream = interleave(codewords(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = functionPatterns(version);
    const taken = placeData(matrix, stream, version);
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix.length; c += 1) {
        if (!taken[r][c] && MASKS[mask](r, c)) matrix[r][c] ^= 1;
      }
    }
    writeFormat(matrix, mask);
    writeVersion(matrix, version);
    const score = penalty(matrix);
    if (!best || score < best.score) best = { score, matrix };
  }
  return best.matrix;
}

/** The symbol as inline SVG, sized in whatever unit is given. */
export function svg(input, { size = "24mm", quiet = 4, label = "" } = {}) {
  const matrix = encode(input);
  const n = matrix.length + quiet * 2;
  const squares = [];
  matrix.forEach((row, r) => {
    row.forEach((on, c) => {
      if (on) squares.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#111">${squares.join("")}</g></svg>`;
}
