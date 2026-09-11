/* Tournament domain model: creation, scheduling, scoring rules, standings, brackets. */
import { uid } from "./util.js";
import { t, ordinal as localOrdinal } from "./i18n.js";

export const FORMATS = {
  roundrobin: { label: "Round robin", short: "Round robin", description: "Everyone plays everyone. Final placing from the table." },
  groups_ko: { label: "Groups + knockout", short: "Groups + KO", description: "Group stage, then the best advance to a knockout bracket." },
  knockout: { label: "Knockout", short: "Knockout", description: "Straight single-elimination bracket." },
};

export const BEST_OF_OPTIONS = [1, 3, 5, 7, 9];

export function createTournament(input = {}) {
  const now = new Date().toISOString();
  return {
    id: uid("t"),
    schemaVersion: 1,
    name: input.name || "New tournament",
    venue: input.venue || "",
    date: input.date || new Date().toISOString().slice(0, 10),
    format: input.format || "roundrobin",
    settings: {
      bestOf: input.bestOf || 5,
      pointsPerSet: input.pointsPerSet || 11,
      groupCount: input.groupCount || 2,
      advancePerGroup: input.advancePerGroup || 2,
      doubleRoundRobin: !!input.doubleRoundRobin,
      thirdPlaceMatch: input.thirdPlaceMatch !== false,
      tables: input.tables || 1,
    },
    players: [],
    groups: [],
    matches: [],
    startedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addPlayer(tournament, name, club = "") {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const player = { id: uid("p"), name: trimmed, club: String(club || "").trim(), seed: tournament.players.length + 1 };
  tournament.players.push(player);
  return player;
}

export function removePlayer(tournament, playerId) {
  tournament.players = tournament.players.filter((p) => p.id !== playerId);
  tournament.players.forEach((p, i) => { p.seed = i + 1; });
}

/** A group's display name, translated. Older saves only carry the English name. */
export function groupName(group) {
  if (!group) return "";
  if (group.letter) return t("Group {letter}", { letter: group.letter });
  if (group.letter === "") return t("Group");
  return group.name || t("Group");
}

/** What a match is called: its group, its knockout round, or the bronze match. */
export function matchLabel(tournament, match) {
  if (!match) return "";
  if (match.stage === "group") {
    return groupName(tournament.groups.find((g) => g.id === match.groupId));
  }
  if (match.thirdPlace) return t("Third place");
  const ko = tournament.matches.filter((m) => m.stage === "ko" && !m.thirdPlace);
  const totalRounds = ko.length ? Math.max(...ko.map((m) => m.round)) + 1 : 1;
  return roundName(match.round, totalRounds);
}

export function playerById(tournament, playerId) {
  return tournament.players.find((p) => p.id === playerId) || null;
}

export function playerName(tournament, playerId) {
  const player = playerById(tournament, playerId);
  return player ? player.name : "";
}

/* ------------------------------------------------------------------ *
 * Scoring rules
 * ------------------------------------------------------------------ */

export function setsToWin(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * A set is legal when the winner reaches the target score with a two point
 * margin, or wins by exactly two once both players are one point short of it.
 */
export function isValidSet(a, b, pointsPerSet = 11) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  if (a === b) return false;
  const winner = Math.max(a, b);
  const loser = Math.min(a, b);
  if (loser >= pointsPerSet - 1) return winner === loser + 2;
  return winner === pointsPerSet;
}

export function setWinsFromSets(sets) {
  return sets.reduce(
    (tally, [a, b]) => {
      if (a > b) tally[0] += 1;
      else if (b > a) tally[1] += 1;
      return tally;
    },
    [0, 0]
  );
}

export function pointsFromSets(sets) {
  return sets.reduce(
    (tally, [a, b]) => [tally[0] + a, tally[1] + b],
    [0, 0]
  );
}

/** Validates a whole match result. Returns { ok, error, winnerSide, setWins }. */
export function validateResult(sets, settings) {
  const bestOf = settings.bestOf;
  const target = setsToWin(bestOf);
  const clean = sets.filter(([a, b]) => a !== null && b !== null && !(a === 0 && b === 0));
  if (!clean.length) return { ok: false, error: t("Enter at least one set.") };

  let wins = [0, 0];
  for (let i = 0; i < clean.length; i += 1) {
    const [a, b] = clean[i];
    if (wins[0] >= target || wins[1] >= target) {
      return { ok: false, error: t("The match was already decided after set {n}. Remove the extra sets.", { n: i }) };
    }
    if (!isValidSet(a, b, settings.pointsPerSet)) {
      return {
        ok: false,
        error: t("Set {n} ({a}-{b}) is not a legal score: first to {points}, win by two.", {
          n: i + 1,
          a,
          b,
          points: settings.pointsPerSet,
        }),
      };
    }
    if (a > b) wins[0] += 1;
    else wins[1] += 1;
  }
  if (wins[0] < target && wins[1] < target) {
    return {
      ok: false,
      error: t("Best of {n}: someone needs {target} sets to win (currently {a}-{b}).", {
        n: bestOf,
        target,
        a: wins[0],
        b: wins[1],
      }),
    };
  }
  return { ok: true, winnerSide: wins[0] > wins[1] ? 0 : 1, setWins: wins, sets: clean };
}

/* ------------------------------------------------------------------ *
 * Match helpers
 * ------------------------------------------------------------------ */

export function makeMatch(fields) {
  return {
    id: uid("m"),
    stage: "group",
    groupId: null,
    round: 0,
    order: 0,
    label: "",
    p1: null,
    p2: null,
    p1Source: null,
    p2Source: null,
    sets: [],
    winnerId: null,
    loserId: null,
    status: "pending", // pending | played | walkover | bye
    walkoverWinnerId: null,
    table: null,
    ...fields,
  };
}

export function isPlayable(match) {
  return !!(match.p1 && match.p2);
}

export function matchScoreLine(match) {
  if (match.status === "bye") return "bye";
  if (match.status === "walkover") return "w/o";
  if (!match.sets.length) return "";
  const [a, b] = setWinsFromSets(match.sets);
  return `${a}–${b}`;
}

export function setsLine(match) {
  return match.sets.map(([a, b]) => `${a}-${b}`).join(", ");
}

export function recordResult(tournament, matchId, sets) {
  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: t("Match not found.") };
  const result = validateResult(sets, tournament.settings);
  if (!result.ok) return result;
  match.sets = result.sets.map(([a, b]) => [a, b]);
  match.status = "played";
  match.walkoverWinnerId = null;
  match.winnerId = result.winnerSide === 0 ? match.p1 : match.p2;
  match.loserId = result.winnerSide === 0 ? match.p2 : match.p1;
  tournament.startedAt = tournament.startedAt || new Date().toISOString();
  refresh(tournament);
  return { ok: true };
}

export function recordWalkover(tournament, matchId, winnerId) {
  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: t("Match not found.") };
  if (winnerId !== match.p1 && winnerId !== match.p2) return { ok: false, error: t("Pick the player who advances.") };
  match.sets = [];
  match.status = "walkover";
  match.walkoverWinnerId = winnerId;
  match.winnerId = winnerId;
  match.loserId = winnerId === match.p1 ? match.p2 : match.p1;
  tournament.startedAt = tournament.startedAt || new Date().toISOString();
  refresh(tournament);
  return { ok: true };
}

