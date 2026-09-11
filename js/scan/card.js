/*
 * Finding a scorecard in a photograph and cutting it into pieces the
 * classifier can read.
 *
 * The card was designed for this: four solid corner marks to square up a photo
 * taken at an angle, a QR code saying which match the sheet belongs to, and a
 * ruled table of score boxes. Nothing here measures anything against a
 * hard-coded layout beyond the corner marks - the boxes are found from the
 * ruled lines themselves, so the card can be re-laid-out without breaking the
 * reader, and a card photographed at a slant reads the same as a flat scan.
 *
 * Everything OpenCV hands back is a Mat that has to be deleted by hand, so
 * every function here cleans up after itself and the few Mats that escape are
 * returned in an object with a close().
 */

/* The card, in millimetres, as styles.css prints it. Only the width and the
   corner inset are used as absolute figures; the rest is found by looking. */
export const CARD_MM = { width: 190, anchor: 4, anchorInset: 1.5 };

/** Distance from a card edge to the centre of its corner mark. */
const ANCHOR_CENTRE_MM = CARD_MM.anchorInset + CARD_MM.anchor / 2;

/* Pixels per millimetre in the squared-up card. A score box is 11mm tall, so
   at 7 px/mm a written digit lands around 50px high - comfortably more than
   the 28px the classifier wants, with room to spare for a blurred photo. */
export const PPM = 7;

const px = (mm) => Math.round(mm * PPM);

/* ------------------------------------------------------------------ *
 * Small helpers over the OpenCV bindings
 * ------------------------------------------------------------------ */

function grayscale(cv, src) {
  const gray = new cv.Mat();
  if (src.channels() === 1) src.copyTo(gray);
  else cv.cvtColor(src, gray, src.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);
  return gray;
}

/**
 * Ink as white on black.
 *
 * A photograph of paper is never evenly lit - a phone held over a card throws
 * its own shadow across it - so the threshold has to be local. The block is
 * sized from the image rather than fixed, since the same card arrives as a
 * 4000px photo or an 800px preview frame.
 */
function inkMask(cv, gray, blockMm = 6) {
  const out = new cv.Mat();
  let block = Math.round((blockMm * gray.cols) / CARD_MM.width);
  block = Math.max(11, block | 1);
  cv.adaptiveThreshold(gray, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, 9);
  return out;
}

function kernel(cv, w, h) {
  return cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(1, w), Math.max(1, h)));
}

/* ------------------------------------------------------------------ *
 * Step one: the four corner marks
 * ------------------------------------------------------------------ */

/**
 * Solid, roughly square blobs that could be corner marks.
 *
 * The QR code's finder patterns are the trap here: the middle of a finder is
 * also a solid dark square. It is squarer and smaller than a corner mark, but
 * not by enough to separate them on shape alone - what separates them is that
 * the three of them huddle in one corner of the card, so they can never be the
 * four extremes of the sheet.
 */
function anchorCandidates(cv, ink) {
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const found = [];
  try {
    const count = cv.connectedComponentsWithStats(ink, labels, stats, centroids, 8, cv.CV_32S);
    const minSide = ink.cols * 0.004;
    const maxSide = ink.cols * 0.06;
    for (let i = 1; i < count; i += 1) {
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (w < minSide || h < minSide || w > maxSide || h > maxSide) continue;
      const aspect = w / h;
      if (aspect < 0.55 || aspect > 1.8) continue;
      if (area / (w * h) < 0.72) continue; // solid, not a ring or a digit
      found.push({ x: centroids.doubleAt(i, 0), y: centroids.doubleAt(i, 1), area, w, h });
    }
  } finally {
    labels.delete();
    stats.delete();
    centroids.delete();
  }
  return found;
}

