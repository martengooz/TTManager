/* Matches screen: every match, filterable, with score entry. */
import * as model from "../model.js";
import { html, raw } from "../util.js";
import { matchCard } from "../components.js";
import { state, rerenderView } from "../app.js";

function visible(t, matches) {
  return matches.filter((match) => {
    if (match.status === "bye") return false;
    if (state.filter === "todo" && (match.winnerId || !model.isPlayable(match))) return false;
    if (state.filter === "done" && !match.winnerId) return false;
    return true;
  });
}

export function render(t) {
  if (!t.matches.length) {
    return html`<section class="card empty">
      <h2>Nothing drawn yet</h2>
      <p class="muted">Add your players on the setup screen and draw the tournament to get a schedule.</p>
      <a class="btn btn--primary" href="#/t/${t.id}/setup">Go to setup</a>
    </section>`;
  }

  const numbering = new Map();
  t.matches
    .filter((m) => m.status !== "bye")
    .forEach((m, index) => numbering.set(m.id, index + 1));

  const groupSections = t.groups
    .filter((group) => state.groupFilter === "all" || state.groupFilter === group.id)
    .map((group) => {
      const all = t.matches.filter((m) => m.stage === "group" && m.groupId === group.id).sort((a, b) => a.round - b.round || a.order - b.order);
      const shown = visible(t, all);
      const done = all.filter((m) => m.winnerId).length;
      return html`<section class="card">
        <h2 class="card__title">
          ${group.name}
          <span class="count">${done}/${all.length}</span>
        </h2>
        ${raw(
          shown.length
            ? `<div class="matchgrid">${shown.map((m) => matchCard(t, m, { number: numbering.get(m.id) })).join("")}</div>`
            : '<p class="muted">Nothing here with the current filter.</p>'
        )}
      </section>`;
    });

  const koRounds = model.knockoutRounds(t);
  const third = model.thirdPlaceMatch(t);
  const koSections =
    state.groupFilter === "all" && koRounds.length
      ? koRounds.map((round) => {
          const shown = visible(t, round.matches);
          return html`<section class="card">
            <h2 class="card__title">${round.name}</h2>
            ${raw(
              shown.length
                ? `<div class="matchgrid">${shown.map((m) => matchCard(t, m, { number: numbering.get(m.id) })).join("")}</div>`
                : '<p class="muted">Nothing here with the current filter.</p>'
            )}
          </section>`;
        })
      : [];

  if (third && state.groupFilter === "all" && visible(t, [third]).length) {
    koSections.push(html`<section class="card">
      <h2 class="card__title">Third place</h2>
      <div class="matchgrid">${raw(matchCard(t, third, { number: numbering.get(third.id) }))}</div>
    </section>`);
  }

  const chips = [
    { id: "all", label: "All" },
    { id: "todo", label: "To play" },
    { id: "done", label: "Played" },
  ];

  return html`<div class="toolbar">
      <div class="chips">
        ${chips.map(
          (chip) => html`<button class="chip${raw(state.filter === chip.id ? " is-active" : "")}" data-action="filter" data-value="${chip.id}">
            ${chip.label}
          </button>`
        )}
      </div>
      ${raw(
        t.groups.length > 1
          ? html`<div class="chips">
              <button class="chip${raw(state.groupFilter === "all" ? " is-active" : "")}" data-action="group-filter" data-value="all">All groups</button>
              ${t.groups.map(
                (group) => html`<button class="chip${raw(state.groupFilter === group.id ? " is-active" : "")}" data-action="group-filter" data-value="${group.id}">
                  ${group.name}
                </button>`
              )}
            </div>`
          : ""
      )}
    </div>
    ${groupSections}
    ${koSections}`;
}

export function handle(action, target) {
  if (action === "filter") {
    state.filter = target.dataset.value;
    rerenderView();
  }
  if (action === "group-filter") {
    state.groupFilter = target.dataset.value;
    rerenderView();
  }
}
