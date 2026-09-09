/* Persistence: every tournament lives in localStorage, so the app works offline. */
import { refresh } from "./model.js";

const KEY = "ttmanager.v1";

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
    all.push(tournament);
    imported.push(tournament);
  });
  writeAll(all);
  return imported;
}