/** The four extremes of a set of points, as top-left, top-right, bottom-right, bottom-left. */
function extremeQuad(points) {
  const pick = (score) => points.reduce((best, p) => (score(p) < score(best) ? p : best));
  const tl = pick((p) => p.x + p.y);
  const br = pick((p) => -(p.x + p.y));
  const tr = pick((p) => p.y - p.x);
  const bl = pick((p) => p.x - p.y);
  return [tl, tr, br, bl];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Is this really the card's four corners?
 *
 * A photo of a desk has plenty of small dark squares on it. The corner marks
 * are all the same size, they enclose most of what was photographed, and
 * opposite sides of the rectangle they form are about equal even seen at an
 * angle. Anything that fails those is something else.
 */
function plausibleQuad(quad, ink) {
  if (new Set(quad).size !== 4) return false;

  const areas = quad.map((p) => p.area);
  if (Math.max(...areas) > Math.min(...areas) * 3.2) return false;

  const [tl, tr, br, bl] = quad;
  const top = distance(tl, tr);
  const bottom = distance(bl, br);
  const left = distance(tl, bl);
  const right = distance(tr, br);
  if (!top || !left) return false;
  if (Math.max(top, bottom) > Math.min(top, bottom) * 1.6) return false;
  if (Math.max(left, right) > Math.min(left, right) * 1.6) return false;

  /* A card fills a useful part of the frame; a stray pattern of specks does not. */
  const spread = (Math.max(top, bottom) * Math.max(left, right)) / (ink.cols * ink.rows);
  if (spread < 0.12) return false;

  /* The sheet is wider than it is tall, however it was held. */
  const ratio = ((top + bottom) / 2) / ((left + right) / 2);
  return ratio > 0.7 && ratio < 2.6;
}

/* ------------------------------------------------------------------ *
 * Step two: square the card up
 * ------------------------------------------------------------------ */

/**
 * Warps the card flat.
 *
 * The width is known - the card prints 190mm wide - so the horizontal scale of
 * the result is exact. The height is not: the card is as tall as its content
 * makes it. Rather than assume a figure that a layout change would falsify,
 * the height is taken from the shape in the photograph, which is close enough
 * because the boxes are found by looking rather than by measuring.
 */
function squareUp(cv, src, quad) {
  const [tl, tr, br, bl] = quad;
  const wide = (distance(tl, tr) + distance(bl, br)) / 2;
  const tall = (distance(tl, bl) + distance(tr, br)) / 2;

  const width = px(CARD_MM.width);
  const height = Math.max(px(60), Math.round((width * tall) / wide));
  const inset = px(ANCHOR_CENTRE_MM);

  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    inset, inset,
    width - inset, inset,
    width - inset, height - inset,
    inset, height - inset,
  ]);
  const transform = cv.getPerspectiveTransform(from, to);
  const flat = new cv.Mat();
  cv.warpPerspective(src, flat, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
  from.delete();
  to.delete();
  transform.delete();
  return flat;
}

/* ------------------------------------------------------------------ *
 * Step three: the ruled boxes
 * ------------------------------------------------------------------ */

/**
 * The score boxes, as rectangles in the squared-up card.
 *
 * Opening the ink with a long horizontal bar and a tall vertical one leaves
 * the ruling and throws away the handwriting, so a digit written across a box
 * border cannot split the box in two. What is left is a ladder of cells, and
 * the holes in it are the boxes.
 */
function ruledCells(cv, flat, debug) {
  const gray = grayscale(cv, flat);
  const ink = inkMask(cv, gray, 5);
  gray.delete();

  const horizontal = new cv.Mat();
  const vertical = new cv.Mat();
  const grid = new cv.Mat();
  const hk = kernel(cv, px(16), 1);
  const vk = kernel(cv, 1, px(7));
  cv.morphologyEx(ink, horizontal, cv.MORPH_OPEN, hk);
  cv.morphologyEx(ink, vertical, cv.MORPH_OPEN, vk);
  cv.add(horizontal, vertical, grid);
  /* Close the odd gap where a rule faded under the camera's own shadow. */
  const patch = kernel(cv, 3, 3);
  cv.morphologyEx(grid, grid, cv.MORPH_CLOSE, patch);
  hk.delete();
  vk.delete();
  patch.delete();
  ink.delete();
  horizontal.delete();
  vertical.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const cells = [];
  try {
    cv.findContours(grid, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i += 1) {
      /* An inner contour - a hole in the ruling - is a cell. */
      if (hierarchy.intPtr(0, i)[3] < 0) continue;
      const contour = contours.get(i);
      const rect = cv.boundingRect(contour);
      contour.delete();
      if (rect.width < px(22) || rect.width > px(40)) continue;
      const aspect = rect.width / rect.height;
      if (aspect < 1.7 || aspect > 4.8) continue;
      cells.push(rect);
    }
  } finally {
    contours.delete();
    hierarchy.delete();
    if (debug) debug.grid = toCanvas(cv, grid);
    grid.delete();
  }
  if (debug) debug.cells = cells.map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  return cells;
}

