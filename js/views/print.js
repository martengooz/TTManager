/* Print screen: the whole tournament as one printable document. */
import * as model from "../model.js";
import { html, raw, esc, formatDate } from "../util.js";
import { t, locale } from "../i18n.js";
import { standingsTable, crossTable, bracketHTML, podiumHTML, scheduleTable } from "../components.js";
import { rerenderView } from "../app.js";

const options = {
  players: true,
  tables: true,
  grids: true,
  matches: true,
  bracket: true,
  schedule: false,
};

const OPTION_LABELS = {
  players: "Player list",
  tables: "Group tables",
  grids: "Results grids",
  matches: "Match cards with scores",
  schedule: "Match list (compact)",
  bracket: "Knockout bracket",
};
// The labels above are translation keys; t() turns them into display text.

export function render(tour) {
  const p = model.progress(tour);
  const places = model.podium(tour);
  const showBracket = options.bracket && tour.matches.some((m) => m.stage === "ko");

  const controls = html`<div class="printbar no-print">
    <a class="btn btn--ghost" href="#/t/${tour.id}/matches">← ${t("Back")}</a>
    <div class="printbar__opts">
      ${Object.entries(OPTION_LABELS).map(
        ([key, label]) => html`<label class="check check--inline">
          <input type="checkbox" data-action="toggle-print" data-key="${key}" ${raw(options[key] ? "checked" : "")} />
          <span>${t(label)}</span>
        </label>`
      )}
    </div>
    <button class="btn btn--primary" data-action="do-print">${t("Print / Save as PDF")}</button>
  </div>`;

  const groupSections = tour.groups.map((group) => {
    const matches = tour.matches
      .filter((m) => m.stage === "group" && m.groupId === group.id)
      .sort((a, b) => a.round - b.round || a.order - b.order);
    return html`<section class="sheet__section">
      <h2>${model.groupName(group)}</h2>
      ${raw(
        options.tables
          ? standingsTable(tour, group, {
              qualifiers: tour.format === "groups_ko" ? tour.settings.advancePerGroup : 0,
              heading: "Table",
            })
          : ""
      )}
      ${raw(options.grids && group.playerIds.length > 1 ? crossTable(tour, group, { heading: "Results grid" }) : "")}
      ${raw(options.matches ? `<h3 class="table-title">${esc(t("Matches"))}</h3>` : "")}
      ${raw(
        options.matches
          ? `<div class="matchgrid matchgrid--print">${matches.map((m) => printMatch(tour, m)).join("")}</div>`
          : ""
      )}
    </section>`;
  });

  const koRounds = model.knockoutRounds(tour);
  const koMatches = options.matches && koRounds.length
    ? html`<section class="sheet__section">
        <h2>${t("Knockout results")}</h2>
        ${koRounds.map(
          (round) => html`<div class="printround">
            <h3>${round.name}</h3>
            <div class="matchgrid matchgrid--print">${round.matches.map((m) => raw(printMatch(tour, m)))}</div>
          </div>`
        )}
        ${raw(
          model.thirdPlaceMatch(tour)
            ? `<div class="printround"><h3>${esc(t("Third place"))}</h3><div class="matchgrid matchgrid--print">${printMatch(tour, model.thirdPlaceMatch(tour))}</div></div>`
            : ""
        )}
      </section>`
    : "";

  return html`${raw(controls)}
    <article class="sheet" id="print-sheet">
      <header class="sheet__head">
        <div>
          <h1>${tour.name}</h1>
          <p class="sheet__sub">
            ${raw([formatDate(tour.date), tour.venue, t(model.FORMATS[tour.format].label)].filter(Boolean).map(esc).join(" · "))}
          </p>
        </div>
        <div class="sheet__facts">
          <span>${t("{n} players", { n: tour.players.length })}</span>
          <span>${t("{done}/{total} matches played", { done: p.done, total: p.total })}</span>
          <span>${t("Best of {n} to {points}", { n: tour.settings.bestOf, points: tour.settings.pointsPerSet })}</span>
        </div>
      </header>

      ${raw(
        places.length
          ? `<section class="sheet__section sheet__section--podium"><h2>${esc(t("Final placings"))}</h2>${podiumHTML(tour)}</section>`
          : ""
      )}

      ${raw(
        options.players
          ? html`<section class="sheet__section">
              <h2>${t("Players")}</h2>
              <ol class="sheet__players">
                ${tour.players.map(
                  (player) => html`<li>
                    <span>${player.name}</span>
                    ${raw(player.club ? `<span class="muted">${esc(player.club)}</span>` : "")}
                    ${raw(groupOf(tour, player.id) ? `<span class="muted">${esc(groupOf(tour, player.id))}</span>` : "")}
                  </li>`
                )}
              </ol>
            </section>`
          : ""
      )}

      ${groupSections}
      ${raw(koMatches)}

      ${raw(
        showBracket
          ? `<section class="sheet__section sheet__section--bracket"><h2>${esc(t("Knockout bracket"))}</h2><div class="bracket-scroll">${bracketHTML(tour, { interactive: false })}</div></section>`
          : ""
      )}

      ${raw(
        options.schedule
          ? `<section class="sheet__section"><h2>${esc(t("All matches"))}</h2>${scheduleTable(tour, tour.matches.filter((m) => m.status !== "bye"))}</section>`
          : ""
      )}

      <footer class="sheet__foot">
        <span>${tour.name}</span>
        <span>${t("Printed {when}", { when: new Date().toLocaleString(locale()) })}</span>
        <span>TT Manager</span>
      </footer>
    </article>`;
}

function groupOf(tour, playerId) {
  const group = tour.groups.find((g) => g.playerIds.includes(playerId));
  return group ? model.groupName(group) : "";
}

function printMatch(tour, match) {
  const [a, b] = model.setWinsFromSets(match.sets);
  const won = (playerId) => (match.winnerId === playerId ? " is-winner" : match.winnerId ? " is-loser" : "");
  const score = (side) => {
    if (match.status === "played") return side === 1 ? a : b;
    if (match.status === "walkover") return (side === 1 ? match.p1 : match.p2) === match.winnerId ? "w/o" : "–";
    if (match.status === "bye") return side === 1 ? (match.p1 ? "—" : "") : match.p2 ? "—" : "";
    return "";
  };
  const name = (side) => {
    const playerId = side === 1 ? match.p1 : match.p2;
    if (playerId) return esc(model.playerName(tour, playerId));
    return esc(match.stage === "ko" ? model.sourceLabel(tour, side === 1 ? match.p1Source : match.p2Source) : "—");
  };
  return `<article class="pmatch${match.winnerId ? " pmatch--done" : ""}">
    <div class="pmatch__side${won(match.p1)}"><span>${name(1)}</span><b>${score(1)}</b></div>
    <div class="pmatch__side${won(match.p2)}"><span>${name(2)}</span><b>${score(2)}</b></div>
    <div class="pmatch__sets">${esc(model.setsLine(match)) || "&nbsp;"}</div>
  </article>`;
}

export function handle(action, target) {
  if (action === "toggle-print") {
    options[target.dataset.key] = target.checked;
    rerenderView();
  }
  if (action === "do-print") window.print();
}
