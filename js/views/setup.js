/* Setup screen: tournament details, format settings, players, and the draw. */
import * as model from "../model.js";
import { html, raw, esc } from "../util.js";
import { t } from "../i18n.js";
import { state, save, render as rerender, navigate, toast } from "../app.js";

function option(value, label, selected) {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}

export function render(tour) {
  const s = tour.settings;
  const drawn = tour.matches.length > 0;
  const played = tour.matches.some((m) => m.winnerId && m.status !== "bye");
  const maxGroups = Math.max(1, Math.floor(tour.players.length / 2));
  const inDraw = new Set(tour.matches.flatMap((m) => [m.p1, m.p2]).concat(tour.groups.flatMap((g) => g.playerIds)));
  const missing = drawn ? tour.players.filter((p) => !inDraw.has(p.id)).length : 0;

  return html`<div class="grid grid--setup">
    <section class="card">
      <h2 class="card__title">${t("Details")}</h2>
      <div class="field">
        <label for="f-name">${t("Tournament name")}</label>
        <input id="f-name" type="text" data-field="name" value="${tour.name}" placeholder="${t("Club championship")}" />
      </div>
      <details class="tuck" ${raw(tour.venue ? "open" : "")}>
        <summary>${t("Date and venue")}</summary>
        <div class="field-row field-row--tight">
          <div class="field">
            <label for="f-date">${t("Date")}</label>
            <input id="f-date" type="date" data-field="date" value="${tour.date}" />
          </div>
          <div class="field">
            <label for="f-venue">${t("Venue")}</label>
            <input id="f-venue" type="text" data-field="venue" value="${tour.venue}" placeholder="${t("Sports hall")}" />
          </div>
        </div>
      </details>
    </section>

    <section class="card">
      <h2 class="card__title">${t("Format")}</h2>
      <div class="segmented" role="radiogroup" aria-label="${t("Format")}">
        ${Object.entries(model.FORMATS).map(
          ([key, format]) => html`<label class="seg${raw(tour.format === key ? " is-active" : "")}">
            <input type="radio" name="format" value="${key}" data-field="format" ${raw(tour.format === key ? "checked" : "")} />
            <span>${t(format.short)}</span>
          </label>`
        )}
      </div>
      <p class="hint hint--format">${t(model.FORMATS[tour.format].description)}</p>

      <div class="field-row field-row--tight">
        <div class="field">
          <label for="f-bestof">${t("Match length")}</label>
          <select id="f-bestof" data-field="bestOf">
            ${model.BEST_OF_OPTIONS.map((n) =>
              raw(option(String(n), t("Best of {n} (first to {sets})", { n, sets: model.setsToWin(n) }), String(s.bestOf)))
            )}
          </select>
        </div>
        <div class="field">
          <label for="f-points">${t("Points per set")}</label>
          <select id="f-points" data-field="pointsPerSet">
            ${["11", "21"].map((n) => raw(option(n, t("{n} points", { n }), String(s.pointsPerSet))))}
          </select>
        </div>
      </div>

      ${raw(
        tour.format === "groups_ko"
          ? html`<div class="field-row field-row--tight">
              <div class="field">
                <label for="f-groups">${t("Number of groups")}</label>
                <select id="f-groups" data-field="groupCount">
                  ${Array.from({ length: Math.max(1, Math.min(8, maxGroups)) }, (_, i) =>
                    raw(option(String(i + 1), i ? t("{n} groups", { n: i + 1 }) : t("{n} group", { n: 1 }), String(s.groupCount)))
                  )}
                </select>
              </div>
              <div class="field">
                <label for="f-advance">${t("Advance per group")}</label>
                <select id="f-advance" data-field="advancePerGroup">
                  ${[1, 2, 3, 4].map((n) => raw(option(String(n), t("Top {n}", { n }), String(s.advancePerGroup))))}
                </select>
              </div>
            </div>`
          : ""
      )}

      <div class="checks">
        ${raw(
          tour.format !== "knockout"
            ? html`<label class="check">
                <input type="checkbox" data-field="doubleRoundRobin" ${raw(s.doubleRoundRobin ? "checked" : "")} />
                <span>${t("Double round robin (everyone plays everyone twice)")}</span>
              </label>`
            : ""
        )}
        ${raw(
          tour.format !== "roundrobin"
            ? html`<label class="check">
                <input type="checkbox" data-field="thirdPlaceMatch" ${raw(s.thirdPlaceMatch ? "checked" : "")} />
                <span>${t("Play a third place match")}</span>
              </label>`
            : ""
        )}
      </div>

      <div class="card__foot">
        <button class="btn btn--primary" data-action="draw" ${raw(tour.players.length >= 2 ? "" : "disabled")}>
          ${drawn ? t("Draw again") : t("Draw the tournament")}
        </button>
        ${raw(drawn ? `<a class="btn btn--ghost" href="#/t/${tour.id}/matches">${esc(t("Go to matches"))}</a>` : "")}
        ${raw(
          missing
            ? `<p class="hint hint--warn">${esc(
                missing === 1
                  ? t("{n} player was added after the draw — draw again to include them.", { n: missing })
                  : t("{n} players were added after the draw — draw again to include them all.", { n: missing })
              )}</p>`
            : played
            ? `<p class="hint hint--warn">${esc(t("Drawing again clears every score that has been recorded."))}</p>`
            : tour.players.length < 2
            ? `<p class="hint">${esc(t("Add at least two players first."))}</p>`
            : `<p class="hint">${esc(previewText(tour))}</p>`
        )}
      </div>
    </section>

    <section class="card card--players">
      <h2 class="card__title">${t("Players")} <span class="count">${tour.players.length}</span></h2>
      <form class="player-form" data-form="add-player" autocomplete="off">
        <textarea
          class="player-input"
          name="entry"
          rows="1"
          placeholder="${t("Add player — name, club")}"
          aria-label="${t("Player name, optionally followed by a comma and a club")}"
        ></textarea>
        <button class="btn btn--primary" type="submit">${t("Add")}</button>
      </form>
      <p class="hint">${t("Enter adds. Paste a list to add several at once — one per line.")}</p>

      ${raw(
        tour.players.length
          ? html`<ol class="players">
              ${tour.players.map(
                (p) => html`<li class="players__row">
                  <span class="players__seed">${p.seed}</span>
                  <button type="button" class="players__name" data-action="rename-player" data-id="${p.id}" title="${t("Rename {name}", { name: p.name })}">
                    ${p.name}
                  </button>
                  <span class="players__club muted">${p.club}</span>
                  <button type="button" class="icon-btn" data-action="remove-player" data-id="${p.id}" title="${t("Remove {name}", { name: p.name })}" aria-label="${t("Remove {name}", { name: p.name })}">✕</button>
                </li>`
              )}
            </ol>`
          : `<p class="muted">${esc(t("No players yet. Type a name, or paste a list."))}</p>`
      )}
    </section>
  </div>`;
}

