/*
 * The single source of truth for the app version. Bump it in every change:
 * the service worker names its cache after it, so a new number is what tells
 * an installed copy to fetch the new files instead of serving the old ones.
 *
 * Loaded as a plain script by index.html and by importScripts in sw.js, so it
 * sets a global rather than exporting - `self` is the window in the page and
 * the worker scope in the service worker.
 */
self.APP_VERSION = "1.9.0";
