# tools

Nothing in here ships. These are the two things the app carries that were not
written by hand, and the scripts that produce them, so both can be rebuilt and
checked rather than taken on trust.

## `vendor/opencv-4.9.0-simd.*`

OpenCV's own `opencv.js` is 10.3 MB and contains deep learning, video tracking,
feature matching, photography and calibration - none of which reads a sheet of
paper. `opencv_js.config.py` here is the whitelist that replaces it: core,
imgproc and the QR detector, about thirty functions, the ones `js/scan/card.js`
actually calls. Built with SIMD and with the WebAssembly as its own file, that
comes to 4.0 MB, of which the 3.9 MB of wasm streams and compiles as it
downloads rather than arriving base64'd inside the JavaScript.

Keep the whitelist in step with `card.js`. A call that is not in it is not in
the build, and the failure is a `TypeError` at the moment someone scans a card.

It is also about twice as fast. Reading the same six cards through the same
pipeline, a card at a time:

| Build | Per card | Download |
| --- | --- | --- |
| this one, trimmed with SIMD | 342-409ms, mean 384ms | 4.0 MB |
| OpenCV's own `opencv.js` | 792-876ms, mean 833ms | 10.3 MB |

Both read all six correctly, so it is like for like. Most of that is SIMD
rather than the trimming - a narrower build is smaller, not quicker - and the
gap matters because it is the difference between a viewfinder that tries twice
a second and one that tries once.

To rebuild, with [emsdk](https://emscripten.org) 3.1.64 and OpenCV 4.9.0:

```sh
git clone --depth 1 https://github.com/emscripten-core/emsdk
./emsdk/emsdk install 3.1.64 && ./emsdk/emsdk activate 3.1.64
git clone --depth 1 --branch 4.9.0 https://github.com/opencv/opencv

export EMSCRIPTEN=$PWD/emsdk/upstream/emscripten
python3 opencv/platforms/js/build_js.py out \
  --build_wasm --simd --disable_single_file \
  --config /path/to/tools/opencv_js.config.py \
  --cmake_option="-DBUILD_opencv_dnn=OFF" \
  --cmake_option="-DBUILD_opencv_video=OFF" \
  --cmake_option="-DBUILD_opencv_photo=OFF" \
  --cmake_option="-DBUILD_opencv_ml=OFF" \
  --cmake_option="-DBUILD_opencv_stitching=OFF" \
  --cmake_option="-DBUILD_opencv_gapi=OFF"

cp out/bin/opencv.js       vendor/opencv-4.9.0-simd.js
cp out/bin/opencv_js.wasm  vendor/opencv-4.9.0-simd.wasm
```

Three patches to the OpenCV tree are needed before it will build and run. Each
is one line, and each has a reason:

1. `modules/js/CMakeLists.txt` passes `--memory-init-file 0` and
   `-s WASM_MEM_MAX`, both of which emscripten 3.1.64 has removed. Drop the
   first and rename the second to `-s MAXIMUM_MEMORY`.
2. `modules/js/src/make_umd.py` closes its wrapper with `}(this, ...)`, and
   `this` is `undefined` inside an ES module, so importing the result throws
   before it can assign anything. Use
   `}(typeof globalThis !== 'undefined' ? globalThis : this, ...)`. The reader
   runs in a module worker and imports it.
3. `modules/js/src/helpers.js` reaches for a global `cv` when it builds a Mat -
   `matFromArray`, `imread` and the rest. In this build `cv` is the factory
   rather than the instance, so those throw. Replace `cv.` with `Module.`
   throughout the file.

Do not disable `calib3d`, `features2d` or `flann`: the QR detector needs them,
and without them `objdetect` is silently dropped from the build and
`cv.QRCodeDetector` is simply not there.

## `js/scan/digit-model.js`

`train-digits.py` trains the handwritten digit classifier and writes the module
the app imports: weights, and the confusion matrix the reader uses to work out
what a box might really have said. It needs numpy and the MNIST files, which
are not in the repository - the script's header says where to fetch them.

```sh
python3 tools/train-digits.py --epochs 20
```

It is deterministic, so a rebuild from the same source reproduces the same file.
