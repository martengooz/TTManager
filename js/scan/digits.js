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
import { c1w, c1b, c2w, c2b, fcw, fcb, CONFUSION } from "./digit-model.js";

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

/*
 * How much of a digit's reading to take from the measured confusion matrix
 * rather than from the network's own output.
 *
 * A softmax is badly calibrated at the tail: shown a 6 it will happily say
 * 0.9997 for 6 and 1e-9 for 8, which is a claim about a written digit that no
 * classifier is entitled to make. That matters here because the interesting
 * question is never "what does this look like" - it is "the rules say this
 * cannot be a 6, so what else could a 6-looking mark have been". Answering it
 * from the tail of a softmax is answering it from noise. So a share of every
 * distribution is replaced by what the network is actually observed to do with
 * that digit, which is what makes 6 read as 8 outrank 6 read as 4.
 */
const MEASURED_SHARE = 0.12;

/** P(the digit written was t | the network read s), from the confusion matrix. */
const POSTERIOR = CONFUSION[0].map((_, said) => {
  const column = CONFUSION.map((row) => row[said]);
  const total = column.reduce((sum, value) => sum + value, 0);
  return column.map((value) => value / total);
});

function temper(probs) {
  let said = 0;
  for (let i = 1; i < 10; i += 1) if (probs[i] > probs[said]) said = i;
  const measured = POSTERIOR[said];
  const out = new Float32Array(10);
  for (let i = 0; i < 10; i += 1) out[i] = (1 - MEASURED_SHARE) * probs[i] + MEASURED_SHARE * measured[i];
  return out;
}

/* What a reading costs when the segmentation itself was wrong: a blob that was
   really two digits, or two marks that were really one. Both happen, and both
   have to stay on the table for the rules to overrule. */
const UNCUT = 0.3;
const SPURIOUS = 0.05;
const MISSED = 0.02;

/**
 * Reads one score box into distributions rather than an answer.
 *
 * Nothing here decides anything. A box holds nothing, one digit or two, and
 * what comes back is what each position might have been - which is what lets
 * the rules of the game, which know far more than this module does, do the
 * deciding.
 *
 * @param {{ digits: Float32Array[], whole: Float32Array|null }} box
 */
export function readBox(box) {
  if (!box.digits.length) return { empty: true, positions: [], whole: null, options: [] };

  const positions = box.digits.slice(0, 2).map((bitmap) => temper(classify(bitmap)));
  const whole = box.whole ? temper(classify(box.whole)) : null;
  const reading = { empty: false, positions, whole, options: [] };

  /* A ranked list of what the box appears to say, for showing the organiser
     what was on the card when the rules end up overruling it. */
  const options = [];
  if (positions.length === 1) {
    positions[0].forEach((p, value) => options.push({ value, p }));
  } else {
    positions[0].forEach((pt, tens) => {
      if (tens === 0) return; // nobody writes a leading zero
      positions[1].forEach((pu, units) => options.push({ value: tens * 10 + units, p: pt * pu }));
    });
    if (whole) whole.forEach((p, value) => options.push({ value, p: p * UNCUT }));
  }
  const best = new Map();
  for (const option of options) {
    const seen = best.get(option.value);
    if (!seen || option.p > seen.p) best.set(option.value, option);
  }
  reading.options = [...best.values()].sort((a, b) => b.p - a.p).slice(0, 8);
  return reading;
}

/**
 * How likely it is that this box holds this number.
 *
 * The number is proposed from outside - by the rules, which know which scores
 * a set can legally end on - and this says what the ink is worth as a reading
 * of it. That includes readings where the segmentation was wrong: 11 written
 * so the strokes touch comes back as one blob, and a nought with a wide loop
 * comes back as two, so neither a shorter nor a longer number is ruled out,
 * only made to pay for itself.
 */
export function scoreValue(box, value) {
  if (box.empty || value < 0 || value > 99) return 0;
  const text = String(value);
  const wanted = [...text].map(Number);
  const found = box.positions.length;

  if (wanted.length === found) {
    let p = 1;
    for (let i = 0; i < wanted.length; i += 1) p *= box.positions[i][wanted[i]];
    return p;
  }

  if (wanted.length === 1 && found === 2) {
    /* One digit, read as two: either the uncut blob says so, or one of the two
       pieces is the whole digit and the other was never ink. */
    const uncut = box.whole ? box.whole[wanted[0]] * UNCUT : 0;
    const piece = Math.max(box.positions[0][wanted[0]], box.positions[1][wanted[0]]) * SPURIOUS;
    return Math.max(uncut, piece);
  }

  if (wanted.length === 2 && found === 1) {
    /* Two digits, read as one: the other never made it out of the ruling. */
    return Math.max(box.positions[0][wanted[0]], box.positions[0][wanted[1]]) * MISSED;
  }

  return 0;
}
