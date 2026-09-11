/*
 * Reading a filled-in scorecard with the phone's camera.
 *
 * The organiser is holding a card an umpire just handed them. The quickest
 * thing they can do with it is point the phone at it, so this screen is a
 * viewfinder that keeps trying by itself, and the tap is only there for when
 * they would rather decide the moment.
 *
 * What comes back is never saved without being shown. The reader is good but
 * it is not certain, and a wrong score saved silently is worse than no reader
 * at all - so the sets it read are laid out as ordinary editable fields, the
 * ones it is unsure of are marked, and saving is a deliberate act.
 */
import * as model from "../model.js";
import { html, raw, esc } from "../util.js";
import { t } from "../i18n.js";
import { state, rerenderView, save, toast, navigate } from "../app.js";
import { sideName } from "../components.js";
import { loadOpenCv, isOpenCvCached, OPENCV_MB } from "../scan/opencv.js";
import { readScorecard, SURE_ENOUGH } from "../scan/read.js";
import * as store from "../store.js";

/* Everything this screen remembers between redraws. The camera stream is kept
   out of the DOM on purpose: the app re-renders screens wholesale, so the
   video element is thrown away and rebuilt, and the stream has to survive. */
const view = {
  stage: "start", // start | loading | camera | review | failed
  cached: false,
  stream: null,
  reading: null,
  sets: [],
  problem: "",
};

let cv = null;
let loop = null;

const WHY = {
  anchors: "No card in view. Get all four corner marks in the frame.",
  boxes: "The score table was not clear enough to read. Try again with more light.",
  code: "The code on the card could not be read. Move a little closer.",
  unknown: "That card belongs to a different tournament.",
  blank: "Nothing is written on that card yet.",
  illegal: "The scores on that card do not add up to a finished match.",
};

/* ------------------------------------------------------------------ *
 * The camera
 * ------------------------------------------------------------------ */

async function startCamera() {
  try {
    view.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      audio: false,
    });
    view.stage = "camera";
    view.problem = "";
  } catch (error) {
    view.stage = "failed";
    view.problem = t("The camera could not be opened. You can still choose a photo instead.");
  }
  rerenderView();
}

/** Called by the router when this screen is being replaced. */
export function leave() {
  stopCamera();
  view.stage = view.stage === "review" ? "review" : "start";
}

export function stopCamera() {
  if (loop) clearTimeout(loop);
  loop = null;
  if (view.stream) view.stream.getTracks().forEach((track) => track.stop());
  view.stream = null;
}

