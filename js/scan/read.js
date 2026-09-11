/*
 * One photograph in, one match result out.
 *
 * The three steps either side of this are deliberately separate and testable:
 * card.js knows about paper and lenses, digits.js knows about handwriting, and
 * reconcile.js knows the rules of table tennis. This is the only place that
 * knows about all three, and about the tournament the card came from.
 */
import { readCard } from "./card.js";
import { readBox } from "./digits.js";
import { reconcile, totalsAgree } from "./reconcile.js";

/** Below this a row is shown as needing a look before it is saved. */
export const SURE_ENOUGH = 0.9;

/**
 * @param cv        the loaded OpenCV namespace
 * @param source    a canvas or image holding the photo
 * @param lookup    (tournamentNo, matchNo) => { tournament, match } | null
 * @returns a reading, or a reason it could not be read
 */
export function readScorecard(cv, source, lookup) {
  const card = readCard(cv, source);
  if (!card.ok) return { ok: false, reason: card.reason };
  if (!card.code) return { ok: false, reason: "code", flat: card.flat };

  const [tournamentNo, matchHigh, matchLow] = card.code;
  const matchNo = (matchHigh << 8) | matchLow;
  const found = lookup(tournamentNo, matchNo);
  if (!found) return { ok: false, reason: "unknown", tournamentNo, matchNo, flat: card.flat };

  const { tournament, match } = found;

  /* The last row of the table is the sets each player won, not a set score. */
  const boxes = card.rows.map((row) => ({ a: readBox(row.a), b: readBox(row.b) }));
  const totals = boxes.length > 1 ? boxes[boxes.length - 1] : null;
  const setRows = boxes.slice(0, Math.max(0, boxes.length - 1));

  const result = reconcile(setRows, tournament.settings);
  if (!result.ok) {
    return { ok: false, reason: result.error, tournament, match, matchNo, tournamentNo, flat: card.flat };
  }

  return {
    ok: true,
    tournament,
    match,
    tournamentNo,
    matchNo,
    sets: result.sets,
    confidence: result.confidence,
    unsure: result.confidence.map((value, i) => (value < SURE_ENOUGH ? i : -1)).filter((i) => i >= 0),
    totalsAgree: totalsAgree(totals, result.sets),
    flat: card.flat,
  };
}
