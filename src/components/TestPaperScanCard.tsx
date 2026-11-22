import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { KsqState, TestPaperAnswerItem, TestPaperScanItem, VariantId } from '../types/ksq';
import { fmt, getQuestionKey, getStudentVariant, hasData } from '../utils/ksq';
import { matchStudentIndex, mergeScanAnswers, summarizeScanVsKey } from '../utils/testScan';

interface TestPaperScanCardProps {
  state: KsqState;
  testScans: TestPaperScanItem[];
  onSetTestScans: React.Dispatch<React.SetStateAction<TestPaperScanItem[]>>;
  onApplyTestPaperAnswers: (studentName: string, values: string[], variant: VariantId) => number;
  onZoomImage: (src: string) => void;
  onToast: (message: string) => void;
}

const MAX_TOTAL_BASE64_BYTES = 2_800_000;
const MAX_PAGES_PER_STUDENT = 4;

function inferImageMimeType(file: File): string {
  if (file.type && file.type.startsWith('image/')) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'image/jpeg';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Fayl oxunmadı.'));
    };
    reader.onerror = () => reject(new Error('Fayl oxunarkən xəta baş verdi.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image element decode failed'));
    };
    img.src = url;
  });
}

function encodeSourceToBoundedJpeg(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxBytes: number,
): { base64: string; mimeType: string; preview: string } {
  const attempts: Array<[number, number]> = [
    [1600, 0.82],
    [1280, 0.72],
    [1024, 0.65],
    [900, 0.56],
  ];
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d');
  if (!cx) throw new Error('Brauzer şəkil emalı (Canvas) dəstəklənmir.');

  for (const [maxD, quality] of attempts) {
    const sc = Math.min(1, maxD / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * sc));
    const h = Math.max(1, Math.round(srcH * sc));
    cv.width = w;
    cv.height = h;
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(source, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1] || '';
    if (base64.length <= maxBytes || maxD === 900) {
      return { base64, mimeType: 'image/jpeg', preview: dataUrl };
    }
  }
  throw new Error('Şəkil sıxışdırıla bilmədi.');
}

async function fileToResizedJpeg(
  file: File,
  maxBytes: number = MAX_TOTAL_BASE64_BYTES,
): Promise<{ base64: string; mimeType: string; preview: string }> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      return encodeSourceToBoundedJpeg(bitmap, bitmap.width, bitmap.height, maxBytes);
    } catch {
      // Fallback to HTMLImageElement / raw upload below
    } finally {
      bitmap?.close();
    }
  }

  try {
    const img = await loadImageElement(file);
    return encodeSourceToBoundedJpeg(
      img,
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      maxBytes,
    );
  } catch {
    const mimeType = inferImageMimeType(file);
    const supportedRaw = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
    if (supportedRaw.has(mimeType) && file.size <= 3_000_000) {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(',')[1] || '';
      if (base64.length > 32 && base64.length <= maxBytes + 800_000) {
        const canPreview = mimeType !== 'image/heic' && mimeType !== 'image/heif';
        return { base64, mimeType, preview: canPreview ? dataUrl : '' };
      }
    }
    throw new Error(
      'Bu şəkil formatı brauzerdə oxunmadı və ya həcmi çox böyükdür. Zəhmət olmasa JPG və ya PNG şəkil seçin.',
    );
  }
}

interface ScanApiSuccess {
  studentName: string | null;
  variant: VariantId | null;
  answers: TestPaperAnswerItem[];
}