export function clearResult(tournament, matchId) {
  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match) return;
  match.sets = [];
  match.status = "pending";
  match.winnerId = null;
  match.loserId = null;
  match.walkoverWinnerId = null;
  refresh(tournament);
}

/* ------------------------------------------------------------------ *
 * Draw: groups and schedules
 * ------------------------------------------------------------------ */

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const GROUP_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Snake distribution keeps seeded players apart. */
function distribute(playerIds, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  playerIds.forEach((id, index) => {
    const row = Math.floor(index / groupCount);
    const col = index % groupCount;
    const target = row % 2 === 0 ? col : groupCount - 1 - col;
    groups[target].push(id);
  });
  return groups;
}

/** Circle method: returns rounds of [a, b] pairs; null means a bye. */
export function roundRobinRounds(playerIds) {
  const ids = playerIds.slice();
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null);
  const half = ids.length / 2;
  const rounds = [];
  let list = ids.slice();
  for (let r = 0; r < ids.length - 1; r += 1) {
    const pairs = [];
    for (let i = 0; i < half; i += 1) {
      const a = list[i];
      const b = list[list.length - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list = [list[0], list[list.length - 1], ...list.slice(1, list.length - 1)];
  }
  return rounds;
}

export function drawTournament(tournament, { random = true } = {}) {
  const ids = (random ? shuffled(tournament.players.map((p) => p.id)) : tournament.players.map((p) => p.id));
  tournament.groups = [];
  tournament.matches = [];
  tournament.startedAt = null;

  if (tournament.format === "knockout") {
    buildKnockout(tournament, ids.map((id) => ({ type: "player", playerId: id })));
    refresh(tournament);
    numberMatches(tournament);
    return tournament;
  }

  const groupCount = tournament.format === "roundrobin" ? 1 : Math.max(1, Math.min(tournament.settings.groupCount, Math.floor(ids.length / 2) || 1));
  const buckets = distribute(ids, groupCount);
  buckets.forEach((playerIds, index) => {
    const letter = groupCount === 1 ? "" : GROUP_NAMES[index] || String(index + 1);
    tournament.groups.push({
      id: uid("g"),
      letter,
      // Kept for tournaments saved before names were translated.
      name: letter ? `Group ${letter}` : "Group",
      playerIds,
    });
  });

  tournament.groups.forEach((group) => {
    const legs = tournament.settings.doubleRoundRobin ? 2 : 1;
    let order = 0;
    for (let leg = 0; leg < legs; leg += 1) {
      roundRobinRounds(group.playerIds).forEach((pairs, roundIndex) => {
        pairs.forEach(([a, b]) => {
          tournament.matches.push(
            makeMatch({
              stage: "group",
              groupId: group.id,
              round: leg * 100 + roundIndex,
              order: order++,
              p1: leg === 0 ? a : b,
              p2: leg === 0 ? b : a,
              label: "",
            })
          );
        });
      });
    }
  });

  if (tournament.format === "groups_ko") {
    const advance = Math.max(1, tournament.settings.advancePerGroup);
    const entrants = [];
    // Seeds run rank-major (all winners, then all runners-up, ...). Because the
    // bracket pairs seed n with seed (size + 1 - n), that keeps players from the
    // same group on opposite sides of the first round.
    for (let rank = 1; rank <= advance; rank += 1) {
      tournament.groups.forEach((group) => {
        if (group.playerIds.length >= rank) entrants.push({ type: "groupRank", groupId: group.id, rank });
      });
    }
    buildKnockout(tournament, entrants);
  }

  refresh(tournament);
  numberMatches(tournament);
  return tournament;
}

/**
 * Numbers the matches that will actually be played, in draw order. The number
 * is what the organiser sees on screen and what a scorecard carries, so it has
 * to be stable once drawn.
 */
export function numberMatches(tournament) {
  let next = 1;
  tournament.matches.forEach((match) => {
    match.no = match.status === "bye" ? null : next++;
  });
  return tournament;
}

/* ------------------------------------------------------------------ *
 * Knockout bracket
 * ------------------------------------------------------------------ */

/** Standard seeding order for a bracket of `size` slots: [1, 16, 9, 8, ...]. */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const round = order.length * 2;
    const next = [];
    order.forEach((seed) => {
      next.push(seed, round + 1 - seed);
    });
    order = next;
  }
  return order;
}