/** Groups values that sit within `tolerance` of each other, as sorted clusters. */
function cluster(values, tolerance) {
  const sorted = [...values].sort((a, b) => a.key - b.key);
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && item.key - last.key <= tolerance) {
      last.items.push(item);
      last.key = (last.key * (last.items.length - 1) + item.key) / last.items.length;
    } else {
      groups.push({ key: item.key, items: [item] });
    }
  }
  return groups;
}

/**
 * Arranges the cells into the card's two columns of score boxes.
 *
 * A row whose rule came out too faint to close leaves a gap, so the rows are
 * rebuilt from the spacing rather than taken as found: the pitch is the median
 * gap between the rows that were seen, and every row from the first to the
 * last is filled in at that pitch whether it was detected or not.
 */
function gridOf(cells, flat) {
  if (cells.length < 4) return null;

  /*
   * Every score box is the same height; the A and B header above them is not,
   * and neither is anything else on the card that happens to be a rectangle.
   * Keeping only the cells close to the median height is what separates the
   * eight rows that hold numbers from the one that holds two letters.
   */
  const heights = cells.map((rect) => rect.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const boxes = cells.filter((rect) => Math.abs(rect.height - median) <= median * 0.15);
  if (boxes.length < 4) return null;

  const columns = cluster(boxes.map((rect) => ({ key: rect.x + rect.width / 2, rect })), px(8));
  const twoWidest = columns.sort((a, b) => b.items.length - a.items.length).slice(0, 2);
  if (twoWidest.length < 2) return null;
  const [left, right] = twoWidest.sort((a, b) => a.key - b.key);
  if (right.key - left.key < px(30)) return null;

  const rows = cluster(
    [...left.items, ...right.items].map((item) => ({ ...item, key: item.rect.y + item.rect.height / 2 })),
    px(4)
  );
  if (rows.length < 3) return null;

  const gaps = rows.slice(1).map((row, i) => row.key - rows[i].key).sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 2)];
  if (!pitch || pitch < px(6)) return null;

  const height = Math.round(
    [...left.items, ...right.items].reduce((sum, item) => sum + item.rect.height, 0) / (left.items.length + right.items.length)
  );
  const width = Math.round(
    [...left.items, ...right.items].reduce((sum, item) => sum + item.rect.width, 0) / (left.items.length + right.items.length)
  );

  const first = rows[0].key;
  const count = Math.round((rows[rows.length - 1].key - first) / pitch) + 1;
  if (count < 3 || count > 14) return null;

  const at = (column, centreY) => {
    const hit = column.items.find((item) => Math.abs(item.rect.y + item.rect.height / 2 - centreY) <= pitch / 2);
    if (hit) return { ...hit.rect, found: true };
    return {
      x: Math.round(column.key - width / 2),
      y: Math.round(centreY - height / 2),
      width,
      height,
      found: false,
    };
  };

  const out = [];
  for (let i = 0; i < count; i += 1) {
    const centreY = first + pitch * i;
    if (centreY + height / 2 > flat.rows || centreY - height / 2 < 0) continue;
    out.push([at(left, centreY), at(right, centreY)]);
  }
  return out.length >= 3 ? out : null;
}

/* ------------------------------------------------------------------ *
 * Step four: the digits inside a box
 * ------------------------------------------------------------------ */

/**
 * Normalises one blob of ink the way MNIST does, because that is what the
 * classifier was trained on: the digit scaled so its longest side is 20px,
 * then placed in a 28x28 field centred on its centre of mass rather than on
 * its bounding box. Getting this wrong costs more accuracy than anything else
 * in the reader.
 */
