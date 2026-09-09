/* Setup screen: tournament details, format settings, players, and the draw. */
import * as model from "../model.js";
import { html, raw, esc } from "../util.js";
import { state, save, render as rerender, navigate, toast } from "../app.js";

function option(value, label, selected) {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}

export function render(t) {
  const s = t.settings;
  const drawn = t.matches.length > 0;
  const played = t.matches.some((m) => m.winnerId && m.status !== "bye");
  const maxGroups = Math.max(1, Math.floor(t.players.length / 2));
  const inDraw = new Set(t.matches.flatMap((m) => [m.p1, m.p2]).concat(t.groups.flatMap((g) => g.playerIds)));
  const missing = drawn ? t.players.filter((p) => !inDraw.has(p.id)).length : 0;

  return html`<div class="grid grid--setup">
    <section class="card">
      <h2 class="card__title">Details</h2>
      <div class="field">
        <label for="f-name">Tournament name</label>
        <input id="f-name" type="text" data-field="name" value="${t.name}" placeholder="Club championship" />
      </div>
      <details class="tuck" ${raw(t.venue ? "open" : "")}>
        <summary>Date and venue</summary>
        <div class="field-row field-row--tight">
          <div class="field">
            <label for="f-date">Date</label>
            <input id="f-date" type="date" data-field="date" value="${t.date}" />
          </div>
          <div class="field">
            <label for="f-venue">Venue</label>
            <input id="f-venue" type="text" data-field="venue" value="${t.venue}" placeholder="Sports hall" />
          </div>
        </div>
      </details>
    </section>

    <section class="card">
      <h2 class="card__title">Format</h2>
      <div class="segmented" role="radiogroup" aria-label="Format">
        ${Object.entries(model.FORMATS).map(
          ([key, format]) => html`<label class="seg${raw(t.format === key ? " is-active" : "")}">
            <input type="radio" name="format" value="${key}" data-field="format" ${raw(t.format === key ? "checked" : "")} />
            <span>${format.short}</span>
          </label>`
        )}
      </div>
      <p class="hint hint--format">${model.FORMATS[t.format].description}</p>

      <div class="field-row field-row--tight">
        <div class="field">
          <label for="f-bestof">Match length</label>
          <select id="f-bestof" data-field="bestOf">
            ${model.BEST_OF_OPTIONS.map((n) => raw(option(String(n), `Best of ${n} (first to ${model.setsToWin(n)})`, String(s.bestOf))))}
          </select>
        </div>
        <div class="field">
          <label for="f-points">Points per set</label>
          <select id="f-points" data-field="pointsPerSet">
            ${["11", "21"].map((n) => raw(option(n, `${n} points`, String(s.pointsPerSet))))}
          </select>
        </div>
      </div>

      ${raw(
        t.format === "groups_ko"
          ? html`<div class="field-row field-row--tight">
              <div class="field">
                <label for="f-groups">Number of groups</label>
                <select id="f-groups" data-field="groupCount">
                  ${Array.from({ length: Math.max(1, Math.min(8, maxGroups)) }, (_, i) =>
                    raw(option(String(i + 1), `${i + 1} group${i ? "s" : ""}`, String(s.groupCount)))
                  )}
                </select>
              </div>
              <div class="field">
                <label for="f-advance">Advance per group</label>
                <select id="f-advance" data-field="advancePerGroup">
                  ${[1, 2, 3, 4].map((n) => raw(option(String(n), `Top ${n}`, String(s.advancePerGroup))))}
                </select>
              </div>
            </div>`
          : ""
      )}

      <div class="checks">
        ${raw(
          t.format !== "knockout"
            ? html`<label class="check">
                <input type="checkbox" data-field="doubleRoundRobin" ${raw(s.doubleRoundRobin ? "checked" : "")} />
                <span>Double round robin (everyone plays everyone twice)</span>
              </label>`
            : ""
        )}
        ${raw(
          t.format !== "roundrobin"
            ? html`<label class="check">
                <input type="checkbox" data-field="thirdPlaceMatch" ${raw(s.thirdPlaceMatch ? "checked" : "")} />
                <span>Play a third place match</span>
              </label>`
            : ""
        )}
      </div>

      <div class="card__foot">
        <button class="btn btn--primary" data-action="draw" ${raw(t.players.length >= 2 ? "" : "disabled")}>
          ${drawn ? "Draw again" : "Draw the tournament"}
        </button>
        ${raw(drawn ? `<a class="btn btn--ghost" href="#/t/${t.id}/matches">Go to matches</a>` : "")}
        ${raw(
          missing
            ? `<p class="hint hint--warn">${missing} player${missing === 1 ? " was" : "s were"} added after the draw — draw again to include ${missing === 1 ? "them" : "them all"}.</p>`
            : played
            ? '<p class="hint hint--warn">Drawing again clears every score that has been recorded.</p>'
            : t.players.length < 2
            ? '<p class="hint">Add at least two players first.</p>'
            : `<p class="hint">${esc(previewText(t))}</p>`
        )}
      </div>
    </section>

    <section class="card card--players">
      <h2 class="card__title">Players <span class="count">${t.players.length}</span></h2>
      <form class="player-form" data-form="add-player" autocomplete="off">
        <textarea
          class="player-input"
          name="entry"
          rows="1"
          placeholder="Add player — name, club"
          aria-label="Player name, optionally followed by a comma and a club"
        ></textarea>
        <button class="btn btn--primary" type="submit">Add</button>
      </form>
      <p class="hint">Enter adds. Paste a list to add several at once — one per line.</p>

      ${raw(
        t.players.length
          ? html`<ol class="players">
              ${t.players.map(
                (p) => html`<li class="players__row">
                  <span class="players__seed">${p.seed}</span>
                  <button type="button" class="players__name" data-action="rename-player" data-id="${p.id}" title="Rename ${p.name}">
                    ${p.name}
                  </button>
                  <span class="players__club muted">${p.club}</span>
                  <button type="button" class="icon-btn" data-action="remove-player" data-id="${p.id}" title="Remove ${p.name}" aria-label="Remove ${p.name}">✕</button>
                </li>`
              )}
            </ol>`
          : '<p class="muted">No players yet. Type a name, or paste a list.</p>'
      )}
    </section>
  </div>`;
}