export function roundName(roundIndex, totalRounds) {
  const fromEnd = totalRounds - roundIndex;
  if (fromEnd === 1) return t("Final");
  if (fromEnd === 2) return t("Semi-finals");
  if (fromEnd === 3) return t("Quarter-finals");
  const size = 2 ** fromEnd;
  if (size === 16) return t("Round of 16");
  if (size === 32) return t("Round of 32");
  return t("Round of {n}", { n: size });
}

function buildKnockout(tournament, entrants) {
  if (entrants.length < 2) return;
  const size = 2 ** Math.ceil(Math.log2(entrants.length));
  const order = seedOrder(size);
  const slots = order.map((seed) => entrants[seed - 1] || null);
  const totalRounds = Math.log2(size);

  let previous = [];
  for (let round = 0; round < totalRounds; round += 1) {
    const count = size / 2 ** (round + 1);
    const current = [];
    for (let i = 0; i < count; i += 1) {
      const match = makeMatch({
        stage: "ko",
        round,
        order: i,
        label: roundName(round, totalRounds),
        p1Source: round === 0 ? slots[i * 2] : { type: "winner", matchId: previous[i * 2].id },
        p2Source: round === 0 ? slots[i * 2 + 1] : { type: "winner", matchId: previous[i * 2 + 1].id },
      });
      current.push(match);
      tournament.matches.push(match);
    }
    previous = current;
  }

  if (tournament.settings.thirdPlaceMatch && totalRounds >= 2) {
    const semis = tournament.matches.filter((m) => m.stage === "ko" && m.round === totalRounds - 2);
    tournament.matches.push(
      makeMatch({
        stage: "ko",
        round: totalRounds - 1,
        order: 99,
        label: "Third place",
        thirdPlace: true,
        p1Source: { type: "loser", matchId: semis[0].id },
        p2Source: { type: "loser", matchId: semis[1].id },
      })
    );
  }
}

