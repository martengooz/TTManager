# TT Manager

A static, offline-first PWA for running table tennis tournaments. Plain HTML, CSS and ES
modules served as they are — no build step, no dependencies, no back end. Open it over HTTP
(`npx http-server . -p 8080`), not `file://`, or the modules and service worker will not load.

## Bump the version on every change

`version.js` holds `self.APP_VERSION`, and it is the one thing that must change in every
commit that touches a file the service worker caches — which is every app file.

```js
self.APP_VERSION = "1.1.0";
```

The service worker names its cache after it (`ttmanager-${APP_VERSION}`), so a new number is
what makes installed copies fetch the new files; leave it alone and phones keep serving the
old app from cache, and the change looks like it never shipped. The version is also part of
the service worker's registration URL, so the browser sees a new release as a new script.

Patch bump for a fix, minor for a feature, and say the new number in the commit message. It
shows in the start screen footer, so you can check what a phone is actually running.

## Layout

| Path | Holds |
| --- | --- |
| `index.html`, `styles.css` | app shell, and everything visual including the print sheet |
| `version.js` | the version, loaded by the page and by `sw.js` |
| `js/i18n.js` | translations, keyed by the English string |
| `js/settings.js` | language, view density, score entry preferences |
| `js/model.js` | draw, schedules, scoring rules, standings, bracket — no DOM dependencies |
| `js/store.js` | local storage, export and import |
| `js/components.js` | shared rendering: match cards, tables, bracket, podium |
| `js/app.js` | router, shared state, score dialog |
| `js/views/` | one module per screen |
| `sw.js` | offline cache |

## Built for one-handed use at the table

The organiser is standing in a hall with a phone, entering a finished match between points of
the next one. That governs the interface: the topbar is one row plus tabs, screens stay dense
enough to show a useful number of matches at once, whole match cards are tap targets rather
than buttons inside them, and the score dialog chains into the next match. Anything added here
should cost a tap, not a trip back to a list.

## Translations

`js/i18n.js` keys every string by its English text, so `t("Enter score")` reads as itself and an
untranslated key still renders correctly. Placeholders are `{named}`. Adding a language means
adding a dictionary and an entry in `LANGUAGES`; adding a string means calling `t()` and putting
the Swedish in `SV`.

Two traps. Views take the tournament as a parameter, so never name that parameter `t` — it
shadows the translator. And never store translated text in tournament data: groups keep a
`letter` and knockout rounds their round index, and `groupName()` / `matchLabel()` turn those
into words at render time, so switching language re-labels saved tournaments too.

## Worth knowing

- `js/model.js` never touches the DOM, so tournament logic can be exercised straight from
  Node — useful for checking a tie-break, a bye or a bracket seeding by hand.
- Screens re-render wholesale. `render()` keeps the scroll offset when redrawing the screen
  you are already on and only jumps to the top when the route changes, so in-place updates
  must go through it rather than patching the DOM.
- Scoring rules live in `isValidSet` and `validateResult`. A set ends at the target with a
  two point margin, or by exactly two after deuce; the score dialog fills in whatever those
  rules already determine.
- Typing in the score dialog never moves the focus — any digit can be the start of a longer
  number, so guessing when a score is finished always gets some entry wrong. Enter is the
  signal, and `advanceFrom` decides where it goes.
- `.github/workflows/pages.yml` deploys the repository root to GitHub Pages on every push to
  `main`. Pages must be set to the *GitHub Actions* source in the repository settings.