function previewText(tour) {
  const n = tour.players.length;
  if (tour.format === "knockout") {
    const size = 2 ** Math.ceil(Math.log2(n));
    return size > n
      ? t("{n} players → bracket of {size} with {byes} byes.", { n, size, byes: size - n })
      : t("{n} players → bracket of {size}.", { n, size });
  }
  const groups = tour.format === "roundrobin" ? 1 : Math.max(1, Math.min(tour.settings.groupCount, Math.floor(n / 2) || 1));
  const legs = tour.settings.doubleRoundRobin ? 2 : 1;
  let matches = 0;
  for (let i = 0; i < groups; i += 1) {
    const size = Math.floor(n / groups) + (i < n % groups ? 1 : 0);
    matches += ((size * (size - 1)) / 2) * legs;
  }
  const groupText = groups === 1 ? t("{n} group", { n: 1 }) : t("{n} groups", { n: groups });
  return tour.format === "groups_ko"
    ? t("{groups} · {matches} group matches, then a knockout for the top {advance} of each group.", {
        groups: groupText,
        matches,
        advance: tour.settings.advancePerGroup,
      })
    : t("{groups} · {matches} group matches.", { groups: groupText, matches });
}

/** True when scores would be lost, and the user said go ahead anyway. */
function confirmRedraw(tour, message) {
  if (!tour.matches.some((m) => m.winnerId && m.status !== "bye")) return true;
  return confirm(t(message));
}

export function change(field, target) {
  const tour = state.tournament;
  const value = target.type === "checkbox" ? target.checked : target.value;
  if (["name", "date", "venue", "format"].includes(field)) {
    if (field === "format" && tour.matches.length) {
      if (!confirmRedraw(tour, "Changing the format clears the current draw and every score recorded so far. Continue?")) {
        rerender();
        return;
      }
      tour.matches = [];
      tour.groups = [];
    }
    tour[field] = value;
  } else if (["bestOf", "pointsPerSet", "groupCount", "advancePerGroup"].includes(field)) {
    tour.settings[field] = Number(value);
  } else {
    tour.settings[field] = value;
  }
  save();
  if (["format", "groupCount", "advancePerGroup", "doubleRoundRobin", "thirdPlaceMatch", "bestOf"].includes(field)) rerender();
}

export function submit(form, element) {
  const tour = state.tournament;
  if (form !== "add-player") return;
  const entry = String(new FormData(element).get("entry") || "");
  const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean);
  let added = 0;
  lines.forEach((line) => {
    const [name, ...rest] = line.split(/[,;\t]/);
    if (model.addPlayer(tour, name, rest.join(",").trim())) added += 1;
  });
  if (!added) return;
  save();
  rerender();
  if (added > 1) toast(t("Added {n} players", { n: added }));
  const input = document.querySelector(".player-input");
  if (input) input.focus({ preventScroll: true });
}

/** Keeps the one-line entry field usable: Enter adds, paste grows it. */
export function afterRender() {
  const input = document.querySelector(".player-input");
  if (!input) return;
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (input.form) input.form.requestSubmit();
  });
  grow();
}

function renamePlayer(target) {
  const tour = state.tournament;
  const player = model.playerById(tour, target.dataset.id);
  if (!player) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "players__edit";
  input.value = player.name;
  input.setAttribute("aria-label", t("Rename {name}", { name: player.name }));
  target.replaceWith(input);
  input.focus({ preventScroll: true });
  input.select();

  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== player.name) {
      player.name = name;
      save();
    }
    rerender();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

export function handle(action, target) {
  const tour = state.tournament;
  if (action === "rename-player") {
    renamePlayer(target);
    return;
  }
  if (action === "remove-player") {
    if (tour.matches.length && !confirmRedraw(tour, "Removing a player clears the current draw and every score recorded so far. Continue?")) return;
    model.removePlayer(tour, target.dataset.id);
    tour.matches = [];
    tour.groups = [];
    save();
    rerender();
  }
  if (action === "draw") {
    if (!confirmRedraw(tour, "Drawing again clears the current draw and every score recorded so far. Continue?")) return;
    model.drawTournament(tour);
    save();
    toast(t("Draw complete"));
    navigate(`#/t/${tour.id}/matches`);
  }
}
