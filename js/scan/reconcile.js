/*
 * Turning what the classifier saw into a result the app will accept.
 *
 * A digit classifier on its own is a poor reader of scorecards, because the
 * boxes are not independent. A set ends at eleven with a two point margin, so
 * 16-16 never happened and neither did 17-9: if one player is under ten the
 * other has exactly eleven. A match stops the moment someone has enough sets,
 * so a fourth set on the card proves nobody had won three after the third. And
 * every box after the decisive set is blank.
 *
 * Those rules throw away almost every reading a per-digit guess would allow, so
 * the reader does not read each box and hope. It proposes every score a set can
 * legally end on, asks the ink how much it likes each one, and searches for the
 * most likely reading of the whole card that the rules permit.
 *
 * That is what lets it repair a box outright. Take a card reading 4-11, 6-11,
 * 16-16, 9-11. The third set is impossible as written. Had player two won it
 * the match would have finished there at 0-3, and yet a fourth set was played -
 * so player one won the third, and it was either 18-16 or 16-14. The ink
 * decides between those two, and a written 6 misread as an 8 is far commoner
 * than one misread as a 4, so the card said 18-16. Nothing about that reasoning
 * is available to a classifier looking at one box.
 */
import { isValidSet, setsToWin } from "../model.js";
import { scoreValue } from "./digits.js";

/* What a box with nothing in it is worth as a reading of a number. A set with
   one side missing is a real situation - a digit lost to a crease - so it is
   not ruled out, just made to pay, and every value costs the same because the
   ink says nothing either way. */
const SIDE_UNREAD = 0.02;

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

/**
 * Every score a set can legally end on, worked out once per match length.
 *
 * There are only a few dozen: one side reaches the target with the other under
 * it, or both climb past it two apart. Enumerating them and scoring each
 * against the ink is both cheaper and better than reading the ink and hoping it
 * lands on one, because it means an impossible reading has somewhere to go.
 */
const legalCache = new Map();

function legalPairs(pointsPerSet) {
  const hit = legalCache.get(pointsPerSet);
  if (hit) return hit;

  const pairs = [];
  for (let loser = 0; loser <= pointsPerSet + 14; loser += 1) {
    const winner = loser >= pointsPerSet - 1 ? loser + 2 : pointsPerSet;
    if (winner > 99) break;
    if (isValidSet(winner, loser, pointsPerSet)) pairs.push([winner, loser], [loser, winner]);
  }
  legalCache.set(pointsPerSet, pairs);
  return pairs;
}

/**
 * Every legal score for one row, with what the ink thinks of each.
 * Returns null for a row with nothing written in it at all.
 */
function pairsFor(row, pointsPerSet) {
  const { a, b } = row;
  if (a.empty && b.empty) return null; // an unplayed set

  const side = (box, value) => (box.empty ? SIDE_UNREAD : scoreValue(box, value));

  return legalPairs(pointsPerSet)
    .map(([left, right]) => ({
      a: left,
      b: right,
      p: side(a, left) * side(b, right) * plausibility(left, right, pointsPerSet),
    }))
    /* Nothing is impossible, only expensive: a floor keeps a set the reader
       completely failed on from collapsing the search for the whole card. */
    .map((pair) => ({ ...pair, p: Math.max(pair.p, 1e-12) }));
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

/** What a row appears to say, before the rules get to it. */
function asRead(row) {
  const top = (box) => (box.empty || !box.options.length ? null : box.options[0].value);
  return [top(row.a), top(row.b)];
}

/**
 * Reads the rows of one card.
 *
 * @param rows      per-row box readings from digits.readBox
 * @param settings  the tournament's bestOf and pointsPerSet
 * @returns {{ ok, sets, confidence, inferred, error }}
 */
export function reconcile(rows, settings) {
  /* Every row after the last one with ink in it is an unplayed set: the card
     always prints seven rows however long the match was. */
  const perRow = rows.map((row) => pairsFor(row, settings.pointsPerSet));
  let last = perRow.length - 1;
  while (last >= 0 && perRow[last] === null) last -= 1;
  if (last < 0) return { ok: false, error: "blank", sets: [], confidence: [], inferred: [] };

  /* A blank row with written rows after it is a set the reader failed to see,
     not one that was never played, so the rules fill it in from nothing. */
  const played = perRow
    .slice(0, last + 1)
    .map((pairs) => pairs || legalPairs(settings.pointsPerSet).map(([a, b]) => ({ a, b, p: SIDE_UNREAD * SIDE_UNREAD })));

  const best = search(played, settings, null);
  if (!best) return { ok: false, error: "illegal", sets: [], confidence: [], inferred: [] };

  /* How sure the reader is about each row: how much worse the best reading of
     the whole card gets if that row is forced to say something else. */
  const confidence = best.picks.map((pick, row) => {
    const alternative = search(played, settings, { row, a: pick.a, b: pick.b });
    if (!alternative) return 1;
    return 1 / (1 + Math.exp(alternative.logp - best.logp));
  });

  /* Rows where the rules overruled the ink. These are the reader's own
     reasoning rather than its reading, so the screen says so. */
  const inferred = [];
  best.picks.forEach((pick, row) => {
    const read = asRead(rows[row]);
    if (read[0] === pick.a && read[1] === pick.b) return;
    inferred.push({ row, read, chosen: [pick.a, pick.b] });
  });

  return {
    ok: true,
    sets: best.picks.map((pick) => [pick.a, pick.b]),
    confidence,
    inferred,
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
