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
 * This runs in a worker, so there is no DOM here: a frame arrives as raw RGBA
 * bytes and leaves as numbers. Everything OpenCV hands back is a Mat that has
 * to be deleted by hand, so every function here cleans up after itself, and
 * the handful of Mats that live from one frame to the next are held in
 * `scratch` and reused rather than reallocated thirty times a minute.
 */

/* The card, in millimetres, as styles.css prints it. Only the width and the
   corner inset are used as absolute figures; the rest is found by looking. */
export const CARD_MM = {
  width: 190,
  anchor: 8,
  anchorInset: 1.5,
  /* Nominal only: the card is as tall as its content makes it, and this is
     what that comes to today. Nothing measures against it - it is used to
     prefer one candidate rectangle over another, never to reject one. */
  height: 169,
};

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

/*
 * The Mats that survive between frames.
 *
 * A viewfinder hands this module a frame every second or so, all the same
 * size. Allocating and freeing the full-frame buffers each time is the one
 * cost here that is pure waste - the work itself has to happen, but the
 * allocation does not - so the three big ones are kept and refilled. The
 * detector is kept for the same reason: constructing it reads tables.
 */
const scratch = { src: null, gray: null, ink: null, detector: null };

/** Frees everything held between frames. Called when the reader shuts down. */
export function release() {
  for (const key of ["src", "gray", "ink"]) {
    if (scratch[key]) scratch[key].delete();
    scratch[key] = null;
  }
  if (scratch.detector && scratch.detector.delete) scratch.detector.delete();
  scratch.detector = null;
}

/** A Mat over the frame's pixels, reusing the last one when it still fits. */
function frameMat(cv, frame) {
  const { width, height, data } = frame;
  if (!scratch.src || scratch.src.cols !== width || scratch.src.rows !== height) {
    if (scratch.src) scratch.src.delete();
    scratch.src = new cv.Mat(height, width, cv.CV_8UC4);
  }
  scratch.src.data.set(data);
  return scratch.src;
}

