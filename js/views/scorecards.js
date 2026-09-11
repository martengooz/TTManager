/*
 * Blank scorecards for the umpires: one per match, printed before a round and
 * handed back to the organiser afterwards with the result written on it.
 */
import * as model from "../model.js";
import { html, raw, esc, formatDate } from "../util.js";
import { t } from "../i18n.js";
import { state, rerenderView } from "../app.js";
import { svg as qrSvg } from "../qr.js";

/* One match to a sheet: a card is handed to an umpire at a table, so two
   matches on one page would have to be cut apart before they were useful. */
const options = {
  scope: "ready", // ready = both players known and no result yet
};

const SCOPES = [
  { id: "ready", label: "Ready to play" },
  { id: "todo", label: "Still to play" },
  { id: "all", label: "All matches" },
];

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

const SET_ROWS = 7;

/* One byte of tournament, two of match: the smallest payload that says which
   match a sheet belongs to, which keeps the code at version 1 and its modules
   large enough to read from a photograph. */
function codeFor(tour, match) {
  const tournamentNo = Math.max(1, Math.min(255, tour.no || 1));
  const matchNo = Math.max(0, Math.min(65535, match.no || 0));
  return [tournamentNo, (matchNo >> 8) & 0xff, matchNo & 0xff];
}

function card(tour, match) {
  const sets = Array.from({ length: Math.max(tour.settings.bestOf, SET_ROWS) }, (_, i) => i + 1);
  const side = (n) => {
    const playerId = n === 1 ? match.p1 : match.p2;
    const player = model.playerById(tour, playerId);
    const name = playerId ? model.playerName(tour, playerId) : sideName(tour, match, n);
    return `<div class="scard__player">
      <span class="scard__key">${n === 1 ? "A" : "B"}</span>
      <span class="scard__name${playerId ? "" : " scard__name--blank"}">${esc(name)}</span>
      <span class="scard__club">${esc(player ? player.club : "")}</span>
    </div>`;
  };

  return html`<article class="scard">
    <span class="scard__anchor scard__anchor--tl"></span>
    <span class="scard__anchor scard__anchor--tr"></span>
    <span class="scard__anchor scard__anchor--bl"></span>
    <span class="scard__anchor scard__anchor--br"></span>

    <header class="scard__head">
      <div class="scard__event">
        <b>${tour.name}</b>
        <span>${raw([formatDate(tour.date), tour.venue].filter(Boolean).map(esc).join(" · "))}</span>
        <span class="scard__meta">
          ${t("Match {n}", { n: match.no || "—" })} · ${model.matchLabel(tour, match)} ·
          ${t("Best of {n} to {points}", { n: tour.settings.bestOf, points: tour.settings.pointsPerSet })}
        </span>
      </div>
      <div class="scard__ident">
        ${raw(qrSvg(codeFor(tour, match), { size: "24mm", label: `T${tour.no || 1} M${match.no || 0}` }))}
        <span class="scard__code">T${tour.no || 1}·M${match.no || 0}</span>
      </div>
      <div class="scard__table">
        <span>${t("Table")}</span>
        <span class="scard__write"></span>
      </div>
    </header>

    <div class="scard__players">
      ${raw(side(1))}
      ${raw(side(2))}
    </div>

    <table class="scard__sets">
      <thead>
        <tr>
          <th scope="col">A</th>
          <th scope="col" class="scard__setcol">${t("Set")}</th>
          <th scope="col">B</th>
        </tr>
      </thead>
      <tbody>
        ${sets.map(
          (n) => `<tr><td class="scard__box"></td><th scope="row" class="scard__setcol">${n}</th><td class="scard__box"></td></tr>`
        )}
        <tr class="scard__won">
          <td class="scard__box scard__box--total"></td>
          <th scope="row" class="scard__setcol">${t("Sets won")}</th>
          <td class="scard__box scard__box--total"></td>
        </tr>
      </tbody>
    </table>

    <div class="scard__sign">
      <label class="scard__winner">
        <span>${t("Winner")}</span>
        <span class="scard__ticks"><i class="scard__tick"></i>A <i class="scard__tick"></i>B</span>
      </label>
      <label><span>${t("Winner's signature")}</span><span class="scard__write"></span></label>
      <label><span>${t("Umpire & signature")}</span><span class="scard__write"></span></label>
    </div>

    <p class="scard__foot">${t("Hand this to the organiser after the match.")}</p>
  </article>`;
}

/** The one match named in the route, if there is one. */
function single(tour) {
  if (!state.arg) return null;
  const wanted = Number(state.arg);
  return tour.matches.find((match) => match.no === wanted) || null;
}

export function render(tour) {
  if (tour.matches.some((m) => m.status !== "bye" && !m.no)) model.numberMatches(tour);

  const one = single(tour);
  if (one) {
    return html`<div class="printbar no-print">
        <a class="btn btn--ghost" href="#/t/${tour.id}/matches">← ${t("Back")}</a>
        <span class="printbar__one">
          ${t("Match {n}", { n: one.no })} · ${sideName(tour, one, 1)} ${t("v")} ${sideName(tour, one, 2)}
        </span>
        <a class="btn btn--ghost btn--small" href="#/t/${tour.id}/scorecards">${t("All scorecards")}</a>
        <button class="btn btn--primary" data-action="do-print">${t("Print / Save as PDF")}</button>
      </div>
      <div class="scards">${raw(card(tour, one))}</div>`;
  }

  const matches = wanted(tour);

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
    <div class="scards">
      ${matches.map((match) => raw(card(tour, match)))}
    </div>`;
}

/* Arriving from the printer button on a match means print this one now. */
let printed = null;

/*
 * The card is drawn at its real size in millimetres, which is wider than a
 * phone. On screen the preview is zoomed down to fit; zoom rather than a
 * transform, so the page height follows. The zoom is applied through a custom
 * property that only a screen media query reads, so printing never sees it.
 */
function fitPreview() {
  const list = document.querySelector(".scards");
  if (!list) return;
  list.style.removeProperty("--preview-zoom");
  const card = list.querySelector(".scard");
  if (!card) return;
  const available = list.clientWidth;
  const natural = card.getBoundingClientRect().width;
  if (natural > available && available > 0) {
    list.style.setProperty("--preview-zoom", String(Math.max(0.25, available / natural)));
  }
}

let watchingResize = false;

export function afterRender(tour) {
  fitPreview();
  if (!watchingResize) {
    watchingResize = true;
    window.addEventListener("resize", fitPreview);
  }

  if (!state.arg) {
    printed = null;
    return;
  }
  const key = `${tour.id}/${state.arg}`;
  if (printed === key) return;
  printed = key;
  setTimeout(() => window.print(), 150);
}

export function handle(action, target) {
  if (action === "card-scope") {
    options.scope = target.dataset.value;
    rerenderView();
  }
  if (action === "do-print") window.print();
}
