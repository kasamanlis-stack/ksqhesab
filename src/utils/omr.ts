import type { OmrAnswer, OmrReadResult } from '../types/ksq';

/* KSQ cavab blankı oxuyucusu (OMR). Blank düzümü mm ilə, A4. */
export const OMR_MARK: [number, number][] = [
  [14, 14],
  [196, 14],
  [196, 283],
  [14, 283],
]; // TL TR BR BL
export const R_IN = 2.3;
export const R_RING_IN = 2.9;
export const R_RING_OUT = 3.8;
export const ID_TENS: [number, number][] = [...Array(5)].map((_, d) => [60 + 11 * d, 72]);
export const ID_UNITS: [number, number][] = [...Array(10)].map((_, d) => [60 + 11 * d, 84]);
export const OMR_Q: [number, number][][] = [];
for (let col = 0; col < 2; col++) {
  for (let k = 0; k < 8; k++) {
    const bx = col ? 128 : 40;
    const y = 118 + 15 * k;
    OMR_Q.push([0, 1, 2, 3, 4].map((j) => [bx + 12 * j, y]));
  }
}
export const OMR_ALL: [number, number][] = [...ID_TENS, ...ID_UNITS, ...OMR_Q.flat()];

export interface PreparedImage {
  w: number;
  h: number;
  bin: Uint8Array;
}

export interface BlobCandidate {
  x: number;
  y: number;
  a: number;
  fill: number;
}

export type HomographyFn = (x: number, y: number) => [number, number];

export function solve(A: number[][], b: number[]): number[] | null {
  // Gauss
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    }
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function homography(src: [number, number][], dst: [number, number][]): HomographyFn | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return (x: number, y: number): [number, number] => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

export function binarizeRgba(d: Uint8ClampedArray | Uint8Array, w: number, h: number): PreparedImage {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  }
  // integral image -> Bradley threshold
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      s += g[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s;
    }
  }
  const S = Math.max(15, Math.round(Math.max(w, h) / 12));
  const hs = S >> 1;
  const T = 0.2;
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - hs);
    const y1 = Math.min(h, y + hs + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - hs);
      const x1 = Math.min(w, x + hs + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      bin[y * w + x] = g[y * w + x] < mean * (1 - T) && g[y * w + x] < 200 ? 1 : 0;
    }
  }
  return { w, h, bin };
}

export function blobs(P: PreparedImage): BlobCandidate[] {
  const { w, h, bin } = P;
  const lab = new Int32Array(w * h);
  const out: BlobCandidate[] = [];
  const st = new Int32Array(w * h);
  const minA = Math.pow(Math.max(w, h) * 0.012, 2);
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || lab[i]) continue;
    id++;
    let sp = 0;
    st[sp++] = i;
    lab[i] = id;
    let a = 0;
    let sx = 0;
    let sy = 0;
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1;
    let y1 = -1;
    while (sp) {
      const p = st[--sp];
      const x = p % w;
      const y = (p - x) / w;
      a++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0) {
        const q = p - 1;
        if (bin[q] && !lab[q]) {
          lab[q] = id;
          st[sp++] = q;
        }
      }
      if (x < w - 1) {
        const q = p + 1;
        if (bin[q] && !lab[q]) {
          lab[q] = id;
          st[sp++] = q;
        }
      }
      if (y > 0) {
        const q = p - w;
        if (bin[q] && !lab[q]) {
          lab[q] = id;
          st[sp++] = q;
        }
      }
      if (y < h - 1) {
        const q = p + w;
        if (bin[q] && !lab[q]) {
          lab[q] = id;
          st[sp++] = q;
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const ar = bw / bh;
    const fill = a / (bw * bh);
    if (a >= minA && ar > 0.55 && ar < 1.8 && fill > 0.8 && bw < w / 4 && bh < h / 4) {
      out.push({ x: sx / a, y: sy / a, a, fill });
    }
  }
  return out;
}

export function dark(P: PreparedImage, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= P.w || yi >= P.h) return 0;
  return P.bin[yi * P.w + xi];
}

export function fillAt(P: PreparedImage, H: HomographyFn, cx: number, cy: number, r0: number, r1: number): number {
  let n = 0;
  let k = 0;
  for (let dy = -r1; dy <= r1; dy += 0.3) {
    for (let dx = -r1; dx <= r1; dx += 0.3) {
      const rr = Math.hypot(dx, dy);
      if (rr < r0 || rr > r1) continue;
      const [u, v] = H(cx + dx, cy + dy);
      k += dark(P, u, v);
      n++;
    }
  }
  return n ? k / n : 0;
}

export function decide(f: number[], thr: number): { v: number | null; flag: string } {
  const idx = f.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0]);
  const [m, mi] = idx[0];
  const s2 = idx[1][0];
  if (m < thr) return { v: null, flag: m > thr * 0.55 ? 'zəif işarə' : '' };
  if (s2 >= thr) return m - s2 > 0.3 ? { v: mi, flag: 'bir neçə işarə – yoxlayın' } : { v: null, flag: 'bir neçə cavab' };
  return { v: mi, flag: '' };
}

export interface CoreOmrResult {
  ok: true;
  id: number | null;
  idFlag: string;
  answers: OmrAnswer[];
  H: HomographyFn;
  T: { v: number | null; flag: string };
  U: { v: number | null; flag: string };
}

