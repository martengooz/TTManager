#!/usr/bin/env python3
"""
Trains the handwritten digit classifier the scorecard reader uses, and writes it
out as js/scan/digit-model.js.

The app ships the trained weights, not this script - it is here so the model can
be rebuilt and checked rather than taken on trust. It needs numpy and the four
MNIST idx files, which are not in the repository:

    mkdir -p tools/mnist && cd tools/mnist
    for f in train-images-idx3-ubyte train-labels-idx1-ubyte \
             t10k-images-idx3-ubyte t10k-labels-idx1-ubyte; do
      curl -LO "https://storage.googleapis.com/cvdf-datasets/mnist/$f.gz"
    done

    python3 tools/train-digits.py --epochs 20

The network is deliberately small: two convolutions and one fully connected
layer, about eleven thousand weights, which quantise to a 12 kB file. That fits
an app whose whole point is that it installs on a phone and runs offline, and a
scorecard only ever asks it to read a couple of dozen digits.
"""

import argparse
import base64
import gzip
import pathlib
import struct
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
MNIST = HERE / "mnist"
OUT = HERE.parent / "js" / "scan" / "digit-model.js"

rng = np.random.default_rng(7)


# ----------------------------------------------------------------- the data

def idx(path):
    with gzip.open(path, "rb") as fh:
        magic, count = struct.unpack(">II", fh.read(8))
        if magic == 0x803:
            rows, cols = struct.unpack(">II", fh.read(8))
            shape = (count, rows, cols)
        elif magic == 0x801:
            shape = (count,)
        else:
            raise ValueError(f"{path}: not an idx file")
        return np.frombuffer(fh.read(), dtype=np.uint8).reshape(shape)


def load():
    if not MNIST.is_dir():
        sys.exit(f"no dataset in {MNIST} - see the header of {OUT.name}")
    train_x = idx(MNIST / "train-images-idx3-ubyte.gz").astype(np.float32) / 255.0
    train_y = idx(MNIST / "train-labels-idx1-ubyte.gz").astype(np.int64)
    test_x = idx(MNIST / "t10k-images-idx3-ubyte.gz").astype(np.float32) / 255.0
    test_y = idx(MNIST / "t10k-labels-idx1-ubyte.gz").astype(np.int64)
    return train_x, train_y, test_x, test_y


# --------------------------------------------------------------- augmenting

def warp(batch, matrices):
    """Bilinear affine sampling, one 2x3 matrix per image, zero outside."""
    n, h, w = batch.shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    dx, dy = xs - cx, ys - cy

    a = matrices[:, 0, 0][:, None, None] * dx + matrices[:, 0, 1][:, None, None] * dy + matrices[:, 0, 2][:, None, None] + cx
    b = matrices[:, 1, 0][:, None, None] * dx + matrices[:, 1, 1][:, None, None] * dy + matrices[:, 1, 2][:, None, None] + cy

    x0 = np.floor(a).astype(np.int32)
    y0 = np.floor(b).astype(np.int32)
    fx, fy = a - x0, b - y0

    def at(xi, yi):
        ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        flat = batch.reshape(n, -1)
        idxs = np.clip(yi, 0, h - 1) * w + np.clip(xi, 0, w - 1)
        return np.where(ok, np.take_along_axis(flat, idxs.reshape(n, -1), axis=1).reshape(n, h, w), 0.0)

    return (
        at(x0, y0) * (1 - fx) * (1 - fy)
        + at(x0 + 1, y0) * fx * (1 - fy)
        + at(x0, y0 + 1) * (1 - fx) * fy
        + at(x0 + 1, y0 + 1) * fx * fy
    ).astype(np.float32)


def thicken(batch, amount):
    """A cheap dilate/erode: a 3x3 max or min, blended in by `amount`."""
    padded = np.pad(batch, ((0, 0), (1, 1), (1, 1)))
    shifts = [padded[:, dy:dy + 28, dx:dx + 28] for dy in range(3) for dx in range(3)]
    stack = np.stack(shifts, axis=0)
    grown, shrunk = stack.max(axis=0), stack.min(axis=0)
    out = np.where(amount[:, None, None] > 0, grown, shrunk)
    blend = np.abs(amount)[:, None, None]
    return (batch * (1 - blend) + out * blend).astype(np.float32)