/** A frame from the preview, no bigger than the reader needs. */
function frameFrom(video) {
  const longest = Math.max(video.videoWidth, video.videoHeight);
  if (!longest) return null;
  const scale = Math.min(1, 1600 / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Tries one frame.
 *
 * The hint is written straight into the DOM rather than through a re-render.
 * Redrawing the screen would take the video element with it, and a viewfinder
 * that blinks once a second is unusable; nothing else on the screen changes
 * until a card is actually read, and then it goes through render like
 * everything else.
 */
function attempt(tour, { fromTap = false } = {}) {
  const video = document.querySelector(".scan__video");
  if (!cv || !video || view.stage !== "camera") return;

  const frame = frameFrom(video);
  if (!frame) return;

  const reading = readScorecard(cv, frame, lookup(tour));
  if (reading.ok) {
    view.reading = reading;
    view.sets = reading.sets.map((set) => [...set]);
    view.stage = "review";
    stopCamera();
    rerenderView();
    return;
  }

  const hint = document.querySelector(".scan__hint");
  if (hint) hint.textContent = t(WHY[reading.reason] || "Hold the whole card in the frame.");
  /* A tap is a decision; say why it did not work rather than only hinting. */
  if (fromTap && reading.reason === "unknown") {
    toast(t("That card is from tournament {n}, match {m}.", { n: reading.tournamentNo, m: reading.matchNo }), "error");
  }
}

function scanLoop(tour) {
  if (view.stage !== "camera") return;
  attempt(tour);
  loop = setTimeout(() => scanLoop(tour), 1200);
}

/** Finds the match a card's three bytes point at, in this tournament or another. */
function lookup(tour) {
  return (tournamentNo, matchNo) => {
    const tournament = tour.no === tournamentNo ? tour : store.list().find((other) => other.no === tournamentNo);
    if (!tournament) return null;
    const match = tournament.matches.find((one) => one.no === matchNo && one.status !== "bye");
    return match ? { tournament, match } : null;
  };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function startPanel() {
  return html`<section class="card scan__intro">
    <h2>${t("Scan a scorecard")}</h2>
    <p class="muted">
      ${t("Point the camera at a filled-in umpire card. The code on the sheet says which match it is, and the scores are read from the boxes.")}
    </p>
    ${raw(
      view.cached
        ? ""
        : html`<p class="scan__weight">
            ${t("Reading a card needs an image library of about {mb} MB. It downloads once and then works offline.", { mb: OPENCV_MB })}
          </p>`
    )}
    <div class="scan__actions">
      <button class="btn btn--primary" data-action="scan-start">${t("Start the camera")}</button>
      <label class="btn btn--ghost">
        ${t("Choose a photo")}
        <input type="file" accept="image/*" data-field="scan-file" hidden />
      </label>
    </div>
    ${raw(view.problem ? html`<p class="scan__problem">${view.problem}</p>` : "")}
  </section>`;
}

function cameraPanel() {
  return html`<section class="scan__camera">
    <div class="scan__frame">
      <video class="scan__video" playsinline muted autoplay></video>
      <span class="scan__guide" aria-hidden="true"></span>
    </div>
    <p class="scan__hint">${t("Hold the whole card in the frame.")}</p>
    <div class="scan__actions">
      <button class="btn btn--primary" data-action="scan-shoot">${t("Read this card")}</button>
      <button class="btn btn--ghost" data-action="scan-stop">${t("Stop")}</button>
    </div>
  </section>`;
}

function reviewPanel(tour) {
  const { reading } = view;
  const { tournament, match } = reading;
  const names = [sideName(tournament, match, 1), sideName(tournament, match, 2)];
  const unsure = new Set(reading.unsure);

  const rows = view.sets.map(
    (set, i) => html`<tr class="${raw(unsure.has(i) ? "scanrow scanrow--unsure" : "scanrow")}">
      <th scope="row">${t("Set {n}", { n: i + 1 })}</th>
      <td>
        <input type="number" inputmode="numeric" min="0" max="99" value="${set[0]}" data-field="set" data-set="${i}" data-side="0" />
      </td>
      <td>
        <input type="number" inputmode="numeric" min="0" max="99" value="${set[1]}" data-field="set" data-set="${i}" data-side="1" />
      </td>
      <td class="scanrow__flag">${raw(unsure.has(i) ? t("check") : "")}</td>
    </tr>`
  );

  return html`<section class="card scan__review">
    <h2>${t("Match {n}", { n: match.no })} · ${esc(names[0])} ${t("v")} ${esc(names[1])}</h2>
    <p class="muted">${esc(tournament.name)} · ${model.matchLabel(tournament, match)}</p>

    <table class="scan__sets">
      <thead>
        <tr><th scope="col">${t("Set")}</th><th scope="col">${esc(names[0])}</th><th scope="col">${esc(names[1])}</th><th scope="col"></th></tr>
      </thead>
      <tbody>${raw(rows.join(""))}</tbody>
    </table>

    <p class="scan__status">${esc(statusText(tournament))}</p>

    ${raw(
      reading.totalsAgree === false
        ? html`<p class="scan__problem">${t("The sets won at the foot of the card do not match these scores. Check before saving.")}</p>`
        : ""
    )}
    ${raw(unsure.size ? html`<p class="scan__note">${t("The marked rows were not clear. Check them against the card.")}</p>` : "")}
    ${raw(
      match.winnerId
        ? html`<p class="scan__note">${t("This match already has a result. Saving replaces it.")}</p>`
        : ""
    )}

    <div class="scan__actions">
      <button class="btn btn--primary" data-action="scan-save">${t("Save result")}</button>
      <button class="btn btn--ghost" data-action="scan-again">${t("Scan another")}</button>
    </div>
  </section>`;
}

/** What the sets currently say, or why they are not a result yet. */
function statusText(tournament) {
  const check = model.validateResult(view.sets, tournament.settings);
  if (!check.ok) return check.error;
  const names = [sideName(tournament, view.reading.match, 1), sideName(tournament, view.reading.match, 2)];
  const side = check.winnerSide;
  return t("{player} wins {won}–{lost}", { player: names[side], won: check.setWins[side], lost: check.setWins[1 - side] });
}

/*
 * Editing a row updates the status line in place rather than redrawing the
 * screen, for the same reason the score dialog does: a redraw between typing a
 * correction and tapping Save replaces the button, and the tap lands on
 * nothing. The numbers themselves are already in view.sets by then, so what is
 * saved is always what is on screen.
 */
function refreshStatus() {
  const { tournament } = view.reading;
  const line = document.querySelector(".scan__status");
  if (line) line.textContent = statusText(tournament);
}

export function render(tour) {
  const body =
    view.stage === "camera"
      ? cameraPanel()
      : view.stage === "review" && view.reading
        ? reviewPanel(tour)
        : view.stage === "loading"
          ? html`<section class="card scan__intro">
              <h2>${t("Getting the reader ready")}</h2>
              <p class="muted">${t("This happens once. Afterwards it works with no connection.")}</p>
            </section>`
          : startPanel();

  /* No title in the bar: every panel below already says what this screen is,
     and a second copy of it wraps to two lines on a phone. */
  return html`<div class="scanbar no-print">
      <a class="btn btn--ghost" href="#/t/${tour.id}/matches">← ${t("Back")}</a>
      <span class="scanbar__gap"></span>
      <a class="btn btn--ghost btn--small" href="#/t/${tour.id}/scorecards">${t("Umpire scorecards")}</a>
    </div>
    ${raw(body)}`;
}

export function afterRender(tour) {
  if (view.stage === "start" && !view.cached) {
    isOpenCvCached().then((cached) => {
      if (cached === view.cached) return;
      view.cached = cached;
      if (view.stage === "start") rerenderView();
    });
  }

  const video = document.querySelector(".scan__video");
  if (video && view.stream) {
    video.srcObject = view.stream;
    video.play().catch(() => {});
    if (!loop) scanLoop(tour);
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

async function ready() {
  if (cv) return true;
  view.stage = "loading";
  rerenderView();
  try {
    cv = await loadOpenCv();
    view.cached = true;
    return true;
  } catch (error) {
    view.stage = "failed";
    view.problem = t("The image library could not be loaded. Check the connection and try again.");
    rerenderView();
    return false;
  }
}

export async function handle(action, target) {
  const tour = state.tournament;

  if (action === "scan-start") {
    if (!(await ready())) return;
    await startCamera();
    return;
  }
  if (action === "scan-shoot") {
    attempt(tour, { fromTap: true });
    return;
  }
  if (action === "scan-stop") {
    stopCamera();
    view.stage = "start";
    rerenderView();
    return;
  }
  if (action === "scan-again") {
    view.reading = null;
    view.sets = [];
    if (!(await ready())) return;
    await startCamera();
    return;
  }
  if (action === "scan-save") {
    const { tournament, match } = view.reading;
    const check = model.validateResult(view.sets, tournament.settings);
    if (!check.ok) {
      refreshStatus();
      toast(check.error, "error");
      return;
    }
    const outcome = model.recordResult(tournament, match.id, view.sets);
    if (!outcome.ok) {
      toast(outcome.error, "error");
      return;
    }
    store.save(tournament);
    if (tournament.id === tour.id) state.tournament = tournament;
    view.reading = null;
    view.sets = [];
    view.stage = "start";
    toast(t("Result saved"));
    navigate(`#/t/${tour.id}/matches`);
  }
}

export function change(field, target, event) {
  if (field === "set") {
    const row = Number(target.dataset.set);
    const side = Number(target.dataset.side);
    const value = target.value === "" ? 0 : Number(target.value);
    if (!view.sets[row]) return;
    view.sets[row][side] = Number.isFinite(value) ? value : 0;
    /* An edited row is one the organiser has looked at, so it stops being
       marked - but the mark only leaves once they are done with the field. */
    if (view.reading && event && event.type === "change") {
      view.reading.unsure = view.reading.unsure.filter((i) => i !== row);
      const tr = target.closest(".scanrow");
      if (tr) {
        tr.classList.remove("scanrow--unsure");
        const flag = tr.querySelector(".scanrow__flag");
        if (flag) flag.textContent = "";
      }
    }
    refreshStatus();
    return;
  }
  if (field === "scan-file") {
    const file = target.files && target.files[0];
    if (!file) return;
    readFile(file);
  }
}

async function readFile(file) {
  if (!(await ready())) return;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("image"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

    const reading = readScorecard(cv, canvas, lookup(state.tournament));
    if (reading.ok) {
      view.reading = reading;
      view.sets = reading.sets.map((set) => [...set]);
      view.stage = "review";
      view.problem = "";
    } else {
      view.stage = "failed";
      view.problem = t(WHY[reading.reason] || "That photo could not be read.");
    }
  } catch (error) {
    view.stage = "failed";
    view.problem = t("That photo could not be opened.");
  } finally {
    URL.revokeObjectURL(url);
    rerenderView();
  }
}
