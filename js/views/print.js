/* Print screen: the whole tournament as one printable document. */
import * as model from "../model.js";
import { html, raw, esc, formatDate } from "../util.js";
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

export function render(t) {
  const p = model.progress(t);
  const places = model.podium(t);
  const showBracket = options.bracket && t.matches.some((m) => m.stage === "ko");

  const controls = html`<div class="printbar no-print">
    <a class="btn btn--ghost" href="#/t/${t.id}/matches">← Back</a>
    <div class="printbar__opts">
      ${Object.entries(OPTION_LABELS).map(
        ([key, label]) => html`<label class="check check--inline">
          <input type="checkbox" data-action="toggle-print" data-key="${key}" ${raw(options[key] ? "checked" : "")} />
          <span>${label}</span>
        </label>`
      )}
    </div>
    <button class="btn btn--primary" data-action="do-print">Print / Save as PDF</button>
  </div>`;

  const groupSections = t.groups.map((group) => {
    const matches = t.matches
      .filter((m) => m.stage === "group" && m.groupId === group.id)
      .sort((a, b) => a.round - b.round || a.order - b.order);
    return html`<section class="sheet__section">
      <h2>${group.name}</h2>
      ${raw(
        options.tables
          ? standingsTable(t, group, {
              qualifiers: t.format === "groups_ko" ? t.settings.advancePerGroup : 0,
              heading: "Table",
            })
          : ""
      )}
      ${raw(options.grids && group.playerIds.length > 1 ? crossTable(t, group, { heading: "Results grid" }) : "")}
      ${raw(options.matches ? '<h3 class="table-title">Matches</h3>' : "")}
      ${raw(
        options.matches
          ? `<div class="matchgrid matchgrid--print">${matches.map((m) => printMatch(t, m)).join("")}</div>`
          : ""
      )}
    </section>`;
  });

  const koRounds = model.knockoutRounds(t);
  const koMatches = options.matches && koRounds.length
    ? html`<section class="sheet__section">
        <h2>Knockout results</h2>
        ${koRounds.map(
          (round) => html`<div class="printround">
            <h3>${round.name}</h3>
            <div class="matchgrid matchgrid--print">${round.matches.map((m) => raw(printMatch(t, m)))}</div>
          </div>`
        )}
        ${raw(
          model.thirdPlaceMatch(t)
            ? `<div class="printround"><h3>Third place</h3><div class="matchgrid matchgrid--print">${printMatch(t, model.thirdPlaceMatch(t))}</div></div>`
            : ""
        )}
      </section>`
    : "";

  return html`${raw(controls)}
    <article class="sheet" id="print-sheet">
      <header class="sheet__head">
        <div>
          <h1>${t.name}</h1>
          <p class="sheet__sub">
            ${raw([formatDate(t.date), t.venue, model.FORMATS[t.format].label].filter(Boolean).map(esc).join(" · "))}
          </p>
        </div>
        <div class="sheet__facts">
          <span><b>${t.players.length}</b> players</span>
          <span><b>${p.done}/${p.total}</b> matches played</span>
          <span>Best of <b>${t.settings.bestOf}</b> to <b>${t.settings.pointsPerSet}</b></span>
        </div>
      </header>

      ${raw(
        places.length
          ? `<section class="sheet__section sheet__section--podium"><h2>Final placings</h2>${podiumHTML(t)}</section>`
          : ""
      )}

      ${raw(
        options.players
          ? html`<section class="sheet__section">
              <h2>Players</h2>
              <ol class="sheet__players">
                ${t.players.map(
                  (player) => html`<li>
                    <span>${player.name}</span>
                    ${raw(player.club ? `<span class="muted">${esc(player.club)}</span>` : "")}
                    ${raw(groupOf(t, player.id) ? `<span class="muted">${esc(groupOf(t, player.id))}</span>` : "")}
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
          ? `<section class="sheet__section sheet__section--bracket"><h2>Knockout bracket</h2><div class="bracket-scroll">${bracketHTML(t, { interactive: false })}</div></section>`
          : ""
      )}

      ${raw(
        options.schedule
          ? `<section class="sheet__section"><h2>All matches</h2>${scheduleTable(t, t.matches.filter((m) => m.status !== "bye"))}</section>`
          : ""
      )}

      <footer class="sheet__foot">
        <span>${t.name}</span>
        <span>Printed ${new Date().toLocaleString()}</span>
        <span>TT Manager</span>
      </footer>
    </article>`;
}

function groupOf(t, playerId) {
  const group = t.groups.find((g) => g.playerIds.includes(playerId));
  return group ? group.name : "";
}

function printMatch(t, match) {
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
    if (playerId) return esc(model.playerName(t, playerId));
    return esc(match.stage === "ko" ? model.sourceLabel(t, side === 1 ? match.p1Source : match.p2Source) : "—");
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
