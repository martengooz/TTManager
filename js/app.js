/* Router, shared state and the score entry dialog. */
import * as store from "./store.js";
import * as settings from "./settings.js";
import { t, LANGUAGES, currentLanguage } from "./i18n.js";
import * as model from "./model.js";
import { $, $$, html, raw, esc, on, download, slugify, formatDate, APP_VERSION } from "./util.js";
import * as home from "./views/home.js";
import * as setup from "./views/setup.js";
import * as matches from "./views/matches.js";
import * as standings from "./views/standings.js";
import * as bracket from "./views/bracket.js";
import * as printView from "./views/print.js";
import * as scorecards from "./views/scorecards.js";
import * as scan from "./views/scan.js";
import { sideName } from "./components.js";

const VIEWS = { setup, matches, standings, bracket, print: printView, scorecards, scan };
const TABS = ["setup", "matches", "standings", "bracket", "print"];
const TAB_LABELS = { setup: "Setup", matches: "Matches", standings: "Standings", bracket: "Bracket", print: "Print" };

export const state = { tournament: null, view: "home", arg: null, filter: "all", groupFilter: "all", search: "" };

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
  if (parts[0] === "t" && parts[1]) return { id: parts[1], view: parts[2] || "setup", arg: parts[3] || null };
  return { id: null, view: "home", arg: null };
}

