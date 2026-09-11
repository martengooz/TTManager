/*
 * Turning what the classifier saw into a result the app will accept.
 *
 * A digit classifier on its own is a poor reader of scorecards, because the
 * boxes are not independent: a set ends at eleven with a two point margin, a
 * match stops the moment someone has enough sets, and every box after that is
 * blank. Those rules throw away the overwhelming majority of readings that a
 * per-digit guess would allow, so the reader does not pick each box on its own
 * and hope - it searches for the most likely reading of the whole card that
 * the rules would let an organiser type in by hand.
 *
 * This is where most of the accuracy comes from. A 9 misread as a 4 in
 * isolation is usually settled by the fact that only one of them makes a legal
 * set, and the score that fell out of the search is the one the card must have
 * meant.
 */
import { isValidSet, setsToWin } from "../model.js";

/* What a box with nothing in it, or one side missing, is worth. Both are real
   situations - an unplayed set, or a digit lost to a crease - so neither is
   ruled out, but both are made expensive enough that a clean reading wins. */
const UNREADABLE = 1e-3;
const HALF_READ = 0.05;

/*
 * How believable a set score is, beyond being legal.
 *
 * isValidSet is happy with 74-72: deuce has no ceiling in the rules, so the
 * arithmetic checks out. Table tennis does not work that way, and a reading
 * that lands there is a misread every time, so scores past a long deuce are
 * damped hard rather than forbidden - a card that really does say 24-22 can
 * still say it, as long as the digits are clear about it.
 */
function plausibility(a, b, pointsPerSet) {
  const over = Math.max(a, b) - (pointsPerSet + 9);
  return over <= 0 ? 1 : 0.1 ** over;
}

/** Every score a legal set can end on, when nothing readable narrows it down. */
function anyLegalPair(pointsPerSet, p) {
  const out = [];
  for (let loser = 0; loser <= pointsPerSet + 8; loser += 1) {
    const winner = loser >= pointsPerSet - 1 ? loser + 2 : pointsPerSet;
    out.push({ a: winner, b: loser, p }, { a: loser, b: winner, p });
  }
  return out;
}

/**
 * Legal (a, b) pairs for one row, with the probability the reader gives each.
 * Returns null for a row with nothing written in it at all.
 */
function pairsFor(row, pointsPerSet) {
  const { a, b } = row;
  if (a.empty && b.empty) return null; // an unplayed set

  const legal = [];
  const add = (valueA, valueB, p) => {
    if (p <= 0 || !isValidSet(valueA, valueB, pointsPerSet)) return;
    legal.push({ a: valueA, b: valueB, p: p * plausibility(valueA, valueB, pointsPerSet) });
  };

  if (!a.empty && !b.empty) {
    for (const left of a.options) for (const right of b.options) add(left.value, right.value, left.p * right.p);
  } else if (!a.empty) {
    /* One side readable: the rules know what the other side can have been. */
    for (const left of a.options) for (let value = 0; value <= left.value + 2; value += 1) add(left.value, value, left.p * HALF_READ);
  } else {
    for (const right of b.options) for (let value = 0; value <= right.value + 2; value += 1) add(value, right.value, right.p * HALF_READ);
  }

  /* Nothing the classifier offered is a legal set. Fall back to every score a
     set can end on, so the search still has something to work with and the
     organiser gets a row to correct rather than a dead end. */
  if (!legal.length) return anyLegalPair(pointsPerSet, UNREADABLE);

  legal.sort((x, y) => y.p - x.p);
  return legal.slice(0, 40);
}

/**
 * Best legal reading of the rows, as log probability plus the chosen pairs.
 *
 * `forbid` blocks one particular pair at one particular row, which is how the
 * per-row confidence below is worked out: the second best reading of the card
 * is the one where that row had to come out differently.
 */
