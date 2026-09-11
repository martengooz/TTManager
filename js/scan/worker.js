/*
 * The scorecard reader, off the main thread.
 *
 * Reading a card is around half a second of solid arithmetic. On the main
 * thread that is half a second in which the viewfinder stops moving and taps
 * do nothing, once a second, which makes the screen feel broken at exactly the
 * moment the organiser is trying to hold a card steady. In here it costs the
 * page nothing.
 *
 * This is a module worker so it can import the same pipeline the tests import.
 * OpenCV is a UMD script rather than a module, but it is built here with a
 * wrapper that finds the global either way, so a plain import runs it and
 * leaves `globalThis.cv` holding the promise it resolves to.
 */
import { readScorecard } from "./read.js";
import { release } from "./card.js";
import { OPENCV_URL, OPENCV_WASM_URL } from "./opencv.js";

let cv = null;

async function ready() {
  if (cv) return cv;
  const base = new URL("../../", import.meta.url);
  /* The glue asks for its wasm by bare name; say where it actually lives, or
     it looks beside this worker instead. */
  globalThis.Module = { locateFile: () => new URL(OPENCV_WASM_URL, base).href };
  await import(new URL(OPENCV_URL, base).href);
  /*
   * Importing it leaves a promise in the global, not the module. Awaiting that
   * gives the module - but OpenCV's own JavaScript helpers, matFromArray among
   * them, reach for the global `cv` when they need to build a Mat, and a
   * promise has no Mat on it. So the global is rebound to what it resolved to,
   * which is what the helpers were written expecting.
   */
  cv = await globalThis.cv;
  globalThis.cv = cv;
  return cv;
}

self.onmessage = async (event) => {
  const { id, type, frame, tournaments } = event.data;
  try {
    if (type === "warm") {
      await ready();
      self.postMessage({ id, ok: true });
      return;
    }
    if (type === "read") {
      const namespace = await ready();
      const reading = readScorecard(namespace, frame, tournaments);
      /* The frame's buffer came across as a transfer and is ours to hand back,
         so the page can fill it again rather than allocate another one. */
      self.postMessage({ id, ok: true, reading, buffer: frame.data.buffer }, [frame.data.buffer]);
      return;
    }
    if (type === "release") {
      release();
      self.postMessage({ id, ok: true });
      return;
    }
    self.postMessage({ id, ok: false, error: `unknown request ${type}` });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
