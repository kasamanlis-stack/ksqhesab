import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binarizeRgba,
  ID_TENS,
  ID_UNITS,
  OMR_ALL,
  OMR_MARK,
  OMR_Q,
  readPrepared,
} from './omr';

function drawFilledCircle(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 15;
        rgba[idx + 1] = 15;
        rgba[idx + 2] = 15;
      }
    }
  }
}

function drawRing(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
) {
  const x0 = Math.max(0, Math.floor(cx - rOut - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + rOut + 1));
  const y0 = Math.max(0, Math.floor(cy - rOut - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + rOut + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= rIn && d <= rOut) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 25;
        rgba[idx + 1] = 25;
        rgba[idx + 2] = 25;
      }
    }
  }
}

function drawSquare(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  halfSize: number,
) {
  const x0 = Math.max(0, Math.floor(cx - halfSize));
  const x1 = Math.min(w - 1, Math.ceil(cx + halfSize));
  const y0 = Math.max(0, Math.floor(cy - halfSize));
  const y1 = Math.min(h - 1, Math.ceil(cy + halfSize));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * w + x) * 4;
      rgba[idx] = 10;
      rgba[idx + 1] = 10;
      rgba[idx + 2] = 10;
    }
  }
}

test('OMR reads synthetic A4 blank with exact millimeter coordinates', () => {
  // 210mm x 297mm scaled to 5 px/mm -> 1050 x 1485 (within maxD=1600)
  const scale = 5;
  const w = 210 * scale;
  const h = 297 * scale;
  const rgba = new Uint8ClampedArray(w * h * 4);
  rgba.fill(255);

  // 4 corner registration squares (7mm x 7mm) at OMR_MARK
  for (const [mx, my] of OMR_MARK) {
    drawSquare(rgba, w, h, mx * scale, my * scale, 3.5 * scale);
  }

  // Printed circle outlines for all ID and answer bubbles (r=3.0..3.6mm)
  for (const [bx, by] of OMR_ALL) {
    drawRing(rgba, w, h, bx * scale, by * scale, 2.9 * scale, 3.7 * scale);
  }

  // Student ID = 23 (tens=2, units=3)
  drawFilledCircle(rgba, w, h, ID_TENS[2][0] * scale, ID_TENS[2][1] * scale, 2.6 * scale);
  drawFilledCircle(rgba, w, h, ID_UNITS[3][0] * scale, ID_UNITS[3][1] * scale, 2.6 * scale);

  // 16 answers
  const expected = ['A', 'B', 'C', 'D', 'E', 'A', 'C', 'E', 'B', 'D', 'A', 'B', 'C', 'D', 'E', 'A'];
  expected.forEach((letter, qi) => {
    const optIdx = 'ABCDE'.indexOf(letter);
    const [qx, qy] = OMR_Q[qi][optIdx];
    drawFilledCircle(rgba, w, h, qx * scale, qy * scale, 2.6 * scale);
  });

  const prep = binarizeRgba(rgba, w, h);
  const res = readPrepared(prep);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.id, 23);
    assert.equal(res.idFlag, '');
    assert.deepEqual(
      res.answers.map((a) => a.v),
      expected,
    );
    assert.ok(res.answers.every((a) => a.flag === ''));
  }
});

test('OMR rejects blank image without 4 corner markers', () => {
  const w = 400;
  const h = 500;
  const rgba = new Uint8ClampedArray(w * h * 4);
  rgba.fill(255);
  const prep = binarizeRgba(rgba, w, h);
  const res = readPrepared(prep);
  assert.equal(res.ok, false);
});
