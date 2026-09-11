/* Matches screen: every match, filterable, with score entry. */
import * as model from "../model.js";
import { html, raw, esc } from "../util.js";
import { t } from "../i18n.js";
import { matchCard } from "../components.js";
import { state, rerenderView } from "../app.js";

function visible(tour, matches) {
  const query = state.search.trim().toLowerCase();
  return matches.filter((match) => {
    if (match.status === "bye") return false;
    if (state.filter === "todo" && (match.winnerId || !model.isPlayable(match))) return false;
    if (state.filter === "done" && !match.winnerId) return false;
    if (query && !matchesQuery(tour, match, query)) return false;
    return true;
  });
}

/* Results come back from the tables in whatever order they finish, so finding
   one named match matters more than following the schedule. */
function matchesQuery(tour, match, query) {
  const haystack = [
    model.playerName(tour, match.p1),
    model.playerName(tour, match.p2),
    model.matchLabel(tour, match),
    String(match.no || ""),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function render(tour) {
  if (!tour.matches.length) {
    return html`<section class="card empty">
      <h2>${t("Nothing drawn yet")}</h2>
      <p class="muted">${t("Add your players on the setup screen and draw the tournament to get a schedule.")}</p>
      <a class="btn btn--primary" href="#/t/${tour.id}/setup">${t("Go to setup")}</a>
    </section>`;
  }

  if (tour.matches.some((m) => m.status !== "bye" && !m.no)) model.numberMatches(tour);

  const groupSections = tour.groups
    .filter((group) => state.groupFilter === "all" || state.groupFilter === group.id)
    .map((group) => {
      const all = tour.matches.filter((m) => m.stage === "group" && m.groupId === group.id).sort((a, b) => a.round - b.round || a.order - b.order);
      const shown = visible(tour, all);
      const done = all.filter((m) => m.winnerId).length;
      return html`<section class="card">
        <h2 class="card__title">
          ${model.groupName(group)}
          <span class="count">${done}/${all.length}</span>
        </h2>
        ${raw(
          shown.length
            ? `<div class="matchgrid">${shown.map((m) => matchCard(tour, m, { number: m.no, showStage: false })).join("")}</div>`
            : `<p class="muted">${esc(state.search ? t("Nothing matches “{query}”.", { query: state.search }) : t("Nothing here with the current filter."))}</p>`
        )}
      </section>`;
    });

  const koRounds = model.knockoutRounds(tour);
  const third = model.thirdPlaceMatch(tour);
  const koSections =
    state.groupFilter === "all" && koRounds.length
      ? koRounds.map((round) => {
          const shown = visible(tour, round.matches);
          return html`<section class="card">
            <h2 class="card__title">${round.name}</h2>
            ${raw(
              shown.length
                ? `<div class="matchgrid">${shown.map((m) => matchCard(tour, m, { number: m.no, showStage: false })).join("")}</div>`
                : `<p class="muted">${esc(state.search ? t("Nothing matches “{query}”.", { query: state.search }) : t("Nothing here with the current filter."))}</p>`
            )}
          </section>`;
        })
      : [];

  if (third && state.groupFilter === "all" && visible(tour, [third]).length) {
    koSections.push(html`<section class="card">
      <h2 class="card__title">${t("Third place")}</h2>
      <div class="matchgrid">${raw(matchCard(tour, third, { number: third.no, showStage: false }))}</div>
    </section>`);
  }

  const chips = [
    { id: "all", label: t("All") },
    { id: "todo", label: t("To play") },
    { id: "done", label: t("Played") },
  ];

  return html`<div class="searchbar">
      <input
        type="search"
        class="search"
        id="match-search"
        value="${state.search}"
        placeholder="${t("Search player or number")}"
        aria-label="${t("Search player or number")}"
      />
    </div>
    <div class="toolbar">
      ${chips.map(
        (chip) => html`<button class="chip${raw(state.filter === chip.id ? " is-active" : "")}" data-action="filter" data-value="${chip.id}">
          ${chip.label}
        </button>`
      )}
      ${raw(
        tour.groups.length > 1
          ? html`<span class="toolbar__sep" aria-hidden="true"></span>
              <button class="chip${raw(state.groupFilter === "all" ? " is-active" : "")}" data-action="group-filter" data-value="all">${t("All groups")}</button>
              ${tour.groups.map(
                (group) => html`<button class="chip${raw(state.groupFilter === group.id ? " is-active" : "")}" data-action="group-filter" data-value="${group.id}">
                  ${group.letter || model.groupName(group)}
                </button>`
              )}`
          : ""
      )}
    </div>
    ${groupSections}
    ${koSections}`;
}

/** Keeps focus and caret in the search box across the redraw it triggers. */
export function afterRender() {
  const input = document.getElementById("match-search");
  if (!input) return;
  input.addEventListener("input", () => {
    state.search = input.value;
    rerenderView();
    const again = document.getElementById("match-search");
    if (again) {
      again.focus({ preventScroll: true });
      again.setSelectionRange(again.value.length, again.value.length);
    }
  });
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
