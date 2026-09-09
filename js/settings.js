/* App-wide preferences, kept apart from tournament data. */
import { setLanguage } from "./i18n.js";

const KEY = "ttmanager.settings";

const DEFAULTS = {
  language: "auto",
  density: "compact", // compact = power user, comfortable = standard
  autoFill: true, // fill in the score the rules imply
  autoAdvance: true, // jump to the next field once a set is settled
  chainNext: false, // open the next unplayed match after saving
};

let current = { ...DEFAULTS };

export function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    current = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch (error) {
    current = { ...DEFAULTS };
  }
  apply();
  return current;
}

export function get() {
  return current;
}

export function set(patch) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch (error) {
    console.warn("Could not save settings", error);
  }
  apply();
  return current;
}

/** Pushes the preferences onto the document: language and spacing. */
function apply() {
  setLanguage(current.language);
  document.body.dataset.density = current.density;
}