export function knockoutRounds(tournament) {
  const ko = tournament.matches.filter((m) => m.stage === "ko" && !m.thirdPlace);
  if (!ko.length) return [];
  const totalRounds = Math.max(...ko.map((m) => m.round)) + 1;
  return Array.from({ length: totalRounds }, (_, round) => ({
    round,
    name: roundName(round, totalRounds),
    matches: ko.filter((m) => m.round === round).sort((a, b) => a.order - b.order),
  }));
}

export function thirdPlaceMatch(tournament) {
  return tournament.matches.find((m) => m.thirdPlace) || null;
}

function resolveSource(tournament, source, standingsByGroup) {
  if (!source) return null;
  if (source.type === "player") return source.playerId;
  if (source.type === "groupRank") {
    const table = standingsByGroup[source.groupId];
    if (!table) return null;
    const complete = groupComplete(tournament, source.groupId);
    if (!complete) return null;
    const row = table[source.rank - 1];
    return row ? row.playerId : null;
  }
  if (source.type === "winner") {
    const match = tournament.matches.find((m) => m.id === source.matchId);
    return match ? match.winnerId : null;
  }
  if (source.type === "loser") {
    const match = tournament.matches.find((m) => m.id === source.matchId);
    return match ? match.loserId : null;
  }
  return null;
}

export function sourceLabel(tournament, source) {
  if (!source) return t("Bye");
  if (source.type === "player") return playerName(tournament, source.playerId) || t("TBD");
  if (source.type === "groupRank") {
    const group = tournament.groups.find((g) => g.id === source.groupId);
    return group ? t("{rank} {group}", { rank: ordinal(source.rank), group: groupName(group) }) : t("TBD");
  }
  const match = tournament.matches.find((m) => m.id === source.matchId);
  if (!match) return t("TBD");
  const key = source.type === "winner" ? "Winner {round} {n}" : "Loser {round} {n}";
  return t(key, { round: matchLabel(tournament, match), n: match.order + 1 });
}

export const ordinal = localOrdinal;