export function readPrepared(P: PreparedImage): CoreOmrResult | { ok: false; error: string } {
  const c = blobs(P);
  if (c.length < 4) {
    return { ok: false, error: 'Künclərdəki 4 qara kvadrat tapılmadı. Vərəqin hamısı kadrda olsun.' };
  }
  c.sort((a, b) => b.a - a.a);
  // ən böyük 4 kvadrat, ölçücə bir-birinə yaxın olanlar
  let pick: BlobCandidate[] | null = null;
  for (let s = 0; s + 4 <= Math.min(c.length, 8) && !pick; s++) {
    const g = c.slice(s, s + 4);
    if (g[3].a > g[0].a * 0.35) pick = g;
  }
  if (!pick) pick = c.slice(0, 4);
  const cx = pick.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pick.reduce((s, p) => s + p.y, 0) / 4;
  pick.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // ekranda saat əqrəbi istiqaməti
  let start = 0;
  let best = 1e18;
  pick.forEach((p, i) => {
    if (p.x + p.y < best) {
      best = p.x + p.y;
      start = i;
    }
  });
  let bestR: { H: HomographyFn; score: number; ringAvg: number } | null = null;
  for (let r = 0; r < 4; r++) {
    const dst = [0, 1, 2, 3].map((k) => {
      const p = pick![(start + r + k) % 4];
      return [p.x, p.y] as [number, number];
    });
    const H = homography(OMR_MARK, dst);
    if (!H) continue;
    // düzgün istiqamət: dairəciklərin konturları gözlənilən yerdədir
    let ring = 0;
    let gap = 0;
    OMR_ALL.forEach(([x, y], i) => {
      if (i % 3) return;
      ring += fillAt(P, H, x, y, R_RING_IN, R_RING_OUT);
      gap += fillAt(P, H, x + 6, y + (i % 2 ? 4 : -4), 0, 1.2);
    });
    const score = ring - gap;
    if (!bestR || score > bestR.score) {
      bestR = { H, score, ringAvg: ring / (OMR_ALL.length / 3) };
    }
  }
  if (!bestR || bestR.ringAvg < 0.12) {
    return {
      ok: false,
      error: 'Blank tanınmadı. Şəkli düz, işıqlı yerdə, vərəqi tam göstərərək yenidən çəkin.',
    };
  }
  const H = bestR.H;
  const raw = (pts: [number, number][]) => pts.map(([x, y]) => fillAt(P, H, x, y, 0, R_IN));
  // eşik: boş dairəciklərin səviyyəsinə görə uyğunlaşır
  const all = [...raw(ID_TENS), ...raw(ID_UNITS), ...OMR_Q.flatMap((q) => raw(q))].sort((a, b) => a - b);
  const base = all[Math.floor(all.length * 0.3)];
  const thr = Math.max(0.3, Math.min(0.55, base + 0.28));
  const T = decide(raw(ID_TENS), thr);
  const U = decide(raw(ID_UNITS), thr);
  let id: number | null = null;
  let idFlag = '';
  if (U.v !== null) {
    id = (T.v ?? 0) * 10 + U.v;
    if (T.v === null) idFlag = 'onluq işarələnməyib, 0 götürüldü';
    if (T.flag) idFlag = T.flag;
    if (U.flag) idFlag = U.flag;
  } else {
    idFlag = 'nömrə oxunmadı';
  }
  const answers: OmrAnswer[] = OMR_Q.map((q) => {
    const f = raw(q);
    const d = decide(f, thr);
    return { v: d.v === null ? '' : 'ABCDE'[d.v], flag: d.flag, f };
  });
  return { ok: true, id, idFlag, answers, H, T, U };
}

function prepare(img: HTMLImageElement): PreparedImage & { canvas: HTMLCanvasElement } {
  const maxD = 1600;
  const sc = Math.min(1, maxD / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc);
  const h = Math.round(img.height * sc);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) {
    throw new Error('Canvas 2D context unavailable');
  }
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const prep = binarizeRgba(d, w, h);
  return { ...prep, canvas: cv };
}

export const OMR = {
  read(img: HTMLImageElement): OmrReadResult {
    const P = prepare(img);
    const res = readPrepared(P);
    if (!res.ok) return res;
    const { H, T, U, id, idFlag, answers } = res;
    // önizləmə üçün işarələri çək
    const cx2 = P.canvas.getContext('2d');
    if (cx2) {
      cx2.lineWidth = Math.max(2, P.w / 500);
      const mark = (x: number, y: number, col: string) => {
        const [u, v] = H(x, y);
        const [u2] = H(x + 3.6, y);
        cx2.strokeStyle = col;
        cx2.beginPath();
        cx2.arc(u, v, Math.abs(u2 - u), 0, 7);
        cx2.stroke();
      };
      OMR_Q.forEach((q, i) => {
        const a = answers[i];
        q.forEach(([x, y], j) => {
          if ('ABCDE'[j] === a.v) mark(x, y, a.flag ? '#d08000' : '#1a9a4a');
        });
        if (a.flag && !a.v) q.forEach(([x, y]) => mark(x, y, '#d03030'));
      });
      if (T.v !== null) mark(...ID_TENS[T.v], '#2f5d8a');
      if (U.v !== null) mark(...ID_UNITS[U.v], '#2f5d8a');
    }
    return {
      ok: true,
      id,
      idFlag,
      answers,
      preview: P.canvas.toDataURL('image/jpeg', 0.6),
    };
  },
};
