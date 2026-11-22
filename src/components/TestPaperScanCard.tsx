import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { KsqState, TestPaperAnswerItem, TestPaperScanItem } from '../types/ksq';
import { fmt, hasData } from '../utils/ksq';
import { matchStudentIndex, summarizeScanVsKey } from '../utils/testScan';

interface TestPaperScanCardProps {
  state: KsqState;
  testScans: TestPaperScanItem[];
  onSetTestScans: React.Dispatch<React.SetStateAction<TestPaperScanItem[]>>;
  onApplyTestPaperAnswers: (studentName: string, values: string[]) => number;
  onZoomImage: (src: string) => void;
  onToast: (message: string) => void;
}

async function fileToResizedJpeg(
  file: File,
): Promise<{ base64: string; mimeType: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const maxD = 1800;
    const sc = Math.min(1, maxD / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * sc));
    const h = Math.max(1, Math.round(img.height * sc));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d');
    if (!cx) throw new Error('Canvas unavailable');
    cx.drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1] || '';
    return { base64, mimeType: 'image/jpeg', preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
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

  const hasAnyTestKey = state.q.some((q) => (q.type === 'test' ? Boolean(q.key) : q.max > 0));

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    setBusy(true);
    const added: TestPaperScanItem[] = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(` Oxunur: ${i + 1} / ${files.length}…`);
      const key = `tp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const { base64, mimeType, preview } = await fileToResizedJpeg(files[i]);
        const resp = await fetch('/api/scan-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType,
            questions: state.q.map((q, idx) => ({
              number: idx + 1,
              type: q.type,
              max: q.max,
            })),
            students: state.students,
          }),
        });
        const data = (await resp.json()) as {
          ok?: boolean;
          error?: string;
          studentName?: string | null;
          answers?: TestPaperAnswerItem[];
        };
        if (!resp.ok || !data.ok || !Array.isArray(data.answers)) {
          added.push({
            ok: false,
            name: files[i].name,
            key,
            done: false,
            error: data.error || 'Test vərəqi oxunmadı.',
          });
        } else {
          const detectedName = data.studentName || null;
          const si = matchStudentIndex(detectedName, state.students);
          added.push({
            ok: true,
            name: files[i].name,
            key,
            done: false,
            preview,
            detectedName,
            si,
            answers: data.answers,
          });
        }
      } catch {
        added.push({
          ok: false,
          name: files[i].name,
          key,
          done: false,
          error: 'Şəkil yüklənərkən və ya oxunarkən xəta baş verdi.',
        });
      }
    }
    setStatus('');
    setBusy(false);
    onSetTestScans((prev) => [...prev, ...added]);
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
    );
    onSetTestScans((prev) =>
      prev.map((item, idx) => (idx === k && item.ok ? { ...item, done: true } : item)),
    );
    onToast(`${n}: ${w} cavab yazıldı`);
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
        Şagirdin cavab blankı olmadan birbaşa test vərəqinin üzərində işarələdiyi (dairəyə aldığı, altından xətt çəkdiyi və ya qeyd etdiyi) cavabların şəklini çəkib yükləyin. Proqram cavabları oxuyub “1. Açar” bölməsindəki düz cavablarla müqayisə edir: hansının düz, hansının səhv olduğunu və balı dərhal hesablayır.
      </p>
      {!hasAnyTestKey && (
        <div className="msg warn" style={{ marginBottom: 10 }}>
          Əvvəlcə “1. Açar” bölməsində düzgün cavabları daxil edin ki, proqram düz və səhvləri hesablasın.
        </div>
      )}
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <label className="btn filebtn">
          {busy ? 'Oxunur…' : 'Test şəklini seç / çək'}
          <input
            type="file"
            id="test-scan-in"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={handleFiles}
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
          );

          const msgs: Array<[string, string]> = [];
          if (s.done) msgs.push(['ok', 'Cədvələ yazıldı.']);
          if (s.detectedName) {
            msgs.push(['', `Vərəqdə oxunan ad: ${s.detectedName}`]);
          }
          if (s.si < 0) {
            msgs.push(['warn', 'Şagird siyahıdan avtomatik tapılmadı – yuxarıdan seçin.']);
          }
          if (s.si >= 0 && used[s.si] > 1) {
            msgs.push(['warn', 'Bu şagird üçün birdən çox test şəkli var.']);
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
              <img
                src={s.preview}
                alt={`test vərəqi ${s.name}`}
                onClick={() => onZoomImage(s.preview)}
              />
              <div className="body">
                <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  Şagird
                  <select
                    aria-label={`Test skanı ${k + 1} şagird`}
                    className="ksq-select"
                    value={s.si}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onSetTestScans((prev) =>
                        prev.map((item, idx) =>
                          idx === k && item.ok ? { ...item, si: val, manual: true } : item,
                        ),
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
                              ? `→${qDef.key}`
                              : qDef.key || '?'
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
