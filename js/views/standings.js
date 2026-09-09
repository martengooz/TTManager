/* Standings screen: group tables, results grids and the final placings. */
import * as model from "../model.js";
import { html, raw } from "../util.js";
import { t } from "../i18n.js";
import { standingsTable, crossTable, podiumHTML } from "../components.js";

export function render(tour) {
  if (!tour.groups.length) {
    return html`<section class="card empty">
      <h2>${t("No group tables")}</h2>
      <p class="muted">
        ${tour.matches.length
          ? t("This is a straight knockout — see the bracket for who is still in.")
          : t("Draw the tournament first and the tables appear here.")}
      </p>
      <a class="btn btn--primary" href="#/t/${tour.id}/${tour.matches.length ? "bracket" : "setup"}">
        ${tour.matches.length ? t("Open bracket") : t("Go to setup")}
      </a>
    </section>`;
  }

  const qualifiers = tour.format === "groups_ko" ? tour.settings.advancePerGroup : 0;
  const places = model.podium(tour);

  return html`${raw(
      places.length
        ? html`<section class="card card--podium">
            <h2 class="card__title">${t("Final placings")}</h2>
            ${raw(podiumHTML(tour))}
          </section>`
        : ""
    )}
    <div class="grid grid--tables">
      ${tour.groups.map(
        (group) => html`<section class="card">
          ${raw(standingsTable(tour, group, { qualifiers }))}
          ${raw(group.playerIds.length > 1 ? crossTable(tour, group) : "")}
        </section>`
      )}
    </div>
    <p class="legend muted">
      ${t("Ranking: table points (2 for a win, 1 for a loss, 0 for a walkover loss), then the results between the tied players, then set ratio, then point ratio.")}
    </p>`;
}
