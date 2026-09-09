/* Start screen: the list of saved tournaments plus creating and importing. */
import * as store from "../store.js";
import * as model from "../model.js";
import { html, raw, esc, formatDate, download, slugify, APP_VERSION } from "../util.js";
import { navigate, toast, render as rerender, installAvailable, promptInstall } from "../app.js";

export function render() {
  const tournaments = store.list();
  return html`<div class="home">
    <header class="hero">
      <div class="hero__brand">
        <img src="icons/icon.svg" alt="" width="48" height="48" />
        <div>
          <h1>TT Manager</h1>
          ${raw(tournaments.length ? "" : "<p>Set up a table tennis tournament, record every score, print the whole thing.</p>")}
        </div>
      </div>
      <div class="hero__actions">
        <button class="btn btn--primary btn--large" data-action="new">New tournament</button>
        <button class="btn btn--ghost" data-action="import">Import file</button>
        ${raw(installAvailable() ? '<button class="btn btn--ghost" data-action="install">Install app</button>' : "")}
        <input type="file" id="import-input" accept="application/json,.json" hidden />
      </div>
    </header>

    ${raw(
      tournaments.length
        ? html`<section class="card">
            <h2 class="card__title">Your tournaments</h2>
            <ul class="tlist">
              ${tournaments.map((t) => {
                const p = model.progress(t);
                const champion = model.podium(t)[0];
                return html`<li class="tlist__item">
                  <a class="tlist__main" href="#/t/${t.id}/${t.matches.length ? "matches" : "setup"}">
                    <span class="tlist__name">${t.name}</span>
                    <span class="tlist__meta">
                      ${model.FORMATS[t.format].label} · ${t.players.length} players
                      ${raw(t.date ? ` · ${esc(formatDate(t.date))}` : "")}
                    </span>
                  </a>
                  ${raw(
                    champion
                      ? `<span class="tag tag--ok tag--champ">🏆 ${esc(model.playerName(t, champion.playerId))}</span>`
                      : p.total
                      ? `<span class="tag">${p.done}/${p.total}</span>`
                      : '<span class="tag">not drawn</span>'
                  )}
                  <details class="menu">
                    <summary class="iconbtn" title="More" aria-label="More actions for ${t.name}">⋯</summary>
                    <div class="menu__list">
                      <button type="button" class="menu__item" data-action="duplicate" data-id="${t.id}">Duplicate</button>
                      <button type="button" class="menu__item" data-action="export-one" data-id="${t.id}">Export as JSON</button>
                      <button type="button" class="menu__item menu__item--danger" data-action="delete" data-id="${t.id}">Delete</button>
                    </div>
                  </details>
                </li>`;
              })}
            </ul>
          </section>`
        : html`<section class="card empty">
            <h2>No tournaments yet</h2>
            <p class="muted">
              Create one, add your players, and TT Manager draws the groups and the bracket for you.
              Everything is stored in this browser — it keeps working offline.
            </p>
            <button class="btn btn--primary" data-action="new">Create your first tournament</button>
          </section>`
    )}

    ${raw(
      tournaments.length
        ? ""
        : html`<section class="cards">
            ${Object.entries(model.FORMATS).map(
              ([key, format]) => html`<div class="card card--info">
                <h3>${format.label}</h3>
                <p class="muted">${format.description}</p>
              </div>`
            )}
          </section>`
    )}

    <footer class="home__foot muted">
      Scores follow the standard rules: sets to 11, win by two, best of 3/5/7. Install the app from your
      browser menu to use it courtside without a connection.
      <span class="home__version">v${APP_VERSION}</span>
    </footer>
  </div>`;
}

export function handle(action, target) {
  if (action === "new") {
    // Carry over the last tournament's format and rules: a club runs the same
    // shape of event week after week.
    const previous = store.list()[0];
    const tournament = model.createTournament({
      name: `Tournament ${new Date().toLocaleDateString()}`,
      venue: previous ? previous.venue : "",
      format: previous ? previous.format : undefined,
      ...(previous ? previous.settings : {}),
    });
    store.save(tournament);
    navigate(`#/t/${tournament.id}/setup`);
  }
  if (action === "delete") {
    const tournament = store.get(target.dataset.id);
    if (tournament && confirm(`Delete “${tournament.name}” and all its scores? This cannot be undone.`)) {
      store.remove(target.dataset.id);
      rerender();
      toast("Tournament deleted");
    }
  }
  if (action === "duplicate") {
    const tournament = store.get(target.dataset.id);
    if (tournament) {
      store.duplicate(tournament);
      rerender();
      toast("Copy created");
    }
  }
  if (action === "export-one") {
    const tournament = store.get(target.dataset.id);
    if (tournament) download(`${slugify(tournament.name)}.json`, store.exportJSON(tournament));
  }
  if (action === "install") promptInstall();
  if (action === "import") {
    const input = document.getElementById("import-input");
    if (input) input.click();
  }
}

/** The file input keeps its own handler so a picked file always lands. */
export function afterRender() {
  const input = document.getElementById("import-input");
  if (!input) return;
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const imported = store.importJSON(await file.text());
      rerender();
      toast(`Imported ${imported.length} tournament${imported.length === 1 ? "" : "s"}`);
    } catch (error) {
      toast(error.message || "Could not read that file.", "error");
    }
    input.value = "";
  };
}