function search(rowPairs, settings, forbid) {
  const target = setsToWin(settings.bestOf);
  let states = new Map([["0,0", { logp: 0, picks: [] }]]);

  for (let i = 0; i < rowPairs.length; i += 1) {
    const next = new Map();
    for (const [key, state] of states) {
      const [winsA, winsB] = key.split(",").map(Number);
      if (winsA >= target || winsB >= target) continue; // decided; no more sets allowed

      for (const pair of rowPairs[i]) {
        if (forbid && forbid.row === i && forbid.a === pair.a && forbid.b === pair.b) continue;
        const nextKey = `${winsA + (pair.a > pair.b ? 1 : 0)},${winsB + (pair.b > pair.a ? 1 : 0)}`;
        const logp = state.logp + Math.log(pair.p);
        const seen = next.get(nextKey);
        if (!seen || logp > seen.logp) next.set(nextKey, { logp, picks: [...state.picks, pair] });
      }
    }
    states = next;
    if (!states.size) return null;
  }

  let best = null;
  for (const [key, state] of states) {
    const [winsA, winsB] = key.split(",").map(Number);
    if (winsA !== target && winsB !== target) continue; // nobody got there
    if (!best || state.logp > best.logp) best = state;
  }
  return best;
}

/**
 * Reads the rows of one card.
 *
 * @param rows      per-row box readings from digits.readBox
 * @param settings  the tournament's bestOf and pointsPerSet
 * @returns {{ ok, sets, confidence, setsWon, error }}
 */
export function reconcile(rows, settings) {
  /* Every row after the last one with ink in it is an unplayed set: the card
     always prints seven rows however long the match was. */
  const perRow = rows.map((row) => pairsFor(row, settings.pointsPerSet));
  let last = perRow.length - 1;
  while (last >= 0 && perRow[last] === null) last -= 1;
  if (last < 0) return { ok: false, error: "blank", sets: [], confidence: [] };

  /*
   * A blank row with written rows after it is a set the reader failed to see,
   * not one that was never played, so the rules fill it in instead.
   *
   * Every row also keeps every legal score as a long-odds option. Without it a
   * single badly misread box that still happens to form a legal set - 5-11
   * where the card says 15-17 - makes the whole card unreadable, because no
   * combination of the remaining choices adds up to a finished match. With it
   * the search can overrule that one box, and the row comes back flagged for
   * the organiser instead of the card coming back as a failure.
   */
  const escape = anyLegalPair(settings.pointsPerSet, UNREADABLE);
  const played = perRow
    .slice(0, last + 1)
    .map((pairs) => (pairs ? [...pairs, ...escape] : [...escape]));

  const best = search(played, settings, null);
  if (!best) return { ok: false, error: "illegal", sets: [], confidence: [] };

  /* How sure the reader is about each row: how much worse the best reading of
     the whole card gets if that row is forced to say something else. */
  const confidence = best.picks.map((pick, row) => {
    const alternative = search(played, settings, { row, a: pick.a, b: pick.b });
    if (!alternative) return 1;
    return 1 / (1 + Math.exp(alternative.logp - best.logp));
  });

  return {
    ok: true,
    sets: best.picks.map((pick) => [pick.a, pick.b]),
    confidence,
    error: null,
  };
}

/**
 * The totals row, read on its own, as a check rather than as the answer.
 *
 * The umpire writes the sets each player won at the foot of the card. It is
 * the one thing on the sheet that says the same thing twice, so when it
 * disagrees with the sets above it the organiser should look before saving.
 */
export function totalsAgree(totalsRow, sets) {
  if (!totalsRow || totalsRow.a.empty || totalsRow.b.empty) return null;
  const best = (box) => (box.options.length ? box.options[0].value : null);
  const read = [best(totalsRow.a), best(totalsRow.b)];
  if (read[0] === null || read[1] === null) return null;

  const actual = sets.reduce((tally, [a, b]) => [tally[0] + (a > b ? 1 : 0), tally[1] + (b > a ? 1 : 0)], [0, 0]);
  return read[0] === actual[0] && read[1] === actual[1];
}