function grayscale(cv, src, reuse) {
  const gray = reuse || new cv.Mat();
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
function inkMask(cv, gray, blockMm = 6, reuse, offset = 9) {
  const out = reuse || new cv.Mat();
  let block = Math.round((blockMm * gray.cols) / CARD_MM.width);
  block = Math.max(11, block | 1);
  cv.adaptiveThreshold(gray, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, offset);
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
 * This is deliberately generous. A photograph of a card lying on a sofa has
 * dozens of small dark squares in it - weave, crumbs, print on whatever else
 * is on the table - and trying to be clever here only loses the real ones.
 * Sorting the wheat from the chaff is the next function's job, and it has far
 * more to go on: four corner marks are the same size as each other and sit at
 * the corners of a rectangle, which no amount of sofa ever manages.
 */
function candidatesIn(cv, ink, found) {
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  try {
    const count = cv.connectedComponentsWithStats(ink, labels, stats, centroids, 8, cv.CV_32S);
    const minSide = Math.max(3, ink.cols * 0.003);
    const maxSide = ink.cols * 0.06;
    for (let i = 1; i < count; i += 1) {
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (w < minSide || h < minSide || w > maxSide || h > maxSide) continue;
      const aspect = w / h;
      if (aspect < 0.5 || aspect > 2) continue;
      const solidity = area / (w * h);
      if (solidity < 0.7) continue; // solid, not a ring or a digit
      found.push({ x: centroids.doubleAt(i, 0), y: centroids.doubleAt(i, 1), area, w, h, solidity });
    }
  } finally {
    labels.delete();
    stats.delete();
    centroids.delete();
  }
  return found;
}

/**
 * Corner mark candidates.
 *
 * Pooling several exposures was tried here and made things worse, not better:
 * the extra marks a second threshold finds are almost all noise, and they
 * crowd the real corners out of the shortlist the search works from. One
 * threshold, and let the rectangle search do the discriminating.
 */
function anchorCandidates(cv, gray) {
  /*
   * The window has to be comfortably bigger than the thing being looked for.
   * A local threshold asks whether a pixel is darker than its surroundings,
   * and in the middle of an 8mm square the surroundings are the square, so a
   * window that size finds a hollow ring instead of a solid mark and the
   * solidity test then throws it away. This one is three times the mark.
   */
  const ink = inkMask(cv, gray, ANCHOR_WINDOW_MM);
  const found = [];
  candidatesIn(cv, ink, found);
  ink.delete();

  /* Squarest and most solid first, so the cap keeps the likeliest. */
  const quality = (p) => p.solidity - Math.max(p.w / p.h, p.h / p.w);
  found.sort((a, b) => quality(b) - quality(a));
  return found.slice(0, MAX_CANDIDATES);
}

const MAX_CANDIDATES = 140;

/* The local-threshold window used to find corner marks, in card millimetres. */
const ANCHOR_WINDOW_MM = 24;

/* How many candidate rectangles to square up and look inside before giving up. */
const ATTEMPTS = 8;

/* A corner mark's side as a fraction of the distance between the marks: 4mm
   against 190mm less the 3.5mm inset at each end. */
const ANCHOR_SPAN = CARD_MM.anchor / (CARD_MM.width - 2 * ANCHOR_CENTRE_MM);

/* What shape the four marks make on a card lying flat. */
const CARD_ASPECT = (CARD_MM.height - 2 * ANCHOR_CENTRE_MM) / (CARD_MM.width - 2 * ANCHOR_CENTRE_MM);

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Average brightness inside a quadrilateral, sampled on a grid.
 *
 * The card is a sheet of white paper. Four dark specks that happen to sit at
 * the corners of something usually have a sofa in the middle of them, and this
 * is what notices.
 */
function interiorBrightness(gray, quad) {
  const [tl, tr, br, bl] = quad;
  let total = 0;
  let n = 0;
  for (let i = 1; i < 6; i += 1) {
    for (let j = 1; j < 6; j += 1) {
      const s = i / 6;
      const t = j / 6;
      const x = Math.round((1 - t) * ((1 - s) * tl.x + s * tr.x) + t * ((1 - s) * bl.x + s * br.x));
      const y = Math.round((1 - t) * ((1 - s) * tl.y + s * tr.y) + t * ((1 - s) * bl.y + s * br.y));
      if (x < 0 || y < 0 || x >= gray.cols || y >= gray.rows) continue;
      total += gray.ucharPtr(y, x)[0];
      n += 1;
    }
  }
  return n ? total / n : 0;
}

/** Mean brightness of the whole frame, for comparison. */
function frameBrightness(gray) {
  let total = 0;
  let n = 0;
  const stepY = Math.max(1, Math.floor(gray.rows / 40));
  const stepX = Math.max(1, Math.floor(gray.cols / 40));
  for (let y = 0; y < gray.rows; y += stepY) {
    for (let x = 0; x < gray.cols; x += stepX) {
      total += gray.ucharPtr(y, x)[0];
      n += 1;
    }
  }
  return n ? total / n : 0;
}

/**
 * The four extreme candidates, as top-left, top-right, bottom-right, bottom-left.
 *
 * This is the whole of the old card finder, and on a card held up to fill the
 * frame it is still the right answer and costs nothing to work out - so it
 * goes to the front of the queue of guesses rather than being thrown away.
 * What it cannot do is find a card lying on a patterned surface, where the
 * extremes of the frame are four specks of sofa.
 */
function extremeQuad(points) {
  const pick = (score) => points.reduce((best, p) => (score(p) < score(best) ? p : best));
  const quad = [
    pick((p) => p.x + p.y),
    pick((p) => p.y - p.x),
    pick((p) => -(p.x + p.y)),
    pick((p) => p.x - p.y),
  ];
  return new Set(quad).size === 4 ? quad : null;
}

/**
 * Finds the four corner marks.
 *
 * The old version of this took the four extreme blobs in the frame, which
 * works only when the card fills it. Photograph a printed sheet lying on
 * something at arm's length and the extremes are a speck of sofa in each
 * corner of the photograph, every time.
 *
 * So instead of assuming where the marks are, this looks for the shape they
 * make. Two candidates of similar size are proposed as the top edge; a third,
 * below and roughly square to them, as the left edge; and the fourth corner is
 * then not a guess but an arithmetic prediction - a rectangle seen in
 * perspective is still a parallelogram to a good approximation, so the missing
 * corner is where the other three say it is. If a candidate of the right size
 * is sitting there, that is four marks in the shape of a card, and the odds of
 * sofa managing that are very small.
 *
 * Candidates are bucketed by size first, because the four marks are printed
 * the same size and nothing else in the frame has to be.
 */
function findAnchorQuads(cv, candidates, gray, wanted) {
  if (candidates.length < 4) return [];

  const longest = Math.max(gray.cols, gray.rows);
  /*
   * How small the card is allowed to be in the frame.
   *
   * The mark-to-span ratio below is scale free - four specks a centimetre
   * apart satisfy it as happily as the real card - so something has to say
   * how big a card is. This is not an arbitrary threshold: a card much
   * smaller than this in frame has its 11mm score boxes down to a few dozen
   * pixels, and nothing legible comes out of it anyway.
   */
  const minEdge = longest * 0.22;
  const grid = new Map();
  const cell = Math.max(8, longest / 60);
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const point of candidates) {
    const k = key(point.x, point.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(point);
  }
  /** The candidate nearest to (x, y), within `within`. */
  const nearest = (x, y, within) => {
    let best = null;
    let bestDistance = within;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const reach = Math.ceil(within / cell);
    for (let i = -reach; i <= reach; i += 1) {
      for (let j = -reach; j <= reach; j += 1) {
        for (const point of grid.get(`${cx + i},${cy + j}`) || []) {
          const d = Math.hypot(point.x - x, point.y - y);
          if (d < bestDistance) {
            bestDistance = d;
            best = point;
          }
        }
      }
    }
    return best && { point: best, distance: bestDistance };
  };

  const paper = frameBrightness(gray);
  const found = [];

  const similar = (a, b) => {
    const ratio = a.area > b.area ? a.area / b.area : b.area / a.area;
    return ratio <= 2.5;
  };

  /* Only candidates of a similar size can be corners of the same card, and
     working that out once rather than inside three nested loops is the
     difference between this taking a second and taking no time at all. */
  const peers = candidates.map((point) => candidates.filter((other) => other !== point && similar(point, other)));
  const indexOf = new Map(candidates.map((point, i) => [point, i]));

  for (let i = 0; i < candidates.length; i += 1) {
    const tl = candidates[i];
    const near = peers[i];
    for (let j = 0; j < near.length; j += 1) {
      const tr = near[j];
      const ux = tr.x - tl.x;
      const uy = tr.y - tl.y;
      const width = Math.hypot(ux, uy);
      if (width < minEdge) continue;

      for (let k = 0; k < near.length; k += 1) {
        const bl = near[k];
        if (bl === tr) continue;
        const vx = bl.x - tl.x;
        const vy = bl.y - tl.y;
        const height = Math.hypot(vx, vy);
        /* The card is 190mm by about 170mm, so its sides are within a whisker
           of each other; perspective and a phone held at an angle widen that a
           long way, but not without limit. */
        if (height < width * 0.45 || height > width * 1.7) continue;
        /* The two edges have to actually make a corner. */
        const cross = ux * vy - uy * vx;
        if (cross <= 0) continue; // keeps the winding consistent
        const cos = (ux * vx + uy * vy) / (width * height);
        if (Math.abs(cos) > 0.6) continue; // roughly square, within 55 degrees

        const hit = nearest(tr.x + vx, tr.y + vy, width * 0.16);
        if (!hit || hit.point === tl || hit.point === tr || hit.point === bl) continue;
        if (!similar(tl, hit.point)) continue;

        const quad = [tl, tr, hit.point, bl];

        /*
         * The strongest clue on the whole card, and the one that took longest
         * to notice: a corner mark is 4mm square and the marks are 183mm
         * apart, so whatever the distance, the angle or the lens, a mark is
         * about a fiftieth of the span between them. Four specks of sofa
         * spread across a photograph are far too small for the rectangle they
         * make; four marks on a business card too big. This single ratio does
         * more to find the card than every other test here put together.
         */
        const side = quad.reduce((sum, p) => sum + Math.sqrt(p.area), 0) / 4;
        const ratio = side / ((width + height) / 2);
        /* Wide enough to take the 4mm marks of cards printed before they were
           enlarged, as well as today's 8mm ones. */
        if (ratio < ANCHOR_SPAN * 0.4 || ratio > ANCHOR_SPAN * 2.2) continue;

        const areas = quad.map((p) => p.area);
        const spread = Math.max(...areas) / Math.min(...areas);
        const inside = interiorBrightness(gray, quad);
        /* Marks the right size for the rectangle they make, all four the same
           size, a fourth corner where it was predicted, and white paper in the
           middle rather than sofa. */
        const score =
          1.5 / (1 + Math.abs(Math.log(ratio / ANCHOR_SPAN))) +
          0.6 / spread +
          0.5 * (1 - hit.distance / (width * 0.16)) +
          (inside > paper ? 0.8 : 0) +
          inside / 255 +
          /* Among several readings of the same photograph the big one is the
             card and the small one is a detail of it. */
          Math.min(1.2, ((width * height) / (gray.cols * gray.rows)) * 2) +
          /* A card seen at an angle is squashed, but it is still more nearly
             the shape of a card than of anything else in the frame. */
          1.2 / (1 + Math.abs(Math.log(height / width / CARD_ASPECT)) * 2);
        found.push({ quad, score, cx: (tl.x + tr.x + hit.point.x + bl.x) / 4, cy: (tl.y + tr.y + hit.point.y + bl.y) / 4, size: width });
      }
    }
  }

  /* The same card is found many times over with one corner nudged; keep the
     best of each cluster so the caller gets genuinely different guesses. */
  found.sort((a, b) => b.score - a.score);
  const distinct = [];
  const straightforward = extremeQuad(candidates);
  if (straightforward) {
    distinct.push({
      quad: straightforward,
      cx: straightforward.reduce((sum, p) => sum + p.x, 0) / 4,
      cy: straightforward.reduce((sum, p) => sum + p.y, 0) / 4,
      size: distance(straightforward[0], straightforward[1]) || 1,
    });
  }
  for (const item of found) {
    if (distinct.some((kept) => Math.hypot(kept.cx - item.cx, kept.cy - item.cy) < kept.size * 0.25)) continue;
    distinct.push(item);
    if (distinct.length >= wanted) break;
  }
  return distinct.map((item) => item.quad);
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
 * The obvious way to find a ruled table is to pull out its long straight lines
 * with a morphological opening. It works beautifully on a card lying flat and
 * fails completely on a real one: paper that has been in a pocket is bowed,
 * and a rule that drifts by two pixels across its length is not a straight
 * line any more, so the opening erases the whole table.
 *
 * So the boxes are found by what they *enclose* rather than by what draws
 * them. A score box is a small island of white paper with ruling all the way
 * round it, and that is just as true when the ruling is curved. Thickening the
 * ink slightly first closes the gaps a faint rule leaves behind, which is what
 * stops one box leaking into the next.
 *
 * Handwriting that touches the ruling splits a box's white into two, so that
 * box is lost - but the boxes are a regular grid and the ones that were found
 * say where the missing ones are, which `gridOf` relies on.
 */
function ruledCells(cv, flat, debug) {
  const gray = grayscale(cv, flat);

  /* Paper as white, the mirror image of the ink mask: everything the reader
     does here is about the shape of the gaps, not the marks. */
  const paper = new cv.Mat();
  let block = Math.round((5 * gray.cols) / CARD_MM.width);
  block = Math.max(11, block | 1);
  cv.adaptiveThreshold(gray, paper, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 9);
  gray.delete();

  /* Eroding the paper thickens the ruling, closing the gaps a light print or
     a shadow leaves in it. */
  const thicken = kernel(cv, 3, 3);
  cv.morphologyEx(paper, paper, cv.MORPH_ERODE, thicken);
  thicken.delete();

  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const cells = [];
  try {
    const count = cv.connectedComponentsWithStats(paper, labels, stats, centroids, 4, cv.CV_32S);
    for (let i = 1; i < count; i += 1) {
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (w < px(20) || w > px(42)) continue;
      const aspect = w / h;
      if (aspect < 1.6 || aspect > 5) continue;
      /* An island of paper, not a ragged region that happens to be that wide. */
      if (area / (w * h) < 0.6) continue;
      cells.push(new cv.Rect(stats.intAt(i, cv.CC_STAT_LEFT), stats.intAt(i, cv.CC_STAT_TOP), w, h));
    }
  } finally {
    labels.delete();
    stats.delete();
    centroids.delete();
    if (debug) debug.grid = pixels(cv, paper);
    paper.delete();
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
 * Reads one frame.
 *
 * @param cv      the loaded OpenCV namespace
 * @param frame   { width, height, data } - raw RGBA, as ImageData carries it
 * @returns {{ ok: boolean, reason?: string, code?: number[], rows?: Array }}
 */
export function readCard(cv, frame, { debug = false } = {}) {
  const stages = debug ? {} : null;
  const src = frameMat(cv, frame);
  /* Only the Mats made here get freed; the ones in `scratch` outlive the call. */
  const owned = [];
  const done = () => owned.forEach((mat) => mat && !mat.isDeleted() && mat.delete());

  try {
    scratch.gray = grayscale(cv, src, scratch.gray);

    const candidates = anchorCandidates(cv, scratch.gray);
    const quads = findAnchorQuads(cv, candidates, scratch.gray, ATTEMPTS);
    if (!quads.length) return { ok: false, reason: "anchors", stages };

    if (!scratch.detector) scratch.detector = new cv.QRCodeDetector();

    /*
     * Geometry proposes, the card disposes.
     *
     * No arrangement of four dark squares is proof that they are a scorecard's
     * corner marks, and on a real photograph the best-scoring rectangle is
     * often a coincidence - a pattern in a sofa, three specks and a shadow.
     * What is proof is squaring the thing up and finding a readable code and a
     * ruled table inside it, so the likeliest few are simply tried in turn and
     * the first that proves itself wins.
     *
     * Each is tried both ways up as well. Four marks at the corners of a
     * rectangle look identical upside down, and nothing in their geometry says
     * which corner is the top left - but the QR code only decodes one way
     * round, so it settles that too.
     */
    let bestFailure = "anchors";
    for (const quad of quads) {
      for (const corners of [quad, [quad[2], quad[3], quad[0], quad[1]]]) {
        const flat = squareUp(cv, src, corners);
        owned.push(flat);

        const text = scratch.detector.detectAndDecode(flat);
        /* The payload is three raw bytes, not text, and comes back one
           character per byte. Anything else is a code from somewhere other
           than our card. */
        if (text.length !== 3) continue;
        const code = [...text].map((ch) => ch.charCodeAt(0) & 0xff);

        const cells = ruledCells(cv, flat, stages);
        const grid = gridOf(cells, flat);
        if (stages) stages.flat = pixels(cv, flat);
        if (!grid) {
          bestFailure = "boxes";
          continue;
        }

        const rows = grid.map(([a, b]) => ({
          a: digitsIn(cv, flat, a),
          b: digitsIn(cv, flat, b),
        }));
        return { ok: true, code, rows, stages };
      }
    }
    return { ok: false, reason: bestFailure, stages };
  } finally {
    done();
  }
}

/** A Mat as plain RGBA bytes, for the test harness to look at. */
function pixels(cv, mat) {
  const rgba = new cv.Mat();
  cv.cvtColor(mat, rgba, mat.channels() === 1 ? cv.COLOR_GRAY2RGBA : cv.COLOR_RGB2RGBA);
  const out = { width: rgba.cols, height: rgba.rows, data: new Uint8ClampedArray(rgba.data) };
  rgba.delete();
  return out;
}
