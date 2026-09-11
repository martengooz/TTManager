/*
 * Where OpenCV lives, and whether this browser can run it.
 *
 * The build in vendor/ is not the one OpenCV ships. That one is ten megabytes
 * and contains deep learning, video tracking, feature matching and photography
 * - none of which reads a sheet of paper. This one is compiled from the same
 * source with tools/opencv_js.config.py as its whitelist, which is core,
 * imgproc and the QR detector and nothing else, and with SIMD turned on. It
 * comes to 2.7 MB, of which the 2.6 MB of WebAssembly streams and compiles as
 * it downloads instead of arriving base64'd inside the JavaScript.
 *
 * It is still not in the service worker's install list: an organiser who never
 * scans a card should not carry it. The first scan fetches it, the service
 * worker keeps both files, and every scan after that works offline.
 *
 * The file names carry the version. Bumping them is what invalidates the
 * cached copies, the same trick version.js plays for the app itself.
 */

export const OPENCV_URL = "vendor/opencv-4.9.0-simd.js";
export const OPENCV_WASM_URL = "vendor/opencv-4.9.0-simd.wasm";

/** Roughly what the pair weighs, so the screen can warn before it starts. */
export const OPENCV_MB = 2.7;

/*
 * Whether the browser can run the build at all.
 *
 * SIMD is what makes it worth compiling ourselves, and it is not universal:
 * Safari only gained it in 16.4. Without this check the failure is the wasm
 * refusing to instantiate, which surfaces as an unexplained error at the
 * moment someone points a camera at a card. These bytes are a module whose
 * body uses a v128 instruction and nothing else, so validating them asks the
 * engine the question directly.
 */
const SIMD_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
  10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function hasSimd() {
  try {
    return WebAssembly.validate(SIMD_MODULE);
  } catch {
    return false;
  }
}

/** True once both files are in the cache, so the screen can say so up front. */
export async function isOpenCvCached() {
  if (!globalThis.caches) return false;
  try {
    const here = globalThis.location ? globalThis.location.href : "";
    const hits = await Promise.all(
      [OPENCV_URL, OPENCV_WASM_URL].map((path) => caches.match(new URL(path, here).href))
    );
    return hits.every(Boolean);
  } catch {
    return false;
  }
}
