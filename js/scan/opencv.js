/*
 * Loads OpenCV on demand.
 *
 * The build in vendor/ is ten megabytes, which is more than the rest of the app
 * by two orders of magnitude, so it is deliberately not in the service worker's
 * install list: an organiser who never scans a card never pays for it. The
 * first scan fetches it, the service worker keeps the copy, and every scan
 * after that works offline like the rest of the app.
 *
 * It is loaded with a plain script tag rather than fetched and run from a blob.
 * Fetching it first sounds better - it would give a progress bar - but it holds
 * the whole ten megabytes in the JavaScript heap while the browser is also
 * decoding and compiling it, and the renderer runs out of memory doing it. A
 * script tag streams it, and streaming is also what lets the service worker put
 * it in the cache without a second copy.
 *
 * The file name carries the version. Bumping it is what invalidates the cached
 * copy, the same trick version.js plays for the app itself.
 */

export const OPENCV_URL = "vendor/opencv-4.9.0.js";

/** Roughly what the file weighs, so the screen can warn before it starts. */
export const OPENCV_MB = 10;

let pending = null;

/**
 * Makes the loaded module safe to hand to a promise.
 *
 * Emscripten gives its module object a `then` method, which makes it a
 * thenable: resolving a promise with it does not resolve the promise, it calls
 * that method and waits for whatever comes back. What comes back is the module
 * again, so the promise machinery assimilates it forever and the page stops
 * responding - no error, no crash, just a tab that stops. The method has done
 * its job by the time the runtime is up, so it goes.
 */
function detach(cv) {
  if (typeof cv.then === "function") delete cv.then;
  return cv;
}

/** Resolves with the ready `cv` namespace. */
export function loadOpenCv() {
  if (window.cv && window.cv.Mat) return Promise.resolve(detach(window.cv));
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = OPENCV_URL;
    script.async = true;
    script.onerror = () => reject(new Error("opencv failed to load"));
    script.onload = () => {
      const cv = window.cv;
      if (!cv) {
        reject(new Error("opencv did not register"));
        return;
      }
      /* The script returns before the wasm module has finished starting. */
      if (cv.Mat) {
        resolve(detach(cv));
        return;
      }
      const timer = setTimeout(() => reject(new Error("opencv did not start")), 120000);
      cv.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve(detach(cv));
      };
    };
    document.head.appendChild(script);
  });

  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** True once the file is in the cache, so the screen can say so up front. */
export async function isOpenCvCached() {
  if (window.cv && window.cv.Mat) return true;
  if (!window.caches) return false;
  try {
    return Boolean(await caches.match(new URL(OPENCV_URL, location.href).href));
  } catch {
    return false;
  }
}