/** Recomputes knockout participants after any result changes. */
export function refresh(tournament) {
  const standingsByGroup = {};
  tournament.groups.forEach((group) => {
    standingsByGroup[group.id] = standings(tournament, group.id);
  });

  const ko = tournament.matches.filter((m) => m.stage === "ko").sort((a, b) => a.round - b.round || a.order - b.order);
  ko.forEach((match) => {
    const p1 = resolveSource(tournament, match.p1Source, standingsByGroup);
    const p2 = resolveSource(tournament, match.p2Source, standingsByGroup);
    const changed = p1 !== match.p1 || p2 !== match.p2;
    match.p1 = p1;
    match.p2 = p2;

    if (changed && match.status !== "pending") {
      const stillValid = match.winnerId && (match.winnerId === p1 || match.winnerId === p2) && p1 && p2;
      if (!stillValid) {
        match.sets = [];
        match.status = "pending";
        match.winnerId = null;
        match.loserId = null;
        match.walkoverWinnerId = null;
      }
    }

    // A third place match behind a bye semi-final can never be played: the
    // beaten semi-finalist takes third and nobody plays for fourth.
    if (match.thirdPlace) {
      const feeders = [match.p1Source, match.p2Source]
        .map((source) => (source ? tournament.matches.find((m) => m.id === source.matchId) : null))
        .filter(Boolean);
      if (feeders.some((feeder) => feeder.status === "bye")) {
        match.status = "bye";
        match.sets = [];
        match.winnerId = p1 || p2 || null;
        match.loserId = null;
      }
    }

    // A first round slot with no source at all is a bye: the other side walks
    // on. It stays a bye even before the entrant is known, so it never counts
    // as a match to play.
    const isBye = match.round === 0 && !match.thirdPlace && (!match.p1Source || !match.p2Source);
    if (isBye) {
      const advancing = match.p1Source ? p1 : p2;
      match.status = "bye";
      match.sets = [];
      match.winnerId = advancing || null;
      match.loserId = null;
    }
  });

  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function groupComplete(tournament, groupId) {
  const matches = tournament.matches.filter((m) => m.stage === "group" && m.groupId === groupId);
  return matches.length > 0 && matches.every((m) => m.winnerId);
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

function blankRow(playerId) {
  return {
    playerId,
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    setsWon: 0,
    setsLost: 0,
    pointsWon: 0,
    pointsLost: 0,
    rank: 0,
  };
}

function ratio(won, lost) {
  if (lost === 0) return won === 0 ? 0 : Infinity;
  return won / lost;
}

/** Aggregates rows for `playerIds` over `matches` only. */
function tally(tournament, playerIds, matches) {
  const rows = new Map(playerIds.map((id) => [id, blankRow(id)]));
  matches.forEach((match) => {
    if (!match.winnerId || !rows.has(match.p1) || !rows.has(match.p2)) return;
    const a = rows.get(match.p1);
    const b = rows.get(match.p2);
    const [setsA, setsB] = setWinsFromSets(match.sets);
    const [ptsA, ptsB] = pointsFromSets(match.sets);
    a.played += 1;
    b.played += 1;
    a.setsWon += setsA; a.setsLost += setsB;
    b.setsWon += setsB; b.setsLost += setsA;
    a.pointsWon += ptsA; a.pointsLost += ptsB;
    b.pointsWon += ptsB; b.pointsLost += ptsA;
    const winner = match.winnerId === match.p1 ? a : b;
    const loser = match.winnerId === match.p1 ? b : a;
    winner.wins += 1;
    winner.points += 2;
    loser.losses += 1;
    loser.points += match.status === "walkover" ? 0 : 1;
  });
  return rows;
}

/**
 * ITTF-style ranking: match points first, then a mini league between the tied
 * players, then set ratio and point ratio across the whole group.
 */
export function standings(tournament, groupId) {
  const group = tournament.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const matches = tournament.matches.filter((m) => m.stage === "group" && m.groupId === groupId);
  const rows = tally(tournament, group.playerIds, matches);
  const all = Array.from(rows.values());

  const ordered = [];
  const byPoints = new Map();
  all.forEach((row) => {
    if (!byPoints.has(row.points)) byPoints.set(row.points, []);
    byPoints.get(row.points).push(row);
  });

  Array.from(byPoints.keys())
    .sort((a, b) => b - a)
    .forEach((points) => {
      const tied = byPoints.get(points);
      ordered.push(...breakTie(tournament, tied, matches));
    });

  ordered.forEach((row, index) => {
    row.rank = index + 1;
    row.setRatio = ratio(row.setsWon, row.setsLost);
    row.pointRatio = ratio(row.pointsWon, row.pointsLost);
  });
  return ordered;
}

function breakTie(tournament, tied, allMatches) {
  if (tied.length < 2) return tied;
  const ids = tied.map((r) => r.playerId);
  const mini = allMatches.filter((m) => ids.includes(m.p1) && ids.includes(m.p2) && m.winnerId);
  const miniRows = tally(tournament, ids, mini);

  const compare = (a, b) => {
    const ma = miniRows.get(a.playerId);
    const mb = miniRows.get(b.playerId);
    if (mb.points !== ma.points) return mb.points - ma.points;
    const setRatioDiff = ratio(mb.setsWon, mb.setsLost) - ratio(ma.setsWon, ma.setsLost);
    if (setRatioDiff) return setRatioDiff > 0 ? 1 : -1;
    const pointRatioDiff = ratio(mb.pointsWon, mb.pointsLost) - ratio(ma.pointsWon, ma.pointsLost);
    if (pointRatioDiff) return pointRatioDiff > 0 ? 1 : -1;
    const overallSets = ratio(b.setsWon, b.setsLost) - ratio(a.setsWon, a.setsLost);
    if (overallSets) return overallSets > 0 ? 1 : -1;
    const overallPoints = ratio(b.pointsWon, b.pointsLost) - ratio(a.pointsWon, a.pointsLost);
    if (overallPoints) return overallPoints > 0 ? 1 : -1;
    return playerName(tournament, a.playerId).localeCompare(playerName(tournament, b.playerId));
  };

  return tied.slice().sort(compare);
}

/* ------------------------------------------------------------------ *
 * Progress + final placings
 * ------------------------------------------------------------------ */

export function progress(tournament) {
  const playable = tournament.matches.filter((m) => m.status !== "bye");
  const done = playable.filter((m) => m.winnerId);
  return { done: done.length, total: playable.length, pct: playable.length ? Math.round((done.length / playable.length) * 100) : 0 };
}

export function isComplete(tournament) {
  const { done, total } = progress(tournament);
  return total > 0 && done === total;
}

/** Final podium. Knockout formats read the bracket, round robin reads the table. */
export function podium(tournament) {
  const rounds = knockoutRounds(tournament);
  if (rounds.length) {
    const final = rounds[rounds.length - 1].matches[0];
    const third = thirdPlaceMatch(tournament);
    if (!final || !final.winnerId) return [];
    const result = [
      { place: 1, playerId: final.winnerId },
      { place: 2, playerId: final.loserId },
    ];
    if (third && third.winnerId) {
      result.push({ place: 3, playerId: third.winnerId });
      if (third.loserId) result.push({ place: 4, playerId: third.loserId });
    }
    return result.filter((row) => row.playerId);
  }
  const group = tournament.groups[0];
  if (!group || !groupComplete(tournament, group.id)) return [];
  return standings(tournament, group.id)
    .slice(0, 4)
    .map((row, index) => ({ place: index + 1, playerId: row.playerId }));
}

export function upcomingMatches(tournament, limit = Infinity) {
  return tournament.matches
    .filter((m) => !m.winnerId && isPlayable(m))
    .sort((a, b) => (a.stage === b.stage ? a.round - b.round || a.order - b.order : a.stage === "group" ? -1 : 1))
    .slice(0, limit);
}
