/* Bracket screen: the knockout draw. Click a match to enter its score. */
import * as model from "../model.js";
import { html, raw } from "../util.js";
import { bracketHTML, podiumHTML } from "../components.js";

export function render(t) {
  const rounds = model.knockoutRounds(t);
  if (!rounds.length) {
    return html`<section class="card empty">
      <h2>No knockout stage</h2>
      <p class="muted">This tournament is decided on the group table. Switch the format on the setup screen to add a bracket.</p>
      <a class="btn btn--primary" href="#/t/${t.id}/standings">See standings</a>
    </section>`;
  }
  const waiting = t.groups.length && t.groups.some((g) => !model.groupComplete(t, g.id));
  const places = model.podium(t);

  return html`${raw(
      waiting
        ? '<p class="hint">Bracket places fill in automatically as each group finishes.</p>'
        : ""
    )}
    ${raw(places.length ? `<section class="card card--podium"><h2 class="card__title">Final placings</h2>${podiumHTML(t)}</section>` : "")}
    <section class="card card--bracket">
      <div class="bracket-scroll">${raw(bracketHTML(t))}</div>
      <p class="hint">Tap any match to record or edit its score.</p>
    </section>`;
}
