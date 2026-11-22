import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { KsqState, ScanItem, TestPaperScanItem } from '../types/ksq';
import { cellState, fmt, hasData, scoreOf } from '../utils/ksq';
import { OMR } from '../utils/omr';
import { TestPaperScanCard } from './TestPaperScanCard';

interface AnswersViewProps {
  state: KsqState;
  scans: ScanItem[];
  onSetScans: React.Dispatch<React.SetStateAction<ScanItem[]>>;
  testScans: TestPaperScanItem[];
  onSetTestScans: React.Dispatch<React.SetStateAction<TestPaperScanItem[]>>;
  onAnswerChange: (studentName: string, qIndex: number, value: string) => void;
  onApplyScanAnswers: (studentName: string, answers: string[]) => number;
  onApplyTestPaperAnswers: (studentName: string, answers: string[]) => number;
  onZoomImage: (src: string) => void;
  onToast: (message: string) => void;
}

export function AnswersView({
  state,
  scans,
  onSetScans,
  testScans,
  onSetTestScans,
  onAnswerChange,
  onApplyScanAnswers,
  onApplyTestPaperAnswers,
  onZoomImage,
  onToast,
}: AnswersViewProps) {
  const [scanStatus, setScanStatus] = useState<string>('');
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const handleScanFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    const added: ScanItem[] = [];
    for (let i = 0; i < files.length; i++) {
      setScanStatus(` Oxunur: ${i + 1} / ${files.length}…`);
      await new Promise((r) => setTimeout(r, 20));
      let res;
      try {
        const url = URL.createObjectURL(files[i]);
        const im = new Image();
        im.src = url;
        await im.decode();
        res = OMR.read(im);
        URL.revokeObjectURL(url);
      } catch {
        res = { ok: false as const, error: 'Şəkil açılmadı.' };
      }

      const key = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      if (res.ok) {
        const si = res.id && res.id <= state.students.length ? res.id - 1 : -1;
        added.push({
          ...res,
          name: files[i].name,
          key,
          done: false,
          si,
        });
      } else {
        added.push({
          ...res,
          name: files[i].name,
          key,
          done: false,
        });
      }
    }
    setScanStatus('');
    onSetScans((prev) => [...prev, ...added]);
  };

  const putScan = (k: number, currentScans: ScanItem[]): { written: boolean; updated?: ScanItem } => {
    const s = currentScans[k];
    if (!s || !s.ok) return { written: false };
    if (s.si < 0) {
      onToast('Əvvəlcə şagirdi seçin');
      return { written: false };
    }
    const n = state.students[s.si];
    const w = onApplyScanAnswers(
      n,
      s.answers.map((a) => a.v),
    );
    onToast(`${n}: ${w} cavab yazıldı`);
    return { written: true, updated: { ...s, done: true } };
  };

  const handlePutOne = (k: number) => {
    const result = putScan(k, scans);
    if (result.written && result.updated) {
      onSetScans((prev) => prev.map((item, idx) => (idx === k ? result.updated! : item)));
    }
  };

  const handlePutAll = () => {
    const cnt: Record<number, number> = {};
    scans.forEach((s) => {
      if (s.ok && s.si >= 0) cnt[s.si] = (cnt[s.si] || 0) + 1;
    });
    let c = 0;
    let skip = 0;
    const nextScans = scans.map((s) => {
      if (!s.ok || s.done) return s;
      const clean = s.si >= 0 && cnt[s.si] === 1 && (s.manual || !s.idFlag);
      if (clean) {
        const n = state.students[s.si];
        onApplyScanAnswers(
          n,
          s.answers.map((a) => a.v),
        );
        c++;
        return { ...s, done: true };
      } else {
        skip++;
        return s;
      }
    });
    onSetScans(nextScans);
    onToast(
      `${c} blank yazıldı` +
        (skip ? `; ${skip} blankı ayrıca yoxlayıb “Cədvələ yaz” düyməsini basın` : ''),
    );
  };

  const used: Record<number, number> = {};
  scans.forEach((s) => {
    if (s.ok && s.si >= 0) used[s.si] = (used[s.si] || 0) + 1;
  });

  const hasPendingScans = scans.some((s) => s.ok && !s.done);
  const qCount = state.q.length;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Enter' && inputRefs.current[idx + 1]) {
      e.preventDefault();
      inputRefs.current[idx + 1]?.focus();
      inputRefs.current[idx + 1]?.select();
    }
  };

  return (
    <section className="view on" id="v-answers">
      <TestPaperScanCard
        state={state}
        testScans={testScans}
        onSetTestScans={onSetTestScans}
        onApplyTestPaperAnswers={onApplyTestPaperAnswers}
        onZoomImage={onZoomImage}
        onToast={onToast}
      />

      <div className="card">
        <h2>Blankları skan et</h2>
        <p className="hint">
          Şagirdlər cavabları “KSQ cavab blankı” (16 sual) üzərində dairəciyi qaraltmaqla işarələyir. Hər blankın şəklini çəkib yükləyin: proqram şagird nömrəsini və cavabları oxuyur. Siyahıdakı nömrə “2. Şagirdlər” bölməsindəki sıra ilə eyni olmalıdır. Blankdakı 1–16 suallar açardakı eyni nömrəli test suallarına yazılır.
        </p>
        <p className="hint" style={{ marginTop: -6 }}>
          Şəkil çəkərkən: vərəq düz səthdə olsun, 4 qara kvadratın hamısı kadra düşsün, kölgə salmayın.
        </p>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <a
            className="btn ghost"
            href="KSQ_cavab_blanki_16.pdf"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Cavab blankını aç (çap üçün)
          </a>
          <label className="btn filebtn">
            Şəkil seç / çək
            <input type="file" id="scan-in" accept="image/*" multiple onChange={handleScanFiles} />
          </label>
          {hasPendingScans && (
            <button type="button" className="btn ghost" id="b-scan-all" onClick={handlePutAll}>
              Hamısını cədvələ yaz
            </button>
          )}
          <span id="scan-status" className="hint" style={{ margin: 0 }}>
            {scanStatus}
          </span>
        </div>

        <div id="scans">
          {scans.map((s, k) => {
            if (!s.ok) {
              return (
                <div className="scan" key={s.key}>
                  <div className="body">
                    <b>{s.name}</b>
                    <div className="msg bad">{s.error}</div>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => onSetScans((prev) => prev.filter((_, idx) => idx !== k))}
                    >
                      Sil
                    </button>
                  </div>
                </div>
              );
            }

            const msgs: Array<[string, string]> = [];
            if (s.done) msgs.push(['ok', 'Cədvələ yazıldı.']);
            if (s.id === null) msgs.push(['bad', 'Şagird nömrəsi oxunmadı – siyahıdan seçin.']);
            else if (s.id < 1 || s.id > state.students.length) {
              msgs.push([
                'bad',
                `Blankda ${s.id} nömrəsi işarələnib, siyahıda belə nömrə yoxdur – şagirdi seçin.`,
              ]);
            }
            if (s.idFlag) msgs.push(['warn', 'Nömrə: ' + s.idFlag + '.']);
            if (s.si >= 0 && used[s.si] > 1) {
              msgs.push(['warn', 'Bu şagird üçün birdən çox blank var.']);
            }
            if (s.si >= 0 && hasData(state.ans, state.students[s.si]) && !s.done) {
              msgs.push(['warn', 'Bu şagirdin cədvəldə cavabları var – yazanda əvəz olunacaq.']);
            }
            const fl = s.answers
              .map((a, i) => (a.flag ? `${i + 1} (${a.flag})` : ''))
              .filter(Boolean);
            if (fl.length) msgs.push(['warn', 'Yoxlayın: ' + fl.join('; ')]);
            const blank = s.answers.filter((a) => !a.v && !a.flag).length;
            if (blank) msgs.push(['', `${blank} sual cavabsızdır.`]);

            return (
              <div className={`scan${s.done ? ' done' : ''}`} key={s.key}>
                <img
                  src={s.preview}
                  alt={`blank ${s.name}`}
                  onClick={() => onZoomImage(s.preview)}
                />
                <div className="body">
                  <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    Şagird
                    <select
                      className="ksq-select"
                      value={s.si}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onSetScans((prev) =>
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
                  <div className="qs">
                    {s.answers.map((a, i) => (
                      <label key={i}>
                        {i + 1}
                        <input
                          aria-label={`Skan ${k + 1} sual ${i + 1}`}
                          value={a.v}
                          maxLength={1}
                          className={a.flag ? 'fl' : ''}
                          onChange={(e) => {
                            const v = e.target.value
                              .toUpperCase()
                              .replace(/[^A-E]/g, '')
                              .slice(0, 1);
                            onSetScans((prev) =>
                              prev.map((item, idx) => {
                                if (idx !== k || !item.ok) return item;
                                const nextAnswers = item.answers.map((ans, qi) =>
                                  qi === i ? { ...ans, v, flag: '' } : ans,
                                );
                                return { ...item, answers: nextAnswers };
                              }),
                            );
                          }}
                        />
                      </label>
                    ))}
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
                      onClick={() => onSetScans((prev) => prev.filter((_, idx) => idx !== k))}
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

      <div className="card">
        <h2>Şagird cavabları</h2>
        <p className="hint">
          Test sualına şagirdin seçdiyi hərfi, açıq suala aldığı balı yazın. Boş xana cavab verilməmiş sayılır. Xanalar dərhal rənglənir. Enter növbəti xanaya keçirir.
        </p>
        <div className="tw" style={{ maxHeight: '70vh' }}>
          <table id="t-ans" className="ksq-table">
            {!state.students.length ? (
              <tbody>
                <tr>
                  <td className="empty">Əvvəlcə “2. Şagirdlər” bölməsində siyahını daxil edin.</td>
                </tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr>
                    <th className="name">Şagird</th>
                    {state.q.map((q, i) => (
                      <th key={i}>
                        {i + 1}
                        <br />
                        <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                          {q.type === 'test' ? q.key || '?' : `≤${q.max}`}
                        </span>
                      </th>
                    ))}
                    <th>Bal</th>
                  </tr>
                </thead>
                <tbody>
                  {state.students.map((n, si) => {
                    const a = state.ans[n] || [];
                    const pts = scoreOf(state, n).pts;
                    return (
                      <tr key={`${si}-${n}`}>
                        <td className="name">
                          {si + 1}. {n}
                        </td>
                        {state.q.map((q, qi) => {
                          const v = a[qi] ?? '';
                          const idx = si * qCount + qi;
                          return (
                            <td key={qi} className={cellState(q, v)}>
                              <input
                                ref={(el) => {
                                  inputRefs.current[idx] = el;
                                }}
                                aria-label={`${n} sual ${qi + 1}`}
                                value={v}
                                inputMode={q.type === 'open' ? 'decimal' : undefined}
                                onChange={(e) => {
                                  let next = e.target.value.trim();
                                  if (q.type === 'test') {
                                    next = next
                                      .toUpperCase()
                                      .replace(/[^A-E]/g, '')
                                      .slice(0, 1);
                                  } else {
                                    next = next.replace(',', '.').replace(/[^0-9.]/g, '');
                                    if (next !== '' && Number(next) > q.max) {
                                      next = String(q.max);
                                    }
                                  }
                                  onAnswerChange(n, qi, next);
                                  if (q.type === 'test' && next && inputRefs.current[idx + 1]) {
                                    inputRefs.current[idx + 1]?.focus();
                                  }
                                }}
                                onKeyDown={(e) => handleKeyDown(e, idx)}
                              />
                            </td>
                          );
                        })}
                        <td id={`sum-${si}`}>
                          <b>{fmt(pts)}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
        </div>
        <div className="legend">
          <span style={{ background: 'var(--ok-soft)' }} />
          düzgün
          <span style={{ background: 'var(--bad-soft)' }} />
          yanlış / 0 bal
          <span style={{ background: 'var(--warn-soft)' }} />
          qismən bal
        </div>
      </div>
    </section>
  );
}
