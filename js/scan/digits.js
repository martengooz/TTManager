/*
 * The forward pass of the digit classifier, in plain JavaScript.
 *
 * The weights come from tools/train-digits.py and live in digit-model.js. The
 * network is two convolutions, a max pool after each, and one fully connected
 * layer - small enough that running it on a couple of dozen digits is
 * instant, and small enough to read, which matters more here than speed.
 *
 * The layout of every weight tensor mirrors the training script exactly: a
 * convolution's weights are (channels_in * k * k) rows by channels_out
 * columns, indexed channel-major then row then column, and the dense layer
 * takes its input flattened channel-major. Get that ordering wrong and the
 * network still runs, just badly - so it is spelled out rather than inferred.
 */
import { c1w, c1b, c2w, c2b, fcw, fcb } from "./digit-model.js";

const CONV1 = { cin: 1, cout: 12, k: 5, in: 28, out: 24 };
const POOL1 = 12;
const CONV2 = { cin: 12, cout: 24, k: 5, in: 12, out: 8 };
const POOL2 = 4;

/** Valid convolution followed by ReLU, straight out of the training script. */
function convolve(input, spec, weights, biases) {
  const { cin, cout, k, in: size, out } = spec;
  const result = new Float32Array(cout * out * out);
  for (let f = 0; f < cout; f += 1) {
    const bias = biases[f];
    for (let y = 0; y < out; y += 1) {
      for (let x = 0; x < out; x += 1) {
        let sum = bias;
        for (let c = 0; c < cin; c += 1) {
          const plane = c * size * size;
          const column = (c * k) * k;
          for (let ky = 0; ky < k; ky += 1) {
            const row = plane + (y + ky) * size + x;
            const wrow = (column + ky * k) * cout + f;
            for (let kx = 0; kx < k; kx += 1) {
              sum += input[row + kx] * weights[wrow + kx * cout];
            }
          }
        }
        result[f * out * out + y * out + x] = sum > 0 ? sum : 0;
      }
    }
  }
  return result;
}

/** Two by two max pool, which halves an even side. */
function pool(input, channels, size) {
  const out = size / 2;
  const result = new Float32Array(channels * out * out);
  for (let c = 0; c < channels; c += 1) {
    for (let y = 0; y < out; y += 1) {
      for (let x = 0; x < out; x += 1) {
        const base = c * size * size + y * 2 * size + x * 2;
        const best = Math.max(input[base], input[base + 1], input[base + size], input[base + size + 1]);
        result[c * out * out + y * out + x] = best;
      }
    }
  }
  return result;
}

function softmax(scores) {
  let top = -Infinity;
  for (const value of scores) if (value > top) top = value;
  let total = 0;
  const out = new Float32Array(scores.length);
  for (let i = 0; i < scores.length; i += 1) {
    out[i] = Math.exp(scores[i] - top);
    total += out[i];
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

/**
 * Classifies one 28x28 bitmap, as `card.js` normalises them.
 *
 * @param {Float32Array} bitmap 784 values, 0 for paper and 1 for ink
 * @returns {Float32Array} ten probabilities
 */
export function classify(bitmap) {
  const a = convolve(bitmap, CONV1, c1w, c1b);
  const b = pool(a, CONV1.cout, CONV1.out);
  const c = convolve(b, { ...CONV2, in: POOL1 }, c2w, c2b);
  const d = pool(c, CONV2.cout, CONV2.out);

  const scores = new Float32Array(10);
  for (let i = 0; i < 10; i += 1) {
    let sum = fcb[i];
    for (let j = 0; j < d.length; j += 1) sum += d[j] * fcw[j * 10 + i];
    scores[i] = sum;
  }
  return softmax(scores);
}

/**
 * Turns the digits of one score box into a distribution over the numbers it
 * could be.
 *
 * A box holds nothing, one digit or two, and nothing is a real answer - an
 * unplayed set. Two digits multiply out into a number, and the probability
 * comes with them, which is what lets the rules later pick between two
 * readings that both look plausible.
 *
 * When the box had one blob of ink that had to be cut in two, both readings
 * are offered: the pair, and the uncut blob as a single digit. A nought cut
 * down the middle reads as a convincing 62, and no amount of looking at the
 * shape will settle it - but only one of the two makes a legal set, so the
 * rules settle it instead.
 *
 * @param {{ digits: Float32Array[], whole: Float32Array|null }} box
 * @returns {{ empty: boolean, options: Array<{ value: number, p: number }> }}
 */
export function readBox(box) {
  const bitmaps = box.digits;
  if (!bitmaps.length) return { empty: true, options: [] };

  const perDigit = bitmaps.slice(0, 2).map(classify);
  const options = [];

  if (perDigit.length === 1) {
    perDigit[0].forEach((p, value) => options.push({ value, p }));
  } else {
    const [tens, units] = perDigit;
    tens.forEach((pt, t) => {
      /* A leading zero is not how anyone writes a score. */
      if (t === 0) return;
      units.forEach((pu, u) => options.push({ value: t * 10 + u, p: pt * pu }));
    });
    if (box.whole) {
      /* The same ink read as one digit rather than two. */
      classify(box.whole).forEach((p, value) => options.push({ value, p: p * UNCUT_WEIGHT }));
    }
  }

  /* Two readings can land on the same number; keep the better one. */
  const best = new Map();
  for (const option of options) {
    const seen = best.get(option.value);
    if (!seen || option.p > seen.p) best.set(option.value, option);
  }

  const ranked = [...best.values()].sort((a, b) => b.p - a.p);
  return { empty: false, options: ranked.slice(0, 12) };
}

/* How much weight the uncut reading keeps against the cut one. A cut that got
   this far had a real gap down the middle, so the pair is the better guess -
   but not by so much that the rules cannot overturn it. */
const UNCUT_WEIGHT = 0.3;
