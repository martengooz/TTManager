/* Router, shared state and the score entry dialog. */
import * as store from "./store.js";
import * as model from "./model.js";
import { $, html, raw, esc, on, download, slugify, formatDate } from "./util.js";
import * as home from "./views/home.js";
import * as setup from "./views/setup.js";
import * as matches from "./views/matches.js";
import * as standings from "./views/standings.js";
import * as bracket from "./views/bracket.js";
import * as printView from "./views/print.js";

const VIEWS = { setup, matches, standings, bracket, print: printView };
const TABS = [
  { id: "setup", label: "Setup" },
  { id: "matches", label: "Matches" },
  { id: "standings", label: "Standings" },
  { id: "bracket", label: "Bracket" },
  { id: "print", label: "Print" },
];

export const state = { tournament: null, view: "home", filter: "all", groupFilter: "all" };

export function save() {
  if (state.tournament) store.save(state.tournament);
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

export function toast(message, kind = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast toast--${kind} is-visible`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1]) return { id: parts[1], view: parts[2] || "setup" };
  return { id: null, view: "home" };
}

function chrome(tournament, view) {
  const p = model.progress(tournament);
  const showBracket = tournament.matches.some((m) => m.stage === "ko");
  const tabs = TABS.filter((tab) => tab.id !== "bracket" || showBracket);
  return html`<header class="topbar">
      <div class="topbar__row">
        <a class="btn btn--ghost" href="#/" title="All tournaments">← All</a>
        <div class="topbar__title">
          <h1>${tournament.name}</h1>
          <p class="muted">
            ${model.FORMATS[tournament.format].label} · best of ${tournament.settings.bestOf} ·
            ${tournament.players.length} players${raw(tournament.date ? ` · ${esc(formatDate(tournament.date))}` : "")}
          </p>
        </div>
        <div class="topbar__actions">
          <button class="btn btn--ghost" data-action="export">Export</button>
          <a class="btn btn--primary" href="#/t/${tournament.id}/print">Print</a>
        </div>
      </div>
      <div class="progress" title="${p.done} of ${p.total} matches played">
        <div class="progress__bar" style="width:${p.pct}%"></div>
      </div>
      <nav class="tabs">
        ${tabs.map(
          (tab) => html`<a class="tab${raw(tab.id === view ? " is-active" : "")}" href="#/t/${tournament.id}/${tab.id}">${tab.label}</a>`
        )}
        <span class="tabs__count">${p.done}/${p.total} matches</span>
      </nav>
    </header>`;
}

/** Re-renders the current screen. Scroll handling lives in render itself. */
export function rerenderView() {
  render();
}

/* Moving to another screen starts at the top; redrawing the screen you are
   already on keeps you where you were, so adding a player or saving a score
   does not throw you back up the page. */
let lastScreen = null;

export function render() {
  const route = parseHash();
  const app = $("#app");
  const scrollY = window.scrollY;
  const screen = `${route.id || "home"}/${route.id ? route.view : ""}`;
  const sameScreen = screen === lastScreen;
  lastScreen = screen;

  if (!route.id) {
    state.tournament = null;
    state.view = "home";
    app.innerHTML = home.render();
    document.body.dataset.view = "home";
    document.title = "TT Manager";
    if (home.afterRender) home.afterRender();
    restoreScroll(sameScreen, scrollY);
    return;
  }

  const tournament = state.tournament && state.tournament.id === route.id ? state.tournament : store.get(route.id);
  if (!tournament) {
    navigate("#/");
    return;
  }
  state.tournament = tournament;
  state.view = VIEWS[route.view] ? route.view : "setup";

  const view = VIEWS[state.view];
  app.innerHTML = state.view === "print"
    ? view.render(tournament)
    : chrome(tournament, state.view) + `<main class="view view--${state.view}">${view.render(tournament)}</main>`;
  document.body.dataset.view = state.view;
  document.title = `${tournament.name} · TT Manager`;
  if (view.afterRender) view.afterRender(tournament);
  restoreScroll(sameScreen, scrollY);
}

function restoreScroll(sameScreen, scrollY) {
  window.scrollTo({ top: sameScreen ? scrollY : 0, behavior: "auto" });
}

/* ------------------------------------------------------------------ *
 * Score dialog
 * ------------------------------------------------------------------ */

let dialogMatchId = null;

export function openScoreDialog(matchId) {
  const tournament = state.tournament;
  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match || !match.p1 || !match.p2) return;
  dialogMatchId = matchId;

  const dialog = $("#score-dialog");
  const maxSets = tournament.settings.bestOf;
  const rows = Array.from({ length: maxSets }, (_, i) => {
    const set = match.sets[i] || ["", ""];
    return html`<div class="setrow">
      <label class="setrow__label">Set ${i + 1}</label>
      <input class="score-input" type="number" min="0" max="99" inputmode="numeric" data-set="${i}" data-side="0" value="${set[0]}" aria-label="Set ${i + 1}, ${model.playerName(tournament, match.p1)}" />
      <span class="setrow__dash">–</span>
      <input class="score-input" type="number" min="0" max="99" inputmode="numeric" data-set="${i}" data-side="1" value="${set[1]}" aria-label="Set ${i + 1}, ${model.playerName(tournament, match.p2)}" />
    </div>`;
  });

  dialog.innerHTML = html`<form method="dialog" id="score-form">
    <header class="dialog__head">
      <p class="dialog__stage">${match.stage === "group" ? matchStage(tournament, match) : match.label}</p>
      <h2>
        <span>${model.playerName(tournament, match.p1)}</span>
        <span class="muted">v</span>
        <span>${model.playerName(tournament, match.p2)}</span>
      </h2>
      <p class="muted">Best of ${maxSets} · first to ${tournament.settings.pointsPerSet}, win by two</p>
    </header>
    <div class="dialog__body">
      <div class="setrows">${rows}</div>
      <p class="dialog__status" id="score-status"></p>
    </div>
    <footer class="dialog__foot">
      <div class="dialog__foot-left">
        <button type="button" class="btn btn--ghost btn--small" data-dialog="walkover" data-winner="${match.p1}">w/o ${model.playerName(tournament, match.p1)}</button>
        <button type="button" class="btn btn--ghost btn--small" data-dialog="walkover" data-winner="${match.p2}">w/o ${model.playerName(tournament, match.p2)}</button>
        ${raw(match.winnerId ? '<button type="button" class="btn btn--ghost btn--small btn--danger" data-dialog="clear">Clear</button>' : "")}
      </div>
      <div class="dialog__foot-right">
        <button type="button" class="btn btn--ghost" data-dialog="cancel">Cancel</button>
        <button type="button" class="btn btn--primary" data-dialog="save">Save result</button>
      </div>
    </footer>
  </form>`;

  dialog.showModal();
  const first = dialog.querySelector(".score-input");
  if (first) first.focus();
  validateDialog();
}

function matchStage(tournament, match) {
  const group = tournament.groups.find((g) => g.id === match.groupId);
  return group ? group.name : "Match";
}

function readDialogSets() {
  return Array.from($("#score-dialog").querySelectorAll(".setrow")).map((row) => {
    const inputs = row.querySelectorAll(".score-input");
    const a = inputs[0].value === "" ? null : Number(inputs[0].value);
    const b = inputs[1].value === "" ? null : Number(inputs[1].value);
    return [a, b];
  });
}

function validateDialog() {
  const status = $("#score-status");
  if (!status) return null;
  const sets = readDialogSets();
  const filled = sets.filter(([a, b]) => a !== null && b !== null);
  if (!filled.length) {
    status.textContent = "Enter the points for each set.";
    status.className = "dialog__status";
    return null;
  }
  const result = model.validateResult(sets, state.tournament.settings);
  if (!result.ok) {
    status.textContent = result.error;
    status.className = "dialog__status is-error";
    return null;
  }
  const match = state.tournament.matches.find((m) => m.id === dialogMatchId);
  const winner = result.winnerSide === 0 ? match.p1 : match.p2;
  status.textContent = `${model.playerName(state.tournament, winner)} wins ${Math.max(...result.setWins)}–${Math.min(...result.setWins)}`;
  status.className = "dialog__status is-ok";
  return result;
}

function closeDialog() {
  const dialog = $("#score-dialog");
  if (dialog.open) dialog.close();
  dialogMatchId = null;
}

function wireDialog() {
  const dialog = $("#score-dialog");

  dialog.addEventListener("input", (event) => {
    if (event.target.classList.contains("score-input")) validateDialog();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const inputs = Array.from(dialog.querySelectorAll(".score-input"));
    const index = inputs.indexOf(document.activeElement);
    if (index >= 0 && index < inputs.length - 1) inputs[index + 1].focus();
    else saveDialog();
  });

  on(dialog, "click", "[data-dialog]", (event, target) => {
    const action = target.dataset.dialog;
    if (action === "cancel") closeDialog();
    if (action === "save") saveDialog();
    if (action === "clear") {
      model.clearResult(state.tournament, dialogMatchId);
      save();
      closeDialog();
      render();
      toast("Result cleared");
    }
    if (action === "walkover") {
      const result = model.recordWalkover(state.tournament, dialogMatchId, target.dataset.winner);
      if (!result.ok) return toast(result.error, "error");
      save();
      closeDialog();
      render();
      toast("Walkover recorded");
    }
  });

  dialog.addEventListener("close", () => {
    dialogMatchId = null;
  });
}

function saveDialog() {
  const result = validateDialog();
  if (!result) {
    toast("That score is not a complete, legal result yet.", "error");
    return;
  }
  const outcome = model.recordResult(state.tournament, dialogMatchId, readDialogSets());
  if (!outcome.ok) return toast(outcome.error, "error");
  save();
  closeDialog();
  render();
  toast("Result saved");
}

/* ------------------------------------------------------------------ *
 * Global events
 * ------------------------------------------------------------------ */

function wireGlobal() {
  const app = $("#app");

  on(app, "click", "[data-action]", (event, target) => {
    const action = target.dataset.action;
    const view = VIEWS[state.view];
    if (action === "score") {
      openScoreDialog(target.dataset.match);
      return;
    }
    if (action === "export") {
      download(`${slugify(state.tournament.name)}.json`, store.exportJSON(state.tournament));
      return;
    }
    if (state.view === "home") {
      home.handle(action, target, event);
      return;
    }
    if (view && view.handle) view.handle(action, target, event);
  });

  on(app, "click", ".bnode[data-match]", (event, target) => {
    if (event.target.closest("[data-action]")) return;
    openScoreDialog(target.dataset.match);
  });

  on(app, "input", "input[type=text], input[type=date], textarea", (event, target) => {
    if (!target.dataset.field) return;
    const view = VIEWS[state.view];
    if (view && view.change) view.change(target.dataset.field, target, event);
  });

  on(app, "change", "[data-field]", (event, target) => {
    const view = VIEWS[state.view];
    if (view && view.change) view.change(target.dataset.field, target, event);
  });

  on(app, "submit", "form[data-form]", (event, target) => {
    event.preventDefault();
    const view = state.view === "home" ? home : VIEWS[state.view];
    if (view && view.submit) view.submit(target.dataset.form, target, event);
  });

  window.addEventListener("hashchange", render);
  // Ctrl/Cmd+P anywhere in a tournament prints the full sheet, not the screen.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "p" || !(event.metaKey || event.ctrlKey) || !state.tournament) return;
    if (state.view === "print") return;
    event.preventDefault();
    navigate(`#/t/${state.tournament.id}/print`);
    setTimeout(() => window.print(), 250);
  });
}

/* PWA install prompt. Chromium fires this when the app is installable. */
let installEvent = null;

export function installAvailable() {
  return !!installEvent;
}

export async function promptInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  render();
  if (choice && choice.outcome === "accepted") toast("Installed — look for TT Manager on your home screen");
}

function watchInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    if (state.view === "home") render();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    if (state.view === "home") render();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { scope: "./" }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

wireGlobal();
wireDialog();
watchInstall();
render();
registerServiceWorker();
