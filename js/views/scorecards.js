/*
 * Blank scorecards for the umpires: one per match, printed before a round and
 * handed back to the organiser afterwards with the result written on it.
 */
import * as model from "../model.js";
import { html, raw, esc, formatDate } from "../util.js";
import { t } from "../i18n.js";
import { rerenderView } from "../app.js";

const options = {
  scope: "ready", // ready = both players known and no result yet
  perPage: 2,
};

const SCOPES = [
  { id: "ready", label: "Ready to play" },
  { id: "todo", label: "Still to play" },
  { id: "all", label: "All matches" },
];

const PER_PAGE = [1, 2, 4];

/* Draw order is also the order the matches are numbered in, so the cards come
   off the printer in the order the organiser sees them on screen. */
function wanted(tour) {
  return tour.matches.filter((match) => {
    if (match.status === "bye") return false;
    if (options.scope === "all") return true;
    if (match.winnerId) return false;
    return options.scope === "todo" || model.isPlayable(match);
  });
}

/** Written on the card when the player is known, left blank when not. */
function sideName(tour, match, side) {
  const playerId = side === 1 ? match.p1 : match.p2;
  if (playerId) return model.playerName(tour, playerId);
  const source = side === 1 ? match.p1Source : match.p2Source;
  return match.stage === "ko" ? model.sourceLabel(tour, source) : "";
}

function club(tour, match, side) {
  const player = model.playerById(tour, side === 1 ? match.p1 : match.p2);
  return player ? player.club : "";
}

/* A full page card lists the sets down the page, with room to write, and always
   offers at least seven of them. The smaller sizes keep the compact grid. */
const TALL_SET_ROWS = 7;

function card(tour, match, number) {
  const tall = options.perPage === 1;
  const setCount = tall ? Math.max(tour.settings.bestOf, TALL_SET_ROWS) : tour.settings.bestOf;
  const sets = Array.from({ length: setCount }, (_, i) => i + 1);
  const label = (side) => ((side === 1 ? match.p1 : match.p2) ? sideName(tour, match, side) : t("Player {n}", { n: side }));
  const nameCell = (side) => {
    const name = sideName(tour, match, side);
    const known = !!(side === 1 ? match.p1 : match.p2);
    return `<div class="scard__player">
      <span class="scard__name${known ? "" : " scard__name--blank"}">${esc(name)}</span>
      <span class="scard__club">${esc(club(tour, match, side))}</span>
    </div>`;
  };
  // Sets across the page: a column per set, a row per player.
  const wideRow = (side) => `<tr>
    <th scope="row">${esc(label(side))}</th>
    ${sets.map(() => '<td class="scard__box"></td>').join("")}
    <td class="scard__box scard__box--total"></td>
  </tr>`;

  const wideTable = `<table class="scard__sets">
    <thead>
      <tr>
        <th scope="col">${esc(t("Set"))}</th>
        ${sets.map((n) => `<th scope="col">${n}</th>`).join("")}
        <th scope="col">${esc(t("Sets won"))}</th>
      </tr>
    </thead>
    <tbody>${wideRow(1)}${wideRow(2)}</tbody>
  </table>`;

  // Sets down the page: a row per set, a column per player.
  const tallTable = `<table class="scard__sets scard__sets--rows">
    <thead>
      <tr>
        <th scope="col">${esc(t("Set"))}</th>
        <th scope="col">${esc(label(1))}</th>
        <th scope="col">${esc(label(2))}</th>
      </tr>
    </thead>
    <tbody>
      ${sets
        .map((n) => `<tr><th scope="row">${n}</th><td class="scard__box"></td><td class="scard__box"></td></tr>`)
        .join("")}
      <tr class="scard__won">
        <th scope="row">${esc(t("Sets won"))}</th>
        <td class="scard__box scard__box--total"></td>
        <td class="scard__box scard__box--total"></td>
      </tr>
    </tbody>
  </table>`;

  return html`<article class="scard${raw(tall ? " scard--tall" : "")}">
    <header class="scard__head">
      <div class="scard__event">
        <b>${tour.name}</b>
        <span>${raw([formatDate(tour.date), tour.venue].filter(Boolean).map(esc).join(" · "))}</span>
      </div>
      <div class="scard__table">
        <span>${t("Table")}</span>
        <span class="scard__write"></span>
      </div>
    </header>

    <p class="scard__meta">
      ${t("Match {n}", { n: number })} · ${model.matchLabel(tour, match)} ·
      ${t("Best of {n} to {points}", { n: tour.settings.bestOf, points: tour.settings.pointsPerSet })}
    </p>

    <div class="scard__players">
      ${raw(nameCell(1))}
      <span class="scard__v">${t("v")}</span>
      ${raw(nameCell(2))}
    </div>

    ${raw(tall ? tallTable : wideTable)}

    <div class="scard__sign">
      <label><span>${t("Winner")}</span><span class="scard__write"></span></label>
      <label><span>${t("Winner's signature")}</span><span class="scard__write"></span></label>
      <label><span>${t("Umpire")}</span><span class="scard__write"></span></label>
      <label><span>${t("Umpire's signature")}</span><span class="scard__write"></span></label>
    </div>

    <p class="scard__foot">${t("Hand this to the organiser after the match.")}</p>
  </article>`;
}

export function render(tour) {
  const matches = wanted(tour);
  const numbering = new Map();
  tour.matches.filter((m) => m.status !== "bye").forEach((m, index) => numbering.set(m.id, index + 1));

  const controls = html`<div class="printbar no-print">
    <a class="btn btn--ghost" href="#/t/${tour.id}/matches">← ${t("Back")}</a>
    <div class="printbar__opts">
      <span class="printbar__group">
        <span class="printbar__label">${t("Matches to print")}</span>
        ${SCOPES.map(
          (scope) => html`<button
            class="chip${raw(options.scope === scope.id ? " is-active" : "")}"
            data-action="card-scope"
            data-value="${scope.id}"
          >
            ${t(scope.label)}
          </button>`
        )}
      </span>
      <span class="printbar__group">
        <span class="printbar__label">${t("Cards per page")}</span>
        ${PER_PAGE.map(
          (n) => html`<button
            class="chip${raw(options.perPage === n ? " is-active" : "")}"
            data-action="card-per-page"
            data-value="${n}"
          >
            ${n}
          </button>`
        )}
      </span>
    </div>
    <button class="btn btn--primary" data-action="do-print" ${raw(matches.length ? "" : "disabled")}>
      ${t("Print / Save as PDF")}
    </button>
  </div>`;

  if (!matches.length) {
    return html`${raw(controls)}
      <section class="card empty no-print">
        <h2>${t("Nothing to print")}</h2>
        <p class="muted">
          ${tour.matches.length
            ? t("No match fits that choice — every one either has a result or is waiting on an earlier round.")
            : t("Draw the tournament first and the scorecards appear here.")}
        </p>
        <a class="btn btn--primary" href="#/t/${tour.id}/${tour.matches.length ? "matches" : "setup"}">
          ${tour.matches.length ? t("Go to matches") : t("Go to setup")}
        </a>
      </section>`;
  }

  return html`${raw(controls)}
    <div class="scards" data-per-page="${options.perPage}">
      ${matches.map((match) => raw(card(tour, match, numbering.get(match.id))))}
    </div>`;
}

export function handle(action, target) {
  if (action === "card-scope") {
    options.scope = target.dataset.value;
    rerenderView();
  }
  if (action === "card-per-page") {
    options.perPage = Number(target.dataset.value);
    rerenderView();
  }
  if (action === "do-print") window.print();
}
