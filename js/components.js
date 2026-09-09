/* Reusable render helpers shared by the screens and the printable sheet. */
import { html, raw, esc } from "./util.js";
import { t } from "./i18n.js";
import {
  standings,
  playerName,
  groupName,
  matchLabel,
  setWinsFromSets,
  setsLine,
  knockoutRounds,
  thirdPlaceMatch,
  sourceLabel,
  podium,
  groupComplete,
  ordinal,
} from "./model.js";

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function sideName(tournament, match, side) {
  const playerId = side === 1 ? match.p1 : match.p2;
  if (playerId) return playerName(tournament, playerId);
  const source = side === 1 ? match.p1Source : match.p2Source;
  if (match.stage === "ko") return sourceLabel(tournament, source);
  return "—";
}

export function matchTitle(tournament, match) {
  return matchLabel(tournament, match);
}

/** One match card. The whole card is the tap target - no separate button. */
export function matchCard(tournament, match, { interactive = true, number = null, showStage = true } = {}) {
  const [setsA, setsB] = setWinsFromSets(match.sets);
  const played = match.status === "played";
  const decided = !!match.winnerId;
  const walkover = match.status === "walkover";
  const score = (playerId, sets) => (played ? sets : walkover && match.winnerId === playerId ? "w/o" : "");
  const winnerClass = (playerId) => (decided && match.winnerId === playerId ? " is-winner" : decided ? " is-loser" : "");

  return html`<article
    class="match${raw(decided ? " match--done" : "")}${raw(match.status === "bye" ? " match--bye" : "")}"
    data-match="${match.id}"
    ${raw(interactive ? 'role="button" tabindex="0"' : "")}
  >
    <header class="match__meta">
      <span class="match__no">${number != null ? `#${number}` : ""}</span>
      ${raw(showStage ? `<span class="match__stage">${esc(matchTitle(tournament, match))}</span>` : "")}
      ${raw(match.status === "bye" ? `<span class="tag">${esc(t("bye"))}</span>` : "")}
      ${raw(walkover ? `<span class="tag">${esc(t("w/o"))}</span>` : "")}
      ${raw(interactive ? `<span class="match__cta">${esc(decided ? t("Edit") : t("Enter score"))}</span>` : "")}
    </header>
    <div class="match__players">
      <div class="side${raw(winnerClass(match.p1))}">
        <span class="side__name">${sideName(tournament, match, 1)}</span>
        <span class="side__score">${score(match.p1, setsA)}</span>
      </div>
      <div class="side${raw(winnerClass(match.p2))}">
        <span class="side__name">${sideName(tournament, match, 2)}</span>
        <span class="side__score">${score(match.p2, setsB)}</span>
      </div>
    </div>
    ${raw(match.sets.length ? `<div class="match__sets">${esc(setsLine(match))}</div>` : "")}
  </article>`;
}

export function standingsTable(tournament, group, { qualifiers = 0, heading = null } = {}) {
  const rows = standings(tournament, group.id);
  const complete = groupComplete(tournament, group.id);
  return html`<h3 class="table-title">
      ${heading ? t(heading) : groupName(group)}
      ${raw(complete ? `<span class="tag tag--ok">${esc(t("complete"))}</span>` : "")}
    </h3>
    <div class="table-wrap">
    <table class="table table--standings">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${t("Player")}</th>
          <th class="num" title="${t("Matches played")}">${t("P")}</th>
          <th class="num" title="${t("Wins")}">${t("W")}</th>
          <th class="num" title="${t("Losses")}">${t("L")}</th>
          <th class="num" title="${t("Sets won-lost")}">${t("Sets")}</th>
          <th class="num" title="${t("Points won-lost")}">${t("Points")}</th>
          <th class="num" title="${t("Table points: 2 for a win, 1 for a loss")}">${t("Pts")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const player = tournament.players.find((p) => p.id === row.playerId);
          const qualifies = qualifiers > 0 && row.rank <= qualifiers;
          return html`<tr class="${raw(qualifies ? "is-qualified" : "")}">
            <td class="num">${row.rank}</td>
            <td>
              <span class="player-name">${player ? player.name : "—"}</span>
              ${raw(player && player.club ? `<span class="player-club">${esc(player.club)}</span>` : "")}
              ${raw(qualifies ? `<span class="tag tag--q">${esc(t("Q"))}</span>` : "")}
            </td>
            <td class="num">${row.played}</td>
            <td class="num">${row.wins}</td>
            <td class="num">${row.losses}</td>
            <td class="num">${row.setsWon}–${row.setsLost}</td>
            <td class="num">${row.pointsWon}–${row.pointsLost}</td>
            <td class="num strong">${row.points}</td>
          </tr>`;
        })}
        ${raw(rows.length ? "" : `<tr><td colspan="8" class="muted">${esc(t("No players in this group yet."))}</td></tr>`)}
      </tbody>
    </table>
  </div>`;
}

/** Cross table: every player against every other player in the group. */
export function crossTable(tournament, group, { heading = null } = {}) {
  const ids = standings(tournament, group.id).map((r) => r.playerId);
  const matches = tournament.matches.filter((m) => m.stage === "group" && m.groupId === group.id);
  const cell = (rowId, colId) => {
    if (rowId === colId) return '<td class="cross-diag"></td>';
    const match = matches.find(
      (m) => (m.p1 === rowId && m.p2 === colId) || (m.p1 === colId && m.p2 === rowId)
    );
    if (!match || !match.winnerId) return '<td class="num muted">·</td>';
    if (match.status === "walkover") return `<td class="num">${match.winnerId === rowId ? esc(t("w/o")) : "–"}</td>`;
    const [a, b] = setWinsFromSets(match.sets);
    const own = match.p1 === rowId ? a : b;
    const other = match.p1 === rowId ? b : a;
    return `<td class="num ${own > other ? "cross-win" : "cross-loss"}">${own}–${other}</td>`;
  };
  return html`<h3 class="table-title">${heading ? t(heading) : t("{group} — results grid", { group: groupName(group) })}</h3>
    <div class="table-wrap">
    <table class="table table--cross">
      <thead>
        <tr>
          <th>${t("Player")}</th>
          ${ids.map((id, i) => `<th class="num">${i + 1}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${ids.map(
          (rowId, i) => html`<tr>
            <th class="cross-player">${i + 1}. ${playerName(tournament, rowId)}</th>
            ${ids.map((colId) => raw(cell(rowId, colId)))}
          </tr>`
        )}
      </tbody>
    </table>
  </div>`;
}

export function bracketHTML(tournament, { interactive = true } = {}) {
  const rounds = knockoutRounds(tournament);
  if (!rounds.length) return "";
  const third = thirdPlaceMatch(tournament);

  const node = (match) => {
    const [a, b] = setWinsFromSets(match.sets);
    const score = (side) => {
      if (match.status === "played") return side === 1 ? a : b;
      if (match.status === "walkover") return (side === 1 ? match.p1 : match.p2) === match.winnerId ? "w/o" : "";
      return "";
    };
    const cls = (playerId) => (match.winnerId ? (match.winnerId === playerId ? " is-winner" : " is-loser") : "");
    return html`<div class="bnode${raw(match.status === "bye" ? " bnode--bye" : "")}" data-match="${match.id}" ${raw(interactive ? 'tabindex="0" role="button"' : "")}>
      <div class="bnode__side${raw(cls(match.p1))}">
        <span>${sideName(tournament, match, 1)}</span><b>${score(1)}</b>
      </div>
      <div class="bnode__side${raw(cls(match.p2))}">
        <span>${sideName(tournament, match, 2)}</span><b>${score(2)}</b>
      </div>
      ${raw(match.sets.length ? `<div class="bnode__sets">${esc(setsLine(match))}</div>` : "")}
    </div>`;
  };

  return html`<div class="bracket">
    ${rounds.map(
      (round) => html`<div class="bracket__round">
        <h4 class="bracket__title">${round.name}</h4>
        <div class="bracket__matches">${round.matches.map((m) => raw(node(m)))}</div>
      </div>`
    )}
    ${raw(
      third
        ? html`<div class="bracket__round bracket__round--third">
            <h4 class="bracket__title">${t("Third place")}</h4>
            <div class="bracket__matches">${raw(node(third))}</div>
          </div>`
        : ""
    )}
  </div>`;
}

export function podiumHTML(tournament) {
  const places = podium(tournament);
  if (!places.length) return "";
  return html`<ol class="podium">
    ${places.map(
      (place) => html`<li class="podium__row">
        <span class="podium__place">${raw(MEDALS[place.place] || "")} ${ordinal(place.place)}</span>
        <span class="podium__name">${playerName(tournament, place.playerId)}</span>
      </li>`
    )}
  </ol>`;
}

export function scheduleTable(tournament, matches) {
  return html`<div class="table-wrap">
    <table class="table table--schedule">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${t("Stage")}</th>
          <th>${t("Match")}</th>
          <th class="num">${t("Sets")}</th>
          <th>${t("Set scores")}</th>
        </tr>
      </thead>
      <tbody>
        ${matches.map((match, index) => {
          const [a, b] = setWinsFromSets(match.sets);
          const result =
            match.status === "played" ? `${a}–${b}` : match.status === "walkover" ? t("w/o") : match.status === "bye" ? t("bye") : "—";
          return html`<tr>
            <td class="num">${index + 1}</td>
            <td>${matchTitle(tournament, match)}</td>
            <td>
              <span class="${raw(match.winnerId === match.p1 ? "strong" : "")}">${sideName(tournament, match, 1)}</span>
              <span class="muted"> ${t("v")} </span>
              <span class="${raw(match.winnerId === match.p2 ? "strong" : "")}">${sideName(tournament, match, 2)}</span>
            </td>
            <td class="num">${result}</td>
            <td class="sets-cell">${setsLine(match) || "—"}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}
