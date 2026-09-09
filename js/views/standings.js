/* Standings screen: group tables, results grids and the final placings. */
import * as model from "../model.js";
import { html, raw } from "../util.js";
import { standingsTable, crossTable, podiumHTML } from "../components.js";

export function render(t) {
  if (!t.groups.length) {
    return html`<section class="card empty">
      <h2>No group tables</h2>
      <p class="muted">
        ${t.matches.length
          ? "This is a straight knockout — see the bracket for who is still in."
          : "Draw the tournament first and the tables appear here."}
      </p>
      <a class="btn btn--primary" href="#/t/${t.id}/${t.matches.length ? "bracket" : "setup"}">
        ${t.matches.length ? "Open bracket" : "Go to setup"}
      </a>
    </section>`;
  }

  const qualifiers = t.format === "groups_ko" ? t.settings.advancePerGroup : 0;
  const places = model.podium(t);

  return html`${raw(
      places.length
        ? html`<section class="card card--podium">
            <h2 class="card__title">Final placings</h2>
            ${raw(podiumHTML(t))}
          </section>`
        : ""
    )}
    <div class="grid grid--tables">
      ${t.groups.map(
        (group) => html`<section class="card">
          ${raw(standingsTable(t, group, { qualifiers }))}
          ${raw(group.playerIds.length > 1 ? crossTable(t, group) : "")}
        </section>`
      )}
    </div>
    <p class="legend muted">
      Ranking: table points (2 for a win, 1 for a loss, 0 for a walkover loss), then the results between the tied
      players, then set ratio, then point ratio.
    </p>`;
}