def augment(batch):
    """
    Umpires do not write like the MNIST panel. They write in a ruled box with a
    biro, at a slant, in whatever thickness the pen gives - so the training set
    is stretched over rotation, scale, shear and stroke weight. It is the single
    thing that moves the reader from working on clean scans to working on a
    photograph of a card that has been in someone's pocket.
    """
    n = len(batch)
    angle = rng.normal(0, 0.16, n).astype(np.float32)        # about +-9 degrees
    scale = rng.uniform(0.82, 1.18, n).astype(np.float32)
    shear = rng.normal(0, 0.22, n).astype(np.float32)        # a sloping hand
    tx = rng.normal(0, 1.6, n).astype(np.float32)
    ty = rng.normal(0, 1.6, n).astype(np.float32)

    cos, sin = np.cos(angle) / scale, np.sin(angle) / scale
    m = np.zeros((n, 2, 3), dtype=np.float32)
    m[:, 0, 0] = cos
    m[:, 0, 1] = -sin + shear * cos
    m[:, 1, 0] = sin
    m[:, 1, 1] = cos + shear * sin
    m[:, 0, 2] = tx
    m[:, 1, 2] = ty

    out = warp(batch, m)
    out = thicken(out, rng.uniform(-1, 1, n).astype(np.float32) * (rng.random(n) < 0.6))
    out = np.clip(out * rng.uniform(0.7, 1.15, n)[:, None, None], 0, 1)
    return out.astype(np.float32)


# ------------------------------------------------------------------ the net

def im2col(x, k):
    n, c, h, w = x.shape
    oh, ow = h - k + 1, w - k + 1
    s = x.strides
    patches = np.lib.stride_tricks.as_strided(
        x, shape=(n, oh, ow, c, k, k), strides=(s[0], s[2], s[3], s[1], s[2], s[3]), writeable=False
    )
    return patches.reshape(n * oh * ow, c * k * k), oh, ow


class Conv:
    def __init__(self, cin, cout, k):
        self.k = k
        self.w = (rng.standard_normal((cin * k * k, cout)) * np.sqrt(2.0 / (cin * k * k))).astype(np.float32)
        self.b = np.zeros(cout, dtype=np.float32)

    def forward(self, x):
        self.x = x
        cols, oh, ow = im2col(x, self.k)
        self.cols, self.oh, self.ow = cols, oh, ow
        out = cols @ self.w + self.b
        return out.reshape(len(x), oh, ow, -1).transpose(0, 3, 1, 2)

    def backward(self, g):
        n = len(self.x)
        gc = g.transpose(0, 2, 3, 1).reshape(-1, self.w.shape[1])
        self.gw = self.cols.T @ gc
        self.gb = gc.sum(axis=0)
        gcols = (gc @ self.w.T).reshape(n, self.oh, self.ow, self.x.shape[1], self.k, self.k)
        gx = np.zeros_like(self.x)
        for dy in range(self.k):
            for dx in range(self.k):
                gx[:, :, dy:dy + self.oh, dx:dx + self.ow] += gcols[:, :, :, :, dy, dx].transpose(0, 3, 1, 2)
        return gx

    def params(self):
        return [(self.w, "gw"), (self.b, "gb")]


class Dense:
    def __init__(self, cin, cout):
        self.w = (rng.standard_normal((cin, cout)) * np.sqrt(2.0 / cin)).astype(np.float32)
        self.b = np.zeros(cout, dtype=np.float32)

    def forward(self, x):
        self.x = x
        return x @ self.w + self.b

    def backward(self, g):
        self.gw = self.x.T @ g
        self.gb = g.sum(axis=0)
        return g @ self.w.T

    def params(self):
        return [(self.w, "gw"), (self.b, "gb")]


def relu(x):
    return np.maximum(x, 0)