function normalise(cv, mask, rect) {
  const crop = mask.roi(rect);
  const scale = 20 / Math.max(rect.width, rect.height);
  const w = Math.max(1, Math.round(rect.width * scale));
  const h = Math.max(1, Math.round(rect.height * scale));
  const small = new cv.Mat();
  cv.resize(crop, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
  crop.delete();

  const moments = cv.moments(small, true);
  const cx = moments.m00 ? moments.m10 / moments.m00 : w / 2;
  const cy = moments.m00 ? moments.m01 / moments.m00 : h / 2;

  const out = new Float32Array(28 * 28);
  const offsetX = Math.round(14 - cx);
  const offsetY = Math.round(14 - cy);
  for (let y = 0; y < h; y += 1) {
    const ty = y + offsetY;
    if (ty < 0 || ty >= 28) continue;
    for (let x = 0; x < w; x += 1) {
      const tx = x + offsetX;
      if (tx < 0 || tx >= 28) continue;
      out[ty * 28 + tx] = small.ucharPtr(y, x)[0] / 255;
    }
  }
  small.delete();
  return out;
}

/**
 * Splits a blob that is too wide to be one digit.
 *
 * Two digits written close together in a box touch more often than not, so the
 * pair has to be cut apart - but cutting is dangerous in the other direction
 * too. A nought written with any width at all is wider than it is tall, and
 * halving it produces a convincing 6 and a convincing 2, which is exactly the
 * kind of mistake that gets a wrong score saved without anyone noticing.
 *
 * So a cut needs two things: a blob wide enough that one digit is unlikely,
 * and a genuine gap down the middle of it. The seam is where the fewest
 * strokes cross a column, looked for in the middle third so a single wide
 * digit is not cut through its own waist, and if the thinnest column there is
 * still thick then whatever this is, it is not two digits side by side.
 *
 * Returns the pieces, or the blob unchanged.
 */
function splitWide(cv, mask, rect) {
  const crop = mask.roi(rect);
  const profile = new Int32Array(rect.width);
  for (let x = 0; x < rect.width; x += 1) {
    let sum = 0;
    for (let y = 0; y < rect.height; y += 1) sum += crop.ucharPtr(y, x)[0] ? 1 : 0;
    profile[x] = sum;
  }
  crop.delete();

  const from = Math.round(rect.width * 0.33);
  const to = Math.round(rect.width * 0.67);
  let seam = from;
  for (let x = from; x <= to; x += 1) if (profile[x] < profile[seam]) seam = x;

  const typical = [...profile].sort((a, b) => a - b)[Math.floor(rect.width / 2)] || 1;
  const wide = rect.width / rect.height;
  const gap = profile[seam] / typical;
  /* Very wide blobs are two digits whatever the profile says; the rest need
     the gap to be real. */
  if (wide < 1.95 && gap > 0.4) return [rect];

  const leftWidth = seam;
  const rightWidth = rect.width - seam;
  if (leftWidth < rect.width * 0.3 || rightWidth < rect.width * 0.3) return [rect];
  return [
    new cv.Rect(rect.x, rect.y, leftWidth, rect.height),
    new cv.Rect(rect.x + seam, rect.y, rightWidth, rect.height),
  ];
}

/**
 * Cuts one score box into the digits written in it.
 *
 * Returns an empty list for an empty box, which is a real answer: a card for a
 * best of five that went three sets has four boxes left blank, and reading
 * them as zeroes would invent two sets that were never played.
 *
 * When one blob had to be cut in two, the uncut blob comes back as well. The
 * reader is then holding both readings of the same ink - 62 and 0, say - and
 * the rules of the game get to choose, which they are far better placed to do
 * than a threshold on a shape.
 */
function digitsIn(cv, flat, rect) {
  /* Step inside the ruling: a border caught in the crop becomes a stroke. */
  const inset = Math.max(2, Math.round(rect.height * 0.12));
  const box = new cv.Rect(
    Math.max(0, rect.x + inset),
    Math.max(0, rect.y + inset),
    Math.max(1, Math.min(rect.width - inset * 2, flat.cols - rect.x - inset)),
    Math.max(1, Math.min(rect.height - inset * 2, flat.rows - rect.y - inset))
  );
  if (box.width < 8 || box.height < 8) return { digits: [], whole: null };

  const roi = flat.roi(box);
  const gray = grayscale(cv, roi);
  roi.delete();

  const mask = new cv.Mat();
  cv.adaptiveThreshold(gray, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, Math.max(11, (Math.round(box.height * 0.9) | 1)), 12);
  gray.delete();
  /* Join a stroke broken by a dry pen or a hard compression. */
  const glue = kernel(cv, 2, 2);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, glue);
  glue.delete();

  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  let rects = [];
  try {
    const count = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S);
    for (let i = 1; i < count; i += 1) {
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (h < box.height * 0.3) continue;         // a speck, or the ruling's shadow
      if (h > box.height * 0.99 && w > box.width * 0.9) continue; // the whole box inverted
      if (area < box.height * 0.8) continue;
      if (w > box.width * 0.9) continue;
      rects.push(new cv.Rect(stats.intAt(i, cv.CC_STAT_LEFT), stats.intAt(i, cv.CC_STAT_TOP), w, h));
    }
  } finally {
    labels.delete();
    stats.delete();
    centroids.delete();
  }

  rects.sort((a, b) => a.x - b.x);
  const before = rects.length;
  const single = rects.length === 1 ? rects[0] : null;
  rects = rects.flatMap((r) => (r.width > r.height * 1.3 ? splitWide(cv, mask, r) : [r]));
  rects.sort((a, b) => a.x - b.x);
  /* A score is at most two digits; anything more is noise on the outside. */
  if (rects.length > 2) {
    rects = rects.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 2).sort((a, b) => a.x - b.x);
  }

  const whole = before === 1 && rects.length === 2 ? normalise(cv, mask, single) : null;
  const out = { digits: rects.map((r) => normalise(cv, mask, r)), whole };
  mask.delete();
  return out;
}

