/*
 * One frame in, one match result out.
 *
 * The three steps either side of this are deliberately separate and testable:
 * card.js knows about paper and lenses, digits.js knows about handwriting, and
 * reconcile.js knows the rules of table tennis. This is the only place that
 * knows about all three.
 *
 * It runs in a worker, so it never sees a tournament - only a small table of
 * what each tournament number means, which is all the rules need. Turning the
 * numbers back into players is the main thread's job.
 */
import { readCard } from "./card.js";
import { readBox } from "./digits.js";
import { reconcile, totalsAgree } from "./reconcile.js";

/*
 * Below this a row is shown as needing a look before it is saved.
 *
 * Set high on purpose. The cost of marking a row that turned out to be right
 * is a glance; the cost of not marking one that turned out to be wrong is a
 * wrong result saved in a tournament, which nobody finds until the standings
 * look odd. Tuning this down to reduce the marks would be optimising the wrong
 * thing.
 */
export const SURE_ENOUGH = 0.98;

/**
 * @param cv          the loaded OpenCV namespace
 * @param frame       { width, height, data } - raw RGBA
 * @param tournaments { [no]: { bestOf, pointsPerSet, matches: number[] } }
 */
export function readScorecard(cv, frame, tournaments) {
  const card = readCard(cv, frame);
  if (!card.ok) return { ok: false, reason: card.reason };
  if (!card.code) return { ok: false, reason: "code" };

  const [tournamentNo, matchHigh, matchLow] = card.code;
  const matchNo = (matchHigh << 8) | matchLow;
  const known = tournaments[tournamentNo];
  if (!known || !known.matches.includes(matchNo)) {
    return { ok: false, reason: "unknown", tournamentNo, matchNo };
  }

  /* The last row of the table is the sets each player won, not a set score. */
  const boxes = card.rows.map((row) => ({ a: readBox(row.a), b: readBox(row.b) }));
  const totals = boxes.length > 1 ? boxes[boxes.length - 1] : null;
  const setRows = boxes.slice(0, Math.max(0, boxes.length - 1));

  const result = reconcile(setRows, known);
  if (!result.ok) return { ok: false, reason: result.error, tournamentNo, matchNo };

  /* A row the rules had to reconstruct is not the same as one that was merely
     hard to read, so the two are kept apart all the way to the screen. */
  const inferred = new Set(result.inferred.map((item) => item.row));

  return {
    ok: true,
    tournamentNo,
    matchNo,
    sets: result.sets,
    confidence: result.confidence,
    unsure: result.confidence
      .map((value, i) => (value < SURE_ENOUGH && !inferred.has(i) ? i : -1))
      .filter((i) => i >= 0),
    inferred: result.inferred,
    totalsAgree: totalsAgree(totals, result.sets),
  };
}