def pool(x):
    n, c, h, w = x.shape
    v = x.reshape(n, c, h // 2, 2, w // 2, 2)
    out = v.max(axis=(3, 5))
    mask = v == out[:, :, :, None, :, None]
    return out, mask


def unpool(g, mask, shape):
    n, c, h, w = shape
    spread = mask * g[:, :, :, None, :, None]
    return spread.reshape(n, c, h, w)


class Net:
    def __init__(self):
        self.c1 = Conv(1, 12, 5)
        self.c2 = Conv(12, 24, 5)
        self.fc = Dense(24 * 4 * 4, 10)
        self.layers = [self.c1, self.c2, self.fc]

    def forward(self, x):
        a = relu(self.c1.forward(x))
        self.r1 = a > 0
        p1, self.m1 = pool(a)
        self.s1 = a.shape
        b = relu(self.c2.forward(p1))
        self.r2 = b > 0
        p2, self.m2 = pool(b)
        self.s2 = b.shape
        self.flat = p2.reshape(len(x), -1)
        return self.fc.forward(self.flat)

    def backward(self, g):
        g = self.fc.backward(g).reshape(len(g), 24, 4, 4)
        g = unpool(g, self.m2, self.s2) * self.r2
        g = self.c2.backward(g)
        g = unpool(g, self.m1, self.s1) * self.r1
        self.c1.backward(g)


def softmax(z):
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


# --------------------------------------------------------------- the export

def quantise(a):
    """Per-tensor int8. The accuracy cost is under a tenth of a point and it
    turns a 46 kB weight file into 12 kB, which the service worker caches."""
    scale = float(np.abs(a).max()) / 127.0 or 1.0
    q = np.clip(np.round(a / scale), -127, 127).astype(np.int8)
    return q, scale


def emit(net, accuracy, epochs):
    parts = []
    for name, layer in (("c1", net.c1), ("c2", net.c2), ("fc", net.fc)):
        qw, sw = quantise(layer.w)
        parts.append((name, qw, sw, layer.b))

    lines = [
        "/*",
        " * The scorecard reader's handwritten digit classifier: two convolutions and",
        " * a fully connected layer, trained on MNIST with rotation, scale, shear and",
        " * stroke-weight augmentation so it survives a biro at a slant.",
        " *",
        f" * Generated by tools/train-digits.py - {epochs} epochs, {accuracy:.2%} on the",
        " * MNIST test set. Do not edit by hand; rebuild it if the network changes.",
        " *",
        " * Weights are int8 with one scale per tensor, base64 encoded. Biases stay",
        " * float32: there are only 46 of them and they matter more.",
        " */",
        "",
        "const B64 = (s) => {",
        "  const bin = atob(s);",
        "  const out = new Int8Array(bin.length);",
        "  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;",
        "  return out;",
        "};",
        "",
        "/** Dequantised on load: a few thousand multiplies, once. */",
        "const F = (s, scale) => Float32Array.from(B64(s), (v) => v * scale);",
        "",
    ]
    for name, qw, sw, b in parts:
        blob = base64.b64encode(qw.tobytes(order="C")).decode()
        lines.append(f"/* {name}: {qw.shape[0]}x{qw.shape[1]} */")
        lines.append(f'export const {name}w = F("{blob}", {sw!r});')
        lines.append(f"export const {name}b = new Float32Array([{', '.join(f'{v:.6g}' for v in b)}]);")
        lines.append("")
    lines.append("export const SHAPE = { conv1: [1, 12, 5], conv2: [12, 24, 5], dense: [384, 10] };")
    lines.append(f"export const ACCURACY = {accuracy:.4f};")
    lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    return sum(w.size for _, w, _, _ in parts)


# ------------------------------------------------------------------- driver

def evaluate(net, x, y, batch=1000):
    right = 0
    for i in range(0, len(x), batch):
        z = net.forward(x[i:i + batch].reshape(-1, 1, 28, 28))
        right += int((z.argmax(axis=1) == y[i:i + batch]).sum())
    return right / len(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=18)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    args = ap.parse_args()

    train_x, train_y, test_x, test_y = load()
    net = Net()
    state = {}
    step = 0

    for epoch in range(args.epochs):
        order = rng.permutation(len(train_x))
        loss_sum, seen = 0.0, 0
        for i in range(0, len(order) - args.batch + 1, args.batch):
            pick = order[i:i + args.batch]
            xb = augment(train_x[pick]).reshape(-1, 1, 28, 28)
            yb = train_y[pick]

            probs = softmax(net.forward(xb))
            loss_sum += float(-np.log(np.maximum(probs[np.arange(len(yb)), yb], 1e-9)).sum())
            seen += len(yb)

            g = probs
            g[np.arange(len(yb)), yb] -= 1
            net.backward(g / len(yb))

            step += 1
            lr = args.lr * min(1.0, step / 300) * (0.5 ** (epoch / 6))
            for layer in net.layers:
                for param, gname in layer.params():
                    grad = getattr(layer, gname)
                    key = id(param)
                    m, v = state.setdefault(key, (np.zeros_like(param), np.zeros_like(param)))
                    m *= 0.9
                    m += 0.1 * grad
                    v *= 0.999
                    v += 0.001 * grad * grad
                    param -= lr * (m / (1 - 0.9 ** step)) / (np.sqrt(v / (1 - 0.999 ** step)) + 1e-8)

        acc = evaluate(net, test_x, test_y)
        print(f"epoch {epoch + 1:2d}  loss {loss_sum / seen:.4f}  test {acc:.4%}", flush=True)

    acc = evaluate(net, test_x, test_y)
    count = emit(net, acc, args.epochs)
    print(f"wrote {OUT} - {count} weights, {OUT.stat().st_size / 1024:.1f} kB, {acc:.4%}")


if __name__ == "__main__":
    main()