/* ------------------------------------------------------------------ *
 * Putting it together
 * ------------------------------------------------------------------ */

/**
 * Reads one photograph.
 *
 * @param cv        the loaded OpenCV namespace
 * @param source    a canvas, image or ImageData holding the photo
 * @returns {{ ok: boolean, reason?: string, code?: number[], rows?: Array, flat?: HTMLCanvasElement }}
 */
export function readCard(cv, source, { debug = false } = {}) {
  const stages = debug ? {} : null;
  const src = source instanceof cv.Mat ? source : cv.imread(source);
  const scratch = [src];
  const done = () => scratch.forEach((mat) => mat && !mat.isDeleted() && mat.delete());

  try {
    const gray = grayscale(cv, src);
    scratch.push(gray);
    const ink = inkMask(cv, gray, 7);
    scratch.push(ink);

    const candidates = anchorCandidates(cv, ink);
    if (candidates.length < 4) return { ok: false, reason: "anchors", stages };
    const quad = extremeQuad(candidates);
    if (!plausibleQuad(quad, ink)) return { ok: false, reason: "anchors", stages };

    const flat = squareUp(cv, src, quad);
    scratch.push(flat);

    const detector = new cv.QRCodeDetector();
    let text = "";
    try {
      text = detector.detectAndDecode(flat);
    } finally {
      if (detector.delete) detector.delete();
    }
    /* The payload is three raw bytes, not text, and comes back one character
       per byte. Anything else is a code from somewhere other than our card. */
    const code = text.length === 3 ? [...text].map((ch) => ch.charCodeAt(0) & 0xff) : null;

    const cells = ruledCells(cv, flat, stages);
    const grid = gridOf(cells, flat);
    if (stages) stages.flat = toCanvas(cv, flat);
    if (!grid) return { ok: false, reason: "boxes", code, flat: toCanvas(cv, flat), stages };

    const rows = grid.map(([a, b]) => ({
      a: digitsIn(cv, flat, a),
      b: digitsIn(cv, flat, b),
    }));

    if (stages) stages.grid = stages.grid || null;
    return { ok: true, code, rows, flat: toCanvas(cv, flat), stages };
  } finally {
    done();
  }
}

function toCanvas(cv, mat) {
  const canvas = document.createElement("canvas");
  canvas.width = mat.cols;
  canvas.height = mat.rows;
  cv.imshow(canvas, mat);
  return canvas;
}
