/*
 * The page's end of the scorecard reader.
 *
 * Starts the worker, keeps one request in flight at a time, and hands frames
 * over as transfers so nothing the size of a photograph is ever copied. The
 * worker gives the buffer back with its answer and it is filled again next
 * time, so a scanning session allocates one frame buffer rather than one a
 * second.
 */
import { hasSimd, OPENCV_MB } from "./opencv.js";

export { OPENCV_MB };

let worker = null;
let nextId = 1;
const waiting = new Map();
let spare = null;

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const { id, ok, error, reading, buffer } = event.data;
    const pending = waiting.get(id);
    if (!pending) return;
    waiting.delete(id);
    if (buffer) spare = buffer; // ours again, for the next frame
    if (ok) pending.resolve(reading);
    else pending.reject(new Error(error || "the reader failed"));
  };
  worker.onerror = (event) => {
    const failure = new Error(event.message || "the reader could not start");
    waiting.forEach((pending) => pending.reject(failure));
    waiting.clear();
    /* A worker that failed to start will not start on the next frame either. */
    worker.terminate();
    worker = null;
  };
  return worker;
}

function send(message, transfer) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    ensure().postMessage({ ...message, id }, transfer || []);
  });
}

/** Loads OpenCV in the worker, so the first real frame is not the slow one. */
export function warmUp() {
  if (!hasSimd()) {
    return Promise.reject(new Error("simd"));
  }
  return send({ type: "warm" });
}

/**
 * Copies the video frame into the buffer the worker handed back, and reads it.
 *
 * @param source  anything drawImage accepts
 * @param width   the size to read at - smaller is faster, and the card only
 *                needs enough pixels for a digit to survive
 */
export function readFrame(pixels, tournaments) {
  const needed = pixels.data.byteLength;
  let data = pixels.data;
  if (spare && spare.byteLength === needed) {
    data = new Uint8ClampedArray(spare);
    data.set(pixels.data);
    spare = null;
  }
  const frame = { width: pixels.width, height: pixels.height, data };
  return send({ type: "read", frame, tournaments }, [data.buffer]);
}

/** Frees the worker's buffers and stops it. */
export function shutDown() {
  if (!worker) return;
  const stopping = send({ type: "release" }).catch(() => {});
  stopping.finally(() => {
    if (worker) worker.terminate();
    worker = null;
    waiting.clear();
    spare = null;
  });
}
