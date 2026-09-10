# TT Manager

A small, offline-first web app for running a table tennis tournament: set it up, record
every score as the matches are played, and print the whole thing — tables, results grids,
bracket and final placings — on one sheet.

No build step, no dependencies, no back end. It is plain HTML, CSS and ES modules, so you
can host the folder anywhere static (GitHub Pages, a USB stick, a laptop in the hall).

## What it does

**Set up a tournament**
- Three formats: round robin, groups + knockout, or a straight knockout bracket.
- Match length from best of 1 to best of 9, at 11 or 21 points a set.
- Players go into one field: type a name, add a club after a comma, or paste a whole list and
  add it in one go. Names can be corrected in place afterwards without disturbing the draw.
- A new tournament starts from the last one's format and rules, since a club runs the same
  shape of event week after week.
- The draw distributes players across groups snake-style, builds every group schedule with
  the circle method, and seeds the bracket so players from the same group meet as late as
  possible. Byes are handled automatically.

**Record scores**
- Enter set scores in a dialog that checks them against the real rules: a set ends at 11
  (or 21) with a two point margin, or by exactly two after deuce, and a match stops as soon
  as someone has enough sets. Illegal or incomplete scores are explained, not silently saved.
- Type as little as the score allows. A losing score settles the set on its own, so typing `5`
  fills in `11` opposite it and `10` fills in `12`. Only a score of the target or above is
  genuinely ambiguous — 12 could be 12-10 or 14-12 — so those wait for you to type the other side.
- Enter is what moves on, never the typing itself: a digit can always be the start of a longer
  number. Enter on a settled set goes to the next set, on a half-typed one goes to the score
  still missing, and on a score that could not have happened — 22-2, say — stays where it is so
  you can correct it. Sets after the one that decided the match grey out, and once the result is
  complete Enter lands on *Save result*.
- Walkovers, editing and clearing a result are all one click.
- Tap anywhere on a match card to open it. The count in the header is a button too — it shows
  what is still to play.
- Group tables update immediately, and knockout places fill in as soon as a group finishes
  or a match is decided.

**See where it stands**
- Standings rank by table points (2 for a win, 1 for a loss, 0 for a walkover loss), then a
  mini league between the tied players, then set ratio, then point ratio — the usual ITTF order.
- A results grid per group, a bracket you can score straight from, and the final placings
  including the third place match.

**Print it**
- The print screen composes the whole tournament into one document: header, player list,
  every group table, results grid and match score, the knockout results, the bracket and the
  podium. Tick the sections you want, then print or save as PDF.
- `Ctrl/Cmd + P` from any screen jumps to that sheet and opens the print dialog.

**Fit it to how you work**
- **Language** — English and Swedish, following the browser unless you pick one in *Settings*.
- **View** — *Power user* packs as much on screen as it can; *Standard* gives everything more room.
- **Score entry** — the implied score and the jump to the next field can each be turned off, and
  opening the next unplayed match after saving can be turned on. That last one is off by default,
  because results come back from the tables in whatever order the matches finish.
- **Finding a match** — the matches screen has a search box: a few letters of a player's name, or a
  match number, narrows the list to the result you have in your hand.

**Work anywhere**
- Everything is saved in the browser's local storage as you go, so closing the tab loses nothing.
- A service worker caches the app, so it keeps working with no connection. Install it from the
  browser menu (or the *Install app* button) to run it full screen from the home screen.
- Export any tournament as JSON to back it up or move it to another device, and import it back.

## Running it

Because it uses ES modules and a service worker, open it over HTTP rather than `file://`:

```sh
npx http-server . -p 8080     # or: python3 -m http.server 8080
```

Then visit <http://localhost:8080>.

It is published with GitHub Pages: in **Settings → Pages**, set *Source* to **GitHub Actions**.
After that every push to `main` deploys the repository root through `.github/workflows/pages.yml`.
The app uses only relative paths, so it works from the `/TTManager/` subpath just as it does from
a domain root.

## Versioning

`version.js` holds the app version and every change bumps it:

```js
self.APP_VERSION = "1.1.0";
```

The service worker names its cache after it, so the new number is what tells an installed copy
to fetch the new files rather than serve the cached ones — without it a change can look like it
never shipped. The version also goes into the service worker's registration URL, so a release is
a new script to the browser, and it is printed in the start screen footer so you can see what a
phone is actually running.

## Layout

```
index.html              app shell
styles.css              everything visual, including the print sheet
manifest.webmanifest    PWA metadata
version.js              the app version, read by the page and by the service worker
sw.js                   offline cache, named after the version
js/i18n.js              translations; keys are the English strings themselves
js/settings.js          language, view density and score entry preferences
js/model.js             draw, schedule, scoring rules, standings, bracket
js/store.js             local storage, export and import
js/components.js        shared rendering: match cards, tables, bracket, podium
js/app.js               router, shared state, score dialog
js/views/               one module per screen
```

The model has no DOM dependencies, so the tournament logic can be exercised straight from
Node if you want to check a format or a tie-break by hand.