function chrome(tournament, view) {
  const p = model.progress(tournament);
  const showBracket = tournament.matches.some((m) => m.stage === "ko");
  const tabs = TABS.filter((tab) => tab !== "bracket" || showBracket);
  return html`<header class="topbar">
      <div class="topbar__row">
        <a class="iconbtn" href="#/" title="${t("All tournaments")}" aria-label="${t("All tournaments")}">‹</a>
        <h1 class="topbar__name" title="${tournament.name}">${tournament.name}</h1>
        ${raw(
          p.total
            ? `<button type="button" class="topbar__count" data-action="show-todo" title="${esc(t("{done} of {total} played — tap to see what is left", { done: p.done, total: p.total }))}">${p.done}/${p.total}</button>`
            : ""
        )}
        <details class="menu">
          <summary class="iconbtn" title="${t("More")}" aria-label="${t("More actions")}">⋯</summary>
          <div class="menu__list">
            <a class="menu__item" href="#/t/${tournament.id}/print">${t("Print / Save as PDF")}</a>
            <a class="menu__item" href="#/t/${tournament.id}/scorecards">${t("Umpire scorecards")}</a>
            <a class="menu__item" href="#/t/${tournament.id}/scan">${t("Scan a scorecard")}</a>
            <button type="button" class="menu__item" data-action="export">${t("Export as JSON")}</button>
            <button type="button" class="menu__item" data-action="duplicate-current">${t("Duplicate tournament")}</button>
            <button type="button" class="menu__item" data-action="settings">${t("Settings")}</button>
            <button type="button" class="menu__item menu__item--danger" data-action="delete-current">${t("Delete tournament")}</button>
          </div>
        </details>
      </div>
      <nav class="tabs">
        ${tabs.map(
          (tab) => html`<a class="tab${raw(tab === view ? " is-active" : "")}" href="#/t/${tournament.id}/${tab}">${t(TAB_LABELS[tab])}</a>`
        )}
      </nav>
      <div class="progress" aria-hidden="true"><div class="progress__bar" style="width:${p.pct}%"></div></div>
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
  const screen = `${route.id || "home"}/${route.id ? route.view : ""}/${route.arg || ""}`;
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
  const nextView = VIEWS[route.view] ? route.view : "setup";
  /* A screen that holds on to something the browser gave it - the camera, so
     far - gets told before it is replaced. */
  if (nextView !== state.view && VIEWS[state.view] && VIEWS[state.view].leave) VIEWS[state.view].leave();
  state.view = nextView;
  state.arg = route.arg;

  const view = VIEWS[state.view];
  const bare = state.view === "print" || state.view === "scorecards" || state.view === "scan";
  app.innerHTML = bare
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
  const next = settings.get().chainNext ? nextPlayable(matchId) : null;
  const remaining = model.upcomingMatches(tournament).filter((m) => m.id !== matchId).length;
  const rows = Array.from({ length: maxSets }, (_, i) => {
    const set = match.sets[i] || ["", ""];
    return html`<div class="setrow">
      <label class="setrow__label">${t("Set {n}", { n: i + 1 })}</label>
      <input class="score-input" type="number" min="0" max="99" inputmode="numeric" data-set="${i}" data-side="0" value="${set[0]}" aria-label="${t("Set {n}, {player}", { n: i + 1, player: model.playerName(tournament, match.p1) })}" />
      <span class="setrow__dash">–</span>
      <input class="score-input" type="number" min="0" max="99" inputmode="numeric" data-set="${i}" data-side="1" value="${set[1]}" aria-label="${t("Set {n}, {player}", { n: i + 1, player: model.playerName(tournament, match.p2) })}" />
    </div>`;
  });

  dialog.innerHTML = html`<form method="dialog" id="score-form">
    <header class="dialog__head">
      <p class="dialog__stage">${model.matchLabel(tournament, match)}</p>
      <h2>
        <span>${model.playerName(tournament, match.p1)}</span>
        <span class="muted">${t("v")}</span>
        <span>${model.playerName(tournament, match.p2)}</span>
      </h2>
      <p class="muted">
        ${remaining
          ? t("Best of {n} · first to {points}, win by two · {left} more to play", { n: maxSets, points: tournament.settings.pointsPerSet, left: remaining })
          : t("Best of {n} · first to {points}, win by two", { n: maxSets, points: tournament.settings.pointsPerSet })}
      </p>
    </header>
    <div class="dialog__body">
      <div class="setrows">${rows}</div>
      ${raw(
        settings.get().autoFill
          ? `<p class="dialog__hint">${esc(t("Type the loser's points and the winning score fills itself. Enter {points} or more and the other side is up to you. Enter moves on.", { points: tournament.settings.pointsPerSet }))}</p>`
          : ""
      )}
      <p class="dialog__status" id="score-status"></p>
    </div>
    <footer class="dialog__foot">
      <div class="dialog__foot-left">
        <button type="button" class="btn btn--ghost btn--small" data-dialog="walkover" data-winner="${match.p1}">${t("w/o {player}", { player: model.playerName(tournament, match.p1) })}</button>
        <button type="button" class="btn btn--ghost btn--small" data-dialog="walkover" data-winner="${match.p2}">${t("w/o {player}", { player: model.playerName(tournament, match.p2) })}</button>
        ${raw(match.winnerId ? `<button type="button" class="btn btn--ghost btn--small btn--danger" data-dialog="clear">${esc(t("Clear"))}</button>` : "")}
        <button type="button" class="btn btn--ghost btn--small" data-dialog="cancel">${t("Close")}</button>
      </div>
      <div class="dialog__foot-right">
        <button type="button" class="btn${raw(next ? "" : " btn--primary")}" data-dialog="save">${t("Save")}</button>
        ${raw(
          next
            ? `<button type="button" class="btn btn--primary" data-dialog="save-next" title="${esc(t("Save and open {a} v {b}", { a: sideName(tournament, next, 1), b: sideName(tournament, next, 2) }))}">${esc(t("Save & next ›"))}</button>`
            : ""
        )}
      </div>
    </footer>
  </form>`;

  dialog.showModal();
  updateRowStates();
  const first = dialog.querySelector(".score-input:not([disabled])");
  if (first) {
    first.focus({ preventScroll: true });
    first.select();
  }
  validateDialog();
}

/** The next match that can actually be played, skipping the one in hand. */
function nextPlayable(exceptId) {
  return model.upcomingMatches(state.tournament).find((match) => match.id !== exceptId) || null;
}

function matchStage(tournament, match) {
  const group = tournament.groups.find((g) => g.id === match.groupId);
  return group ? group.name : "Match";
}

/**
 * The only score its opponent follows from is a losing one: anything up to two
 * short of the target lost to the target itself, and one short lost the deuce
 * by two. From the target upwards a score can be either the winning or the
 * losing side (12 could be 12-10 or 14-12), so the organiser types that one.
 */
function impliedOpponent(value, pointsPerSet) {
  if (!Number.isInteger(value) || value < 0) return null;
  if (value <= pointsPerSet - 2) return pointsPerSet;
  if (value === pointsPerSet - 1) return pointsPerSet + 1;
  return null;
}

function rowInputs(row) {
  return Array.from(row.querySelectorAll(".score-input"));
}

function inputValue(input) {
  const raw = input.value.trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function setAuto(input, value) {
  input.value = value === null ? "" : String(value);
  input.dataset.auto = value === null ? "" : "true";
  input.classList.toggle("is-auto", value !== null);
}

function clearAuto(input) {
  input.dataset.auto = "";
  input.classList.remove("is-auto");
}

/**
 * Fills in whatever the typed score forces. Typing never moves the focus:
 * a digit can always be the start of a longer number, so only Enter says a
 * score is finished.
 */
function handleScoreInput(input) {
  const { pointsPerSet } = state.tournament.settings;
  const row = input.closest(".setrow");
  const [left, right] = rowInputs(row);
  const other = input === left ? right : left;
  const value = inputValue(input);

  clearAuto(input);

  const implied = settings.get().autoFill ? impliedOpponent(value, pointsPerSet) : null;
  const otherIsOurs = other.dataset.auto === "true" || other.value.trim() === "";
  if (otherIsOurs && (settings.get().autoFill || other.dataset.auto === "true")) {
    setAuto(other, value === null ? null : implied);
  }

  updateRowStates();
}

/** Every score field in the dialog, in the order they are filled in. */
function allScoreInputs() {
  return Array.from($("#score-dialog").querySelectorAll(".score-input"));
}

function focusInput(input) {
  input.focus({ preventScroll: true });
  input.select();
}

/** Focus the first score still to be typed from `startIndex` on, else Save. */
function focusFrom(startIndex) {
  const inputs = allScoreInputs();
  for (let i = startIndex; i < inputs.length; i += 1) {
    if (!inputs[i].disabled && inputs[i].value.trim() === "") {
      focusInput(inputs[i]);
      return;
    }
  }
  const dialog = $("#score-dialog");
  const primary = dialog.querySelector('[data-dialog="save-next"]') || dialog.querySelector('[data-dialog="save"]');
  if (primary) primary.focus({ preventScroll: true });
}

/**
 * Enter says "that score is finished". A settled set moves on to the next one;
 * a half-typed set moves to the score still missing; and a set that cannot
 * have happened stays put, so the score can be corrected where it went wrong.
 */
function advanceFrom(input) {
  const { pointsPerSet } = state.tournament.settings;
  const row = input.closest(".setrow");
  const rows = Array.from($("#score-dialog").querySelectorAll(".setrow"));
  const [left, right] = rowInputs(row);
  const a = inputValue(left);
  const b = inputValue(right);
  const inputs = allScoreInputs();

  if (a !== null && b !== null) {
    if (!model.isValidSet(a, b, pointsPerSet)) return; // not a score that can happen
    focusFrom((rows.indexOf(row) + 1) * 2);
    return;
  }
  focusFrom(inputs.indexOf(input) + 1);
}

/**
 * Sets after the one that decided the match are not played, so they are dimmed
 * and locked - unless they already hold a score, which must stay fixable.
 */
function updateRowStates() {
  const settings = state.tournament.settings;
  const target = model.setsToWin(settings.bestOf);
  const rows = Array.from($("#score-dialog").querySelectorAll(".setrow"));
  const wins = [0, 0];
  let decidedAt = -1;

  rows.forEach((row, index) => {
    if (decidedAt !== -1) return;
    const [a, b] = rowInputs(row).map(inputValue);
    if (a === null || b === null || a === b) return;
    if (a > b) wins[0] += 1;
    else wins[1] += 1;
    if (wins[0] >= target || wins[1] >= target) decidedAt = index;
  });

  rows.forEach((row, index) => {
    const inputs = rowInputs(row);
    const empty = inputs.every((input) => input.value.trim() === "");
    const spent = decidedAt !== -1 && index > decidedAt;
    row.classList.toggle("is-inactive", spent && empty);
    inputs.forEach((input) => {
      input.disabled = spent && empty;
    });
  });
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
    status.textContent = t("Enter the points for each set.");
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
  if (!match) return null;
  const winner = result.winnerSide === 0 ? match.p1 : match.p2;
  status.textContent = t("{player} wins {won}–{lost}", {
    player: model.playerName(state.tournament, winner),
    won: Math.max(...result.setWins),
    lost: Math.min(...result.setWins),
  });
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
    if (!event.target.classList.contains("score-input")) return;
    handleScoreInput(event.target);
    validateDialog();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const active = document.activeElement;
    if (active && active.tagName === "BUTTON") return; // let the button fire itself
    event.preventDefault();
    if (!active || !active.classList.contains("score-input")) {
      primaryAction();
      return;
    }
    if (settings.get().autoAdvance) advanceFrom(active);
  });

  on(dialog, "click", "[data-dialog]", (event, target) => {
    const action = target.dataset.dialog;
    if (action === "cancel") closeDialog();
    if (action === "save") saveDialog();
    if (action === "save-next") saveDialog({ goNext: true });
    if (action === "clear") {
      model.clearResult(state.tournament, dialogMatchId);
      save();
      closeDialog();
      render();
      toast(t("Result cleared"));
    }
    if (action === "walkover") {
      const result = model.recordWalkover(state.tournament, dialogMatchId, target.dataset.winner);
      if (!result.ok) return toast(result.error, "error");
      save();
      closeDialog();
      render();
      toast(t("Walkover recorded"));
    }
  });

  // close() fires this from a queued task, by which point saving-and-next may
  // already have opened the following match. Only forget the match if the
  // dialog really is closed.
  dialog.addEventListener("close", () => {
    if (!dialog.open) dialogMatchId = null;
  });
}

function saveDialog({ goNext = false } = {}) {
  const result = validateDialog();
  if (!result) {
    toast(t("That score is not a complete, legal result yet."), "error");
    return;
  }
  const outcome = model.recordResult(state.tournament, dialogMatchId, readDialogSets());
  if (!outcome.ok) return toast(outcome.error, "error");
  save();
  const next = goNext ? nextPlayable(dialogMatchId) : null;
  closeDialog();
  render();
  if (next) openScoreDialog(next.id);
  else toast(t("Result saved"));
}

/** Enter on a filled-in match does whatever the primary button says. */
function primaryAction() {
  const dialog = $("#score-dialog");
  const button = dialog.querySelector('[data-dialog="save-next"]') || dialog.querySelector('[data-dialog="save"]');
  saveDialog({ goNext: !!(button && button.dataset.dialog === "save-next") });
}

/* ------------------------------------------------------------------ *
 * Settings dialog
 * ------------------------------------------------------------------ */

function choiceRow(name, value, options) {
  return options
    .map(
      (option) => `<label class="seg${option.id === value ? " is-active" : ""}">
        <input type="radio" name="${name}" value="${option.id}" ${option.id === value ? "checked" : ""} />
        <span>${esc(t(option.label))}</span>
      </label>`
    )
    .join("");
}

function switchRow(key, label, checked, note = "") {
  return `<label class="switch">
    <input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""} />
    <span>
      ${esc(t(label))}
      ${note ? `<small>${esc(t(note))}</small>` : ""}
    </span>
  </label>`;
}

export function openSettingsDialog() {
  const dialog = $("#settings-dialog");
  const now = settings.get();

  dialog.innerHTML = html`<form method="dialog">
    <header class="dialog__head">
      <h2>${t("Settings")}</h2>
    </header>
    <div class="dialog__body">
      <section class="setting">
        <h3>${t("Language")}</h3>
        <div class="segmented" data-setting="language">
          ${raw(choiceRow("language", now.language, LANGUAGES))}
        </div>
        ${raw(
          now.language === "auto"
            ? `<p class="hint">${esc(
                t("Following the browser: {language}", {
                  language: t(currentLanguage() === "sv" ? "Swedish" : "English"),
                })
              )}</p>`
            : ""
        )}
      </section>

      <section class="setting">
        <h3>${t("View")}</h3>
        <div class="segmented" data-setting="density">
          ${raw(
            choiceRow("density", now.density, [
              { id: "compact", label: "Power user" },
              { id: "comfortable", label: "Standard" },
            ])
          )}
        </div>
        <p class="hint">${t("Power user packs more on screen. Standard gives everything more room.")}</p>
      </section>

      <section class="setting">
        <h3>${t("Score entry")}</h3>
        ${raw(switchRow("autoFill", "Fill in the score the rules imply", now.autoFill))}
        ${raw(switchRow("autoAdvance", "Enter moves on to the next score", now.autoAdvance))}
        ${raw(
          switchRow(
            "chainNext",
            "Open the next unplayed match after saving",
            now.chainNext,
            "Matches are often reported out of order, so this is off by default."
          )
        )}
      </section>
    </div>
    <footer class="dialog__foot">
      <span class="muted">v${APP_VERSION}</span>
      <button type="button" class="btn btn--primary" data-settings="close">${t("Done")}</button>
    </footer>
  </form>`;

  if (!dialog.open) dialog.showModal();
}

function wireSettingsDialog() {
  const dialog = $("#settings-dialog");

  dialog.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.setting) {
      settings.set({ [target.dataset.setting]: target.checked });
    } else if (target.name === "language" || target.name === "density") {
      settings.set({ [target.name]: target.value });
    } else {
      return;
    }
    openSettingsDialog(); // redraw in the new language and spacing
    render();
  });

  on(dialog, "click", "[data-settings]", () => {
    if (dialog.open) dialog.close();
    render();
  });
}

/* ------------------------------------------------------------------ *
 * Global events
 * ------------------------------------------------------------------ */

function wireGlobal() {
  const app = $("#app");

  on(app, "click", "[data-action]", (event, target) => {
    const action = target.dataset.action;
    const menu = target.closest("details.menu");
    if (menu) menu.removeAttribute("open");
    const view = VIEWS[state.view];
    if (action === "score") {
      openScoreDialog(target.dataset.match);
      return;
    }
    if (action === "export") {
      download(`${slugify(state.tournament.name)}.json`, store.exportJSON(state.tournament));
      return;
    }
    if (action === "show-todo") {
      state.filter = "todo";
      state.groupFilter = "all";
      state.search = "";
      navigate(`#/t/${state.tournament.id}/matches`);
      return;
    }
    if (action === "settings") {
      openSettingsDialog();
      return;
    }
    if (action === "duplicate-current") {
      const copy = store.duplicate(state.tournament);
      navigate(`#/t/${copy.id}/setup`);
      toast(t("Copy created"));
      return;
    }
    if (action === "delete-current") {
      const name = state.tournament.name;
      if (!confirm(t("Delete “{name}” and all its scores? This cannot be undone.", { name }))) return;
      store.remove(state.tournament.id);
      state.tournament = null;
      navigate("#/");
      toast(t("Tournament deleted"));
      return;
    }
    if (state.view === "home") {
      home.handle(action, target, event);
      return;
    }
    if (view && view.handle) view.handle(action, target, event);
  });

  // Whole match cards and bracket nodes open the score dialog.
  on(app, "click", ".bnode[data-match], .match[data-match]", (event, target) => {
    if (event.target.closest("[data-action]")) return;
    openScoreDialog(target.dataset.match);
  });

  on(app, "keydown", ".match[data-match], .bnode[data-match]", (event, target) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openScoreDialog(target.dataset.match);
  });

  document.addEventListener("click", (event) => {
    $$("details.menu[open]").forEach((open) => {
      if (!open.contains(event.target)) open.removeAttribute("open");
    });
  });

  on(app, "input", "input[type=text], input[type=date], input[type=number], textarea", (event, target) => {
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
  if (choice && choice.outcome === "accepted") toast(t("Installed — look for TT Manager on your home screen"));
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

  // A worker taking over a page that already had one means a new version is in
  // charge, and the running code is now older than the files being served.
  // Reload once so a bumped version lands without closing the app - but never
  // in the middle of typing a score.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const dialog = $("#score-dialog");
    if (!hadController || reloading || (dialog && dialog.open)) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", () => {
    // The version in the URL makes a new release a different script to the
    // browser, so the update is picked up even where imported scripts are not
    // part of the update check.
    const url = new URL("../sw.js", import.meta.url);
    url.searchParams.set("v", APP_VERSION);
    navigator.serviceWorker.register(url, { scope: "./" }).catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

settings.load();
wireGlobal();
wireDialog();
wireSettingsDialog();
watchInstall();
render();
registerServiceWorker();
