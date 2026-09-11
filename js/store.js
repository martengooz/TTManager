/* Persistence: every tournament lives in localStorage, so the app works offline. */
import { refresh } from "./model.js";

const KEY = "ttmanager.v1";
const SEQ_KEY = "ttmanager.seq";

/*
 * Tournaments carry a small sequential number as well as their id: the printed
 * scorecard encodes it in one byte, so it runs 1-255 and then wraps. Two live
 * tournaments sharing a number would share a scorecard code, which only matters
 * for an instance that has created 255 of them.
 */
function nextNumber() {
  try {
    const used = new Set(readAll().map((t) => t.no));
    let next = (Number(localStorage.getItem(SEQ_KEY)) || 0) + 1;
    for (let tries = 0; tries < 255 && (next > 255 || used.has(next)); tries += 1) {
      next = next > 255 ? 1 : next + 1;
    }
    localStorage.setItem(SEQ_KEY, String(next));
    return next;
  } catch (error) {
    return 1;
  }
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Could not read saved tournaments", error);
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (error) {
    console.error("Could not save", error);
    alert("Saving failed — the browser storage may be full or blocked.");
    return false;
  }
}

export function list() {
  return readAll().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function get(id) {
  const found = readAll().find((t) => t.id === id);
  return found ? refresh(found) : null;
}

export function save(tournament) {
  tournament.updatedAt = new Date().toISOString();
  if (!tournament.no) tournament.no = nextNumber();
  const all = readAll();
  const index = all.findIndex((t) => t.id === tournament.id);
  if (index >= 0) all[index] = tournament;
  else all.push(tournament);
  writeAll(all);
  return tournament;
}

export function remove(id) {
  writeAll(readAll().filter((t) => t.id !== id));
}

export function duplicate(tournament) {
  const copy = JSON.parse(JSON.stringify(tournament));
  copy.id = `t_${Math.random().toString(36).slice(2, 10)}`;
  copy.no = null; // a copy is its own tournament, with its own printed code
  copy.name = `${tournament.name} (copy)`;
  copy.createdAt = new Date().toISOString();
  return save(copy);
}

export function exportJSON(tournament) {
  return JSON.stringify(tournament, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : [data];
  const all = readAll();
  const imported = [];
  incoming.forEach((tournament) => {
    if (!tournament || !tournament.name || !Array.isArray(tournament.players)) {
      throw new Error("That file does not look like a TT Manager tournament.");
    }
    if (all.some((t) => t.id === tournament.id)) {
      tournament.id = `t_${Math.random().toString(36).slice(2, 10)}`;
      tournament.name = `${tournament.name} (imported)`;
    }
    if (!tournament.no || all.some((t) => t.no === tournament.no)) tournament.no = nextNumber();
    all.push(tournament);
    imported.push(tournament);
  });
  writeAll(all);
  return imported;
}
