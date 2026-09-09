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

  return html`<div class="grid grid--setup">
    <section class="card">
      <h2 class="card__title">Details</h2>
      <div class="field">
        <label for="f-name">Tournament name</label>
        <input id="f-name" type="text" data-field="name" value="${t.name}" placeholder="Club championship" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-date">Date</label>
          <input id="f-date" type="date" data-field="date" value="${t.date}" />
        </div>
        <div class="field">
          <label for="f-venue">Venue</label>
          <input id="f-venue" type="text" data-field="venue" value="${t.venue}" placeholder="Sports hall" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="card__title">Format</h2>
      <div class="formats">
        ${Object.entries(model.FORMATS).map(
          ([key, format]) => html`<label class="pick${raw(t.format === key ? " is-active" : "")}">
            <input type="radio" name="format" value="${key}" data-field="format" ${raw(t.format === key ? "checked" : "")} />
            <span class="pick__label">${format.label}</span>
            <span class="pick__desc">${format.description}</span>
          </label>`
        )}
      </div>

      <div class="field-row">
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
          ? html`<div class="field-row">
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
          played
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
        <input type="text" name="name" placeholder="Player name" aria-label="Player name" required />
        <input type="text" name="club" placeholder="Club (optional)" aria-label="Club" />
        <button class="btn btn--primary" type="submit">Add</button>
      </form>

      ${raw(
        t.players.length
          ? html`<ol class="players">
              ${t.players.map(
                (p) => html`<li class="players__row">
                  <span class="players__seed">${p.seed}</span>
                  <span class="players__name">${p.name}</span>
                  <span class="players__club muted">${p.club}</span>
                  <button class="icon-btn" data-action="remove-player" data-id="${p.id}" title="Remove ${p.name}" aria-label="Remove ${p.name}">✕</button>
                </li>`
              )}
            </ol>`
          : '<p class="muted">No players yet. Add them one at a time, or paste a list below.</p>'
      )}

      <details class="bulk" ${raw(t.players.length ? "" : "open")}>
        <summary>Paste a list of players</summary>
        <form data-form="bulk-players">
          <textarea name="bulk" rows="6" placeholder="One player per line&#10;Ann Svensson&#10;Bo Nilsson, TTK Rekord"></textarea>
          <p class="hint">One per line. Add a club after a comma.</p>
          <button class="btn" type="submit">Add all</button>
        </form>
      </details>
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

export function change(field, target) {
  const t = state.tournament;
  const value = target.type === "checkbox" ? target.checked : target.value;
  if (["name", "date", "venue", "format"].includes(field)) {
    t[field] = value;
    if (field === "format") {
      t.matches = [];
      t.groups = [];
    }
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
  const data = new FormData(element);
  if (form === "add-player") {
    const player = model.addPlayer(t, data.get("name"), data.get("club"));
    if (!player) return;
    save();
    rerender();
    const input = document.querySelector('.player-form input[name="name"]');
    if (input) input.focus();
  }
  if (form === "bulk-players") {
    const lines = String(data.get("bulk") || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let added = 0;
    lines.forEach((line) => {
      const [name, club] = line.split(/[,;\t]/);
      if (model.addPlayer(t, name, club || "")) added += 1;
    });
    save();
    rerender();
    toast(`Added ${added} player${added === 1 ? "" : "s"}`);
  }
}

export function handle(action, target) {
  const t = state.tournament;
  if (action === "remove-player") {
    model.removePlayer(t, target.dataset.id);
    if (t.matches.length) {
      t.matches = [];
      t.groups = [];
    }
    save();
    rerender();
  }
  if (action === "draw") {
    const played = t.matches.some((m) => m.winnerId && m.status !== "bye");
    if (played && !confirm("Drawing again clears every recorded score. Continue?")) return;
    model.drawTournament(t);
    save();
    toast("Draw complete");
    navigate(`#/t/${t.id}/matches`);
  }
}
