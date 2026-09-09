/* Bracket screen: the knockout draw. Click a match to enter its score. */
import * as model from "../model.js";
import { html, raw, esc } from "../util.js";
import { t } from "../i18n.js";
import { bracketHTML, podiumHTML } from "../components.js";

export function render(tour) {
  const rounds = model.knockoutRounds(tour);
  if (!rounds.length) {
    return html`<section class="card empty">
      <h2>${t("No knockout stage")}</h2>
      <p class="muted">${t("This tournament is decided on the group table. Switch the format on the setup screen to add a bracket.")}</p>
      <a class="btn btn--primary" href="#/t/${tour.id}/standings">${t("See standings")}</a>
    </section>`;
  }
  const waiting = tour.groups.length && tour.groups.some((g) => !model.groupComplete(tour, g.id));
  const places = model.podium(tour);

  return html`${raw(
      waiting
        ? `<p class="hint">${esc(t("Bracket places fill in automatically as each group finishes."))}</p>`
        : ""
    )}
    ${raw(places.length ? `<section class="card card--podium"><h2 class="card__title">${esc(t("Final placings"))}</h2>${podiumHTML(tour)}</section>` : "")}
    <section class="card card--bracket">
      <div class="bracket-scroll">${raw(bracketHTML(tour))}</div>
      <p class="hint">${t("Tap any match to record or edit its score.")}</p>
    </section>`;
}
