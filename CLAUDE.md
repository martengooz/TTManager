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
| `js/views/` | one module per screen; `print.js`, `scorecards.js` and `scan.js` render without app chrome |
| `js/scan/` | reading a filled-in scorecard back: OpenCV pipeline, digit classifier, rules |
| `vendor/` | OpenCV, built for this app, loaded only when a card is scanned |
| `tools/` | how the two generated things are generated; nothing the app loads |
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

## The scorecard code

`js/qr.js` is a QR encoder written for this app: byte mode, error correction level Q, versions
1 to 10. A scorecard encodes three bytes — one of tournament number, two of match number — which
keeps the symbol at version 1, so its modules stay large enough to survive a phone photo.

Those numbers are why tournaments and matches carry a sequential `no` alongside their id:
`store.save` hands out tournament numbers 1-255 from a counter, and `model.numberMatches` numbers
the playable matches in draw order. The match number is also what the app shows as `#12`, so the
two can never disagree.

If the encoder is ever changed, verify it by encoding, rendering and decoding with an independent
decoder. Comparing modules against another encoder is not enough on its own: a reference encoder
may quietly raise the error correction level when there is room in the symbol, which makes a
correct symbol look wrong.

## Reading a card back

`js/scan/` turns a photograph of a filled-in card into a result. Four steps, kept
apart because each is worth being able to test on its own:

| Module | Knows about |
| --- | --- |
| `card.js` | paper and lenses: finds the corner marks, squares the card up, decodes the QR, finds the ruled boxes, cuts out each digit |
| `digits.js` | handwriting: a small convolutional network, weights in `digit-model.js` |
| `reconcile.js` | table tennis: picks the most likely reading the rules of the game allow |
| `read.js` | which tournament and match the card belongs to |

It all runs in `worker.js`, a module worker, with `reader.js` as the page's end
of it. Nothing under `js/scan/` may touch the DOM: a frame arrives as raw RGBA
bytes and leaves as numbers. That is also why the frame buffer is passed as a
transfer and handed back with the answer - a scanning session allocates one
buffer, not one a second - and why the full-frame Mats live in `card.js`'s
`scratch` between frames instead of being reallocated.

Three things are worth knowing before changing any of it.

**The rules do most of the work, and they do it by proposing rather than
checking.** `reconcile.js` does not read the boxes and then test whether the
answer is legal. It enumerates every score a set can legally end on - there are
only a few dozen - asks the ink what it thinks of each, and searches for the
most likely reading of the whole card. That is what lets it repair a box
outright. A card reading 4-11, 6-11, 16-16, 9-11 is impossible as written; had
the second player won the third set the match would have ended there at 0-3, and
yet a fourth set was played, so the first player won it and it was 18-16 or
16-14. Nothing about that reasoning is available to a classifier looking at one
box, so nothing downstream of the classifier may collapse a distribution to its
best guess - `digits.js` hands over per-digit distributions for exactly this
reason.

**Which is why the model ships a confusion matrix.** Choosing between 18-16 and
16-14 is choosing whether a 6 was really an 8 or a 4, and a softmax is not
entitled to an opinion at that end of its range - shown a clear 6 it will say
0.9997 and leave noise for everything else. `CONFUSION` in `digit-model.js` is
what the network is measured to do with augmented digits, and `MEASURED_SHARE`
of every distribution comes from it.

**It is never certain, so it never saves silently.** Every row comes back with a
confidence; rows below `SURE_ENOUGH` are marked, and rows the rules had to
reconstruct are marked differently and say what the card appeared to read,
because those are two different claims. Keep that property: a wrong score saved
without anyone noticing is worse than a reader that admits it is stuck.

The regression baselines are sixty synthesised photographs of a card filling
the frame, and six of a whole A4 sheet held at arm's length, which is how a
printed protocol actually reaches a camera. Both use real handwritten digits
composited into a rendered card and put through perspective, shadow, blur,
noise and JPEG. They currently read 57/60 and 6/6. Treat those as a baseline to
not regress rather than as a promise: synthesised cards are not photographs of
real ones, and the first six real photographs taken of a printed card found
three separate failures that sixty synthetic ones had not.

**Finding the card is the hard part, not reading it.** Every real-world failure
so far has been the reader not finding the card, or squaring up the wrong
rectangle; once a card is square and in focus the digits and the rules take
care of themselves. Three things came out of the first photographs of a real
printed card:

- The corner marks had to grow from 4mm to 8mm. At 4mm on a whole sheet held at
  arm's length they are under twenty pixels, and the two at the far corners of
  a sheet lit from one side come out grey on grey.
- A local threshold's window has to be comfortably larger than the mark it is
  looking for, or the middle of the mark reads as paper and what is found is a
  hollow ring - hence `ANCHOR_WINDOW_MM`.
- Four marks at the corners of a rectangle look identical upside down, and no
  geometry distinguishes them. The QR code does, because it only decodes one
  way up.

Two more came out of the first photographs of a card with the larger marks, and
both are about the digits rather than the card:

- `digitsIn` insets the crop sideways but barely at top and bottom. A box's
  side rules are tall and thin, which is the shape of a 1, so they have to go;
  its top and bottom rules are wide and thin, which nothing is, and the
  component filter drops them anyway. Insetting all four sides equally cut a
  tenth off each end of the box, and what lives there is the serif along the
  foot of a European 1 - the one mark distinguishing it from a 7. That did not
  make the 1 hard to read, it made it *be* a 7.
- MNIST was collected in the United States, where a 1 is a bare vertical. A
  Swedish umpire writes it with a flag up to the left and a serif along the
  foot, and often crosses a 7. `continentalise` in the training script draws
  those on, and draws the flag and the serif together most of the time -
  separately, the network sees a stem with a serif and calls it the bottom of a
  2, which is a fair reading of what it was shown.

`vendor/` holds an OpenCV built for this app rather than the one OpenCV ships -
see `tools/README.md` for what is in it and how to rebuild it. It is 4.0 MB
instead of 10.3 MB, and it is still kept out of the service worker's install
list: it is fetched the first time someone scans and cached from there. Three
things about loading it have already cost an afternoon each:

- It must be loaded by URL, not fetched into a buffer first. Holding ten
  megabytes of JavaScript in the heap while the browser decodes and compiles it
  runs the renderer out of memory.
- Importing it leaves a *promise* in `globalThis.cv`, and OpenCV's own helpers
  reach for that global when they build a Mat, so the worker rebinds it to what
  it resolved to.
- It is built with SIMD, which Safari only gained in 16.4. `hasSimd()` asks the
  engine directly by validating a module that uses a v128 instruction, so an old
  phone gets a sentence explaining itself rather than a wasm that will not
  instantiate.

## Two printed things, for different readers

`print.js` is the tournament record: results, tables, bracket, placings — read after the fact.
`scorecards.js` is a blank form the umpire writes on at the table and hands back, so it is
built for ink: black on white, ruled boxes, no fills, one match to a sheet. Neither renders the
topbar, so both carry their own back link, and neither should gain screen-only ornament.

`#/t/<id>/scorecards/<match number>` renders a single card and prints it — that is where the
printer button on a match card leads. The card is drawn at its real size in millimetres, wider
than a phone, so the preview is zoomed to fit on screen and printed at full size.

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