export function TestPaperScanCard({
  state,
  testScans,
  onSetTestScans,
  onApplyTestPaperAnswers,
  onZoomImage,
  onToast,
}: TestPaperScanCardProps) {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const hasAnyTestKey = state.q.some((q) =>
    q.type === 'test' ? Boolean(q.key || q.keyB) : q.max > 0,
  );

  const callScanApi = async (
    encodedPages: Array<{ base64: string; mimeType: string }>,
  ): Promise<ScanApiSuccess> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 75_000);
    try {
      const resp = await fetch('/api/scan-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          images: encodedPages.map((p) => ({
            imageBase64: p.base64,
            mimeType: p.mimeType,
          })),
          questions: state.q.map((q, idx) => ({
            number: idx + 1,
            type: q.type,
            max: q.max,
          })),
          students: state.students,
        }),
      });
      const rawText = await resp.text();
      let data: {
        ok?: boolean;
        error?: string;
        studentName?: string | null;
        variant?: string | null;
        answers?: TestPaperAnswerItem[];
      } | null = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (!resp.ok || !data?.ok || !Array.isArray(data.answers)) {
        let errMsg = data?.error || '';
        if (!errMsg) {
          if (resp.status === 404) {
            errMsg = 'Serverdə test oxuma xidməti (/api/scan-test) tapılmadı.';
          } else if (resp.status === 413) {
            errMsg = 'Şəkillərin ölçüsü server limiti üçün çox böyükdür.';
          } else if (resp.status === 502 || resp.status === 504) {
            errMsg = 'Server cavab vermədi (vaxt aşımı). Yenidən cəhd edin.';
          } else {
            errMsg = `Test vərəqi oxunmadı (HTTP ${resp.status}).`;
          }
        }
        throw new Error(errMsg);
      }

      const detectedVariant: VariantId | null =
        data.variant === 'A' || data.variant === 'B' ? data.variant : null;

      return {
        studentName: data.studentName || null,
        variant: detectedVariant,
        answers: data.answers,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Sorğu vaxtı bitdi. İnternet bağlantısını yoxlayıb yenidən cəhd edin.');
      }
      if (err instanceof TypeError) {
        throw new Error('Serverlə əlaqə qurula bilmədi. İnternet bağlantısını yoxlayın.');
      }
      if (err instanceof Error && err.message) {
        throw err;
      }
      throw new Error('Şəkil yüklənərkən və ya oxunarkən xəta baş verdi.');
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // Multi-page upload for ONE student (1–4 pages combined in one API call)
  const handleUnifiedStudentFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(e.target.files || [])];
    e.target.value = '';
    if (!selected.length) return;

    const files = selected.slice(0, MAX_PAGES_PER_STUDENT);
    if (selected.length > MAX_PAGES_PER_STUDENT) {
      onToast(`Bir şagird üçün ən çox ${MAX_PAGES_PER_STUDENT} səhifə birləşdirilir.`);
    }

    setBusy(true);
    const key = `tp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const labelName =
      files.length > 1 ? `${files[0].name} (+${files.length - 1} səhifə)` : files[0].name;

    try {
      setStatus(
        files.length > 1
          ? ` ${files.length} səhifə hazırlanır və oxunur…`
          : ' Test vərəqi oxunur…',
      );
      const perPageBudget = Math.floor(MAX_TOTAL_BASE64_BYTES / Math.max(1, files.length));
      const encoded = await Promise.all(files.map((f) => fileToResizedJpeg(f, perPageBudget)));
      const result = await callScanApi(encoded);
      const si = matchStudentIndex(result.studentName, state.students);
      const fallbackVariant =
        si >= 0 ? getStudentVariant(state, state.students[si]) : ('A' as VariantId);
      const variant = result.variant ?? fallbackVariant;

      onSetTestScans((prev) => [
        ...prev,
        {
          ok: true,
          name: labelName,
          key,
          done: false,
          previews: encoded.map((p) => p.preview),
          detectedName: result.studentName,
          detectedVariant: result.variant,
          variant,
          si,
          answers: result.answers,
        },
      ]);
    } catch (err) {
      const errMsg =
        err instanceof Error && err.message
          ? err.message
          : 'Şəkil yüklənərkən və ya oxunarkən xəta baş verdi.';
      onSetTestScans((prev) => [
        ...prev,
        {
          ok: false,
          name: labelName,
          key,
          done: false,
          error: errMsg,
        },
      ]);
    } finally {
      setStatus('');
      setBusy(false);
    }
  };

  // Batch upload: each selected image creates a separate student scan card
  const handleBatchFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    setBusy(true);
    const added: TestPaperScanItem[] = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(` Toplu oxunur: ${i + 1} / ${files.length}…`);
      const key = `tp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const encoded = await fileToResizedJpeg(files[i], MAX_TOTAL_BASE64_BYTES);
        const result = await callScanApi([encoded]);
        const si = matchStudentIndex(result.studentName, state.students);
        const fallbackVariant =
          si >= 0 ? getStudentVariant(state, state.students[si]) : ('A' as VariantId);
        const variant = result.variant ?? fallbackVariant;
        added.push({
          ok: true,
          name: files[i].name,
          key,
          done: false,
          previews: [encoded.preview],
          detectedName: result.studentName,
          detectedVariant: result.variant,
          variant,
          si,
          answers: result.answers,
        });
      } catch (err) {
        const errMsg =
          err instanceof Error && err.message
            ? err.message
            : 'Şəkil yüklənərkən və ya oxunarkən xəta baş verdi.';
        added.push({
          ok: false,
          name: files[i].name,
          key,
          done: false,
          error: errMsg,
        });
      }
    }
    setStatus('');
    setBusy(false);
    onSetTestScans((prev) => [...prev, ...added]);
  };

  // Add 2nd/3rd page to an existing student card (e.g. mobile camera shooting one page at a time)
  const handleAddPage = async (k: number, e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    const target = testScans[k];
    if (!target || !target.ok) return;

    const file = files[0];
    setBusy(true);
    setStatus(' Əlavə səhifə oxunur…');
    try {
      const encoded = await fileToResizedJpeg(file, MAX_TOTAL_BASE64_BYTES);
      const result = await callScanApi([encoded]);

      onSetTestScans((prev) =>
        prev.map((item, idx) => {
          if (idx !== k || !item.ok) return item;
          const nextSi =
            item.si >= 0 ? item.si : matchStudentIndex(result.studentName, state.students);
          const nextDetectedName = item.detectedName || result.studentName;
          const nextDetectedVariant = item.detectedVariant || result.variant;
          const nextVariant = item.detectedVariant
            ? item.variant
            : result.variant ?? item.variant;

          return {
            ...item,
            done: false,
            previews: [...item.previews, encoded.preview],
            detectedName: nextDetectedName,
            detectedVariant: nextDetectedVariant,
            variant: nextVariant,
            si: nextSi,
            answers: mergeScanAnswers(item.answers, result.answers),
          };
        }),
      );
      onToast('Əlavə səhifənin cavabları birləşdirildi');
    } catch (err) {
      const errMsg =
        err instanceof Error && err.message
          ? err.message
          : 'Əlavə səhifə oxunarkən xəta baş verdi.';
      onToast(errMsg);
    } finally {
      setStatus('');
      setBusy(false);
    }
  };

  const handlePutOne = (k: number) => {
    const s = testScans[k];
    if (!s || !s.ok) return;
    if (s.si < 0) {
      onToast('Əvvəlcə şagirdi seçin');
      return;
    }
    const n = state.students[s.si];
    const w = onApplyTestPaperAnswers(
      n,
      s.answers.map((a) => a.value),
      s.variant,
    );
    onSetTestScans((prev) =>
      prev.map((item, idx) => (idx === k && item.ok ? { ...item, done: true } : item)),
    );
    onToast(`${n} (${s.variant} variantı): ${w} cavab yazıldı`);
  };

  const handlePutAll = () => {
    const cnt: Record<number, number> = {};
    testScans.forEach((s) => {
      if (s.ok && s.si >= 0) cnt[s.si] = (cnt[s.si] || 0) + 1;
    });
    let c = 0;
    let skip = 0;
    const nextScans = testScans.map((s) => {
      if (!s.ok || s.done) return s;
      const clean = s.si >= 0 && cnt[s.si] === 1;
      if (clean) {
        const n = state.students[s.si];
        onApplyTestPaperAnswers(
          n,
          s.answers.map((a) => a.value),
          s.variant,
        );
        c++;
        return { ...s, done: true };
      } else {
        skip++;
        return s;
      }
    });
    onSetTestScans(nextScans);
    onToast(
      `${c} test vərəqi yazıldı` +
        (skip ? `; ${skip} vərəqdə şagirdi seçib “Cədvələ yaz” düyməsini basın` : ''),
    );
  };

  const used: Record<number, number> = {};
  testScans.forEach((s) => {
    if (s.ok && s.si >= 0) used[s.si] = (used[s.si] || 0) + 1;
  });

  const hasPending = testScans.some((s) => s.ok && !s.done);

  return (
    <div className="card">
      <h2>Test vərəqini skan et (cavab kartsız)</h2>
      <p className="hint">
        Şagirdin birbaşa test vərəqinin üzərində işarələdiyi cavabların şəklini çəkib yükləyin. 2 səhifəlik test üçün qalereyadan 2 şəkli birlikdə seçə və ya 1-ci səhifəni çəkdikdən sonra kartdakı <b>“+ Səhifə əlavə et”</b> düyməsi ilə 2-ci səhifəni əlavə edə bilərsiniz. Proqram A/B variantını və düz-səhvləri avtomatik hesablayır.
      </p>
      {!hasAnyTestKey && (
        <div className="msg warn" style={{ marginBottom: 10 }}>
          Əvvəlcə “1. Açar” bölməsində A və B variantlarının düzgün cavablarını daxil edin.
        </div>
      )}
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <label className="btn filebtn">
          {busy ? 'Oxunur…' : 'Test şəklini seç / çək (1–2+ səhifə)'}
          <input
            type="file"
            id="test-scan-in"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={handleUnifiedStudentFiles}
          />
        </label>
        <label className="btn ghost filebtn">
          Toplu yüklə (hər şəkil 1 şagird)
          <input
            type="file"
            id="test-scan-batch"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={handleBatchFiles}
          />
        </label>
        {hasPending && (
          <button
            type="button"
            className="btn ghost"
            id="b-test-scan-all"
            onClick={handlePutAll}
          >
            Hamısını cədvələ yaz
          </button>
        )}
        <span id="test-scan-status" className="hint" style={{ margin: 0 }}>
          {status}
        </span>
      </div>

      <div id="test-scans">
        {testScans.map((s, k) => {
          if (!s.ok) {
            return (
              <div className="scan" key={s.key}>
                <div className="body">
                  <b>{s.name}</b>
                  <div className="msg bad">{s.error}</div>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => onSetTestScans((prev) => prev.filter((_, idx) => idx !== k))}
                  >
                    Sil
                  </button>
                </div>
              </div>
            );
          }

          const summary = summarizeScanVsKey(
            state.q,
            s.answers.map((a) => a.value),
            state.scale,
            s.variant,
          );

          const msgs: Array<[string, string]> = [];
          if (s.done) msgs.push(['ok', 'Cədvələ yazıldı.']);
          if (s.detectedName || s.detectedVariant) {
            const parts = [
              s.detectedName ? `Ad: ${s.detectedName}` : '',
              s.detectedVariant ? `Variant: ${s.detectedVariant}` : '',
            ].filter(Boolean);
            msgs.push(['', `Vərəqdə oxunan — ${parts.join(' · ')}`]);
          }
          if (s.variant === 'B' && !state.q.some((q) => q.type === 'test' && Boolean(q.keyB))) {
            msgs.push([
              'warn',
              'B variantı seçilib, lakin “1. Açar” bölməsində B variantının açarı boşdur.',
            ]);
          }
          if (s.si < 0) {
            msgs.push(['warn', 'Şagird siyahıdan avtomatik tapılmadı – yuxarıdan seçin.']);
          }
          if (s.si >= 0 && used[s.si] > 1) {
            msgs.push(['warn', 'Bu şagird üçün birdən çox test skan kartı var.']);
          }
          if (s.si >= 0 && hasData(state.ans, state.students[s.si]) && !s.done) {
            msgs.push(['warn', 'Bu şagirdin cədvəldə cavabları var – yazanda əvəz olunacaq.']);
          }
          const notes = s.answers
            .map((a, i) => (a.note ? `${i + 1}: ${a.note}` : ''))
            .filter(Boolean);
          if (notes.length) {
            msgs.push(['warn', `Qeydlər: ${notes.join(' · ')}`]);
          }

          return (
            <div className={`scan${s.done ? ' done' : ''}`} key={s.key}>
              <div className={`scan-pages${s.previews.length > 1 ? ' multi' : ''}`}>
                {s.previews.map((src, pIdx) =>
                  src ? (
                    <div className="scan-page-thumb" key={pIdx}>
                      <img
                        src={src}
                        alt={`test vərəqi ${s.name} səhifə ${pIdx + 1}`}
                        onClick={() => onZoomImage(src)}
                      />
                      {s.previews.length > 1 && (
                        <span className="scan-page-badge">Səhifə {pIdx + 1}</span>
                      )}
                    </div>
                  ) : (
                    <div
                      key={pIdx}
                      className="hint scan-page-placeholder"
                    >
                      Səhifə {pIdx + 1} (önizləmə yoxdur)
                    </div>
                  ),
                )}
              </div>

              <div className="body">
                <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    Şagird
                    <select
                      aria-label={`Test skanı ${k + 1} şagird`}
                      className="ksq-select"
                      value={s.si}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onSetTestScans((prev) =>
                          prev.map((item, idx) => {
                            if (idx !== k || !item.ok) return item;
                            const nextVariant =
                              !item.detectedVariant && val >= 0
                                ? getStudentVariant(state, state.students[val])
                                : item.variant;
                            return { ...item, si: val, manual: true, variant: nextVariant };
                          }),
                        );
                      }}
                    >
                      <option value={-1}>— şagirdi seçin —</option>
                      {state.students.map((n, i) => (
                        <option key={i} value={i}>
                          {i + 1}. {n}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    Variant
                    <select
                      aria-label={`Test skanı ${k + 1} variant`}
                      className="ksq-select"
                      value={s.variant}
                      onChange={(e) => {
                        const v = (e.target.value === 'B' ? 'B' : 'A') as VariantId;
                        onSetTestScans((prev) =>
                          prev.map((item, idx) =>
                            idx === k && item.ok ? { ...item, variant: v } : item,
                          ),
                        );
                      }}
                    >
                      <option value="A">A variantı</option>
                      <option value="B">B variantı</option>
                    </select>
                  </label>
                </div>

                <div className="scan-summary">
                  <span className="tag ok">{summary.correctCount} düz</span>
                  <span className="tag bad">{summary.wrongCount} səhv</span>
                  {summary.blankCount > 0 && (
                    <span className="tag warn">{summary.blankCount} boş</span>
                  )}
                  <span>
                    Bal: <b>{fmt(summary.pts)}</b> / {fmt(summary.maxPts)} ({fmt(summary.pct)}%)
                  </span>
                  <span className={`grade g${summary.grade}`}>{summary.grade}</span>
                </div>

                <div className="qs">
                  {state.q.map((qDef, i) => {
                    const ansItem = s.answers[i] ?? { value: '', confidence: 'low', note: '' };
                    const itemSummary = summary.items[i];
                    const qKey = getQuestionKey(qDef, s.variant);
                    let cls = '';
                    if (ansItem.confidence === 'low' && ansItem.value === '') {
                      cls = 'fl';
                    } else if (itemSummary?.status === 'correct') {
                      cls = 'ok';
                    } else if (itemSummary?.status === 'wrong') {
                      cls = 'bad';
                    } else if (
                      itemSummary?.status === 'partial' ||
                      ansItem.confidence !== 'high'
                    ) {
                      cls = 'fl';
                    }

                    return (
                      <label key={i}>
                        {i + 1}
                        <input
                          aria-label={`Test skan ${k + 1} sual ${i + 1}`}
                          value={ansItem.value}
                          maxLength={qDef.type === 'test' ? 1 : 5}
                          className={cls}
                          onChange={(e) => {
                            let v = e.target.value.trim();
                            if (qDef.type === 'test') {
                              v = v.toUpperCase().replace(/[^A-E]/g, '').slice(0, 1);
                            } else {
                              v = v.replace(',', '.').replace(/[^0-9.]/g, '');
                              if (v !== '' && Number(v) > qDef.max) v = String(qDef.max);
                            }
                            onSetTestScans((prev) =>
                              prev.map((item, idx) => {
                                if (idx !== k || !item.ok) return item;
                                const nextAns = [...item.answers];
                                nextAns[i] = {
                                  ...(nextAns[i] ?? { note: '' }),
                                  value: v,
                                  confidence: 'high',
                                };
                                return { ...item, answers: nextAns };
                              }),
                            );
                          }}
                        />
                        <span
                          className={`qkey${itemSummary?.status === 'wrong' ? ' bad' : ''}`}
                        >
                          {qDef.type === 'test'
                            ? itemSummary?.status === 'wrong'
                              ? `→${qKey || '?'}`
                              : qKey || '?'
                            : `≤${qDef.max}`}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {msgs.map(([c, t], mi) => (
                  <div key={mi} className={`msg ${c}`}>
                    {t}
                  </div>
                ))}

                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn small" onClick={() => handlePutOne(k)}>
                    Cədvələ yaz
                  </button>
                  {s.previews.length < MAX_PAGES_PER_STUDENT && (
                    <label className="btn ghost small filebtn">
                      + Səhifə əlavə et
                      <input
                        type="file"
                        accept="image/*"
                        disabled={busy}
                        onChange={(e) => handleAddPage(k, e)}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => onSetTestScans((prev) => prev.filter((_, idx) => idx !== k))}
                  >
                    Sil
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