function previewText(t) {
  const n = t.players.length;
  if (t.format === "knockout") {
    const size = 2 ** Math.ceil(Math.log2(n));
    return `${n} players → bracket of ${size}${size > n ? ` with ${size - n} byes` : ""}.`;
  }
  const groups = t.format === "roundrobin" ? 1 : Math.max(1, Math.min(t.settings.groupCount, Math.floor(n / 2) || 1));
  const legs = t.settings.doubleRoundRobin ? 2 : 1;
  let matches = 0;
  for (let i = 0; i < groups; i += 1) {
    const size = Math.floor(n / groups) + (i < n % groups ? 1 : 0);
    matches += ((size * (size - 1)) / 2) * legs;
  }
  const koPart = t.format === "groups_ko" ? `, then a knockout for the top ${t.settings.advancePerGroup} of each group` : "";
  return `${groups} group${groups === 1 ? "" : "s"} · ${matches} group matches${koPart}.`;
}

/** True when scores would be lost, and the user said go ahead anyway. */
function confirmRedraw(t, what) {
  if (!t.matches.some((m) => m.winnerId && m.status !== "bye")) return true;
  return confirm(`${what} clears the current draw and every score recorded so far. Continue?`);
}

export function change(field, target) {
  const t = state.tournament;
  const value = target.type === "checkbox" ? target.checked : target.value;
  if (["name", "date", "venue", "format"].includes(field)) {
    if (field === "format" && t.matches.length) {
      if (!confirmRedraw(t, "Changing the format")) {
        rerender();
        return;
      }
      t.matches = [];
      t.groups = [];
    }
    t[field] = value;
  } else if (["bestOf", "pointsPerSet", "groupCount", "advancePerGroup"].includes(field)) {
    t.settings[field] = Number(value);
  } else {
    t.settings[field] = value;
  }
  save();
  if (["format", "groupCount", "advancePerGroup", "doubleRoundRobin", "thirdPlaceMatch", "bestOf"].includes(field)) rerender();
}

export function submit(form, element) {
  const t = state.tournament;
  if (form !== "add-player") return;
  const entry = String(new FormData(element).get("entry") || "");
  const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean);
  let added = 0;
  lines.forEach((line) => {
    const [name, ...rest] = line.split(/[,;\t]/);
    if (model.addPlayer(t, name, rest.join(",").trim())) added += 1;
  });
  if (!added) return;
  save();
  rerender();
  if (added > 1) toast(`Added ${added} players`);
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
  const t = state.tournament;
  const player = model.playerById(t, target.dataset.id);
  if (!player) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "players__edit";
  input.value = player.name;
  input.setAttribute("aria-label", `Rename ${player.name}`);
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
  const t = state.tournament;
  if (action === "rename-player") {
    renamePlayer(target);
    return;
  }
  if (action === "remove-player") {
    if (t.matches.length && !confirmRedraw(t, "Removing a player")) return;
    model.removePlayer(t, target.dataset.id);
    t.matches = [];
    t.groups = [];
    save();
    rerender();
  }
  if (action === "draw") {
    if (!confirmRedraw(t, "Drawing again")) return;
    model.drawTournament(t);
    save();
    toast("Draw complete");
    navigate(`#/t/${t.id}/matches`);
  }
}
