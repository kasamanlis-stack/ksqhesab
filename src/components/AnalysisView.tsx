import { useState } from 'react';
import type { KsqState, QuestionStat } from '../types/ksq';
import { classStats, fmt, qStats, reportText } from '../utils/ksq';

interface AnalysisViewProps {
  state: KsqState;
  onCopyText: (text: string) => void;
  onResetAll: () => void;
}

export function AnalysisView({ state, onCopyText, onResetAll }: AnalysisViewProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const c = classStats(state);
  const qs = qStats(state);
  const hard = state.scale.hard;

  const topics: Record<string, QuestionStat[]> = {};
  qs.forEach((s) => {
    const t = (s.q.topic || '').trim();
    if (!t) return;
    (topics[t] = topics[t] || []).push(s);
  });
  const topicRows = Object.keys(topics)
    .map((t) => {
      const arr = topics[t];
      return {
        t,
        arr,
        r: arr.reduce((a, s) => a + s.rate, 0) / arr.length,
      };
    })
    .sort((a, b) => a.r - b.r);

  const report = reportText(state, c, qs);

  return (
    <section className="view on" id="v-analysis">
      <div className="card">
        <h2>Qiymətlərin bölgüsü</h2>
        <div className="dist" id="dist">
          {([5, 4, 3, 2] as const).map((g) => {
            const p = c.k ? (c.dist[g] / c.k) * 100 : 0;
            return (
              <div className="d" key={g}>
                <span className={`grade g${g}`}>{g}</span>{' '}
                <b style={{ fontSize: 20, marginLeft: 6 }}>{c.dist[g]}</b>{' '}
                <span className="hint">
                  şagird · {fmt(p)}%
                </span>
                <div className="bar" style={{ marginTop: 8 }}>
                  <i style={{ width: `${p}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Suallar üzrə həll faizi</h2>
        <p className="hint">
          Həll faizi = sual üzrə toplanan bal ÷ mümkün maksimal bal. Çətin sual həddindən aşağı olan suallar işarələnir.
        </p>
        <div className="tw">
          <table id="t-q" className="ksq-table">
            <thead>
              <tr>
                <th>Sual</th>
                <th>Növ</th>
                <th style={{ textAlign: 'left' }}>Mövzu / standart</th>
                <th>Açar</th>
                <th>Həll faizi</th>
                <th style={{ minWidth: 140 }} />
                <th>Ən çox seçilən yanlış variant</th>
                <th>Cavabsız</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {qs.map((s) => (
                <tr key={s.i}>
                  <td>
                    <b>{s.i + 1}</b>
                  </td>
                  <td>{s.q.type === 'test' ? 'Test' : 'Açıq'}</td>
                  <td style={{ textAlign: 'left' }}>{s.q.topic || '–'}</td>
                  <td>{s.q.type === 'test' ? s.q.key || '?' : `≤${s.q.max}`}</td>
                  <td>
                    <b>{fmt(s.rate)}%</b>
                  </td>
                  <td>
                    <div className="bar">
                      <i style={{ width: `${s.rate}%` }} />
                    </div>
                  </td>
                  <td>{s.wrong || '–'}</td>
                  <td>{s.blank}</td>
                  <td>
                    {!s.cnt ? null : s.rate < hard ? (
                      <span className="tag bad">çətin</span>
                    ) : s.rate < 75 ? (
                      <span className="tag warn">orta</span>
                    ) : (
                      <span className="tag ok">yaxşı</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {topicRows.length > 0 && (
        <div className="card" id="topic-card">
          <h2>Mövzu / standart üzrə</h2>
          <div className="tw">
            <table id="t-topic" className="ksq-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Mövzu / standart</th>
                  <th>Suallar</th>
                  <th>Orta həll faizi</th>
                  <th style={{ minWidth: 140 }} />
                </tr>
              </thead>
              <tbody>
                {topicRows.map((o) => (
                  <tr key={o.t}>
                    <td style={{ textAlign: 'left' }}>{o.t}</td>
                    <td>{o.arr.map((s) => s.i + 1).join(', ')}</td>
                    <td>
                      <b>{fmt(o.r)}%</b>{' '}
                      {o.r < hard && <span className="tag bad">çətin</span>}
                    </td>
                    <td>
                      <div className="bar">
                        <i style={{ width: `${o.r}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Arayış üçün mətn</h2>
        <p className="hint">
          Rəqəmlər daxil etdiyiniz məlumatdan hesablanıb. Kopyalayıb hesabata yapışdıra, növbəti təlim üçün təklifləri özünüz tamamlaya bilərsiniz.
        </p>
        <pre className="out" id="report">
          {report}
        </pre>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn ghost small"
            id="b-copy-rep"
            onClick={() => onCopyText(report)}
          >
            Mətni kopyala
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Məlumatlar</h2>
        <p className="hint">
          Məlumatlar yalnız bu brauzerdə saxlanır. Başqa sinif üçün yeni KSQ-yə başlamazdan əvvəl nəticələri kopyalayın.
        </p>
        <button
          type="button"
          className="btn danger small"
          id="b-reset"
          onClick={() => setConfirmReset(true)}
        >
          Hamısını sil və yenidən başla
        </button>
        {confirmReset && (
          <span id="reset-confirm" style={{ marginLeft: 8 }}>
            Əminsiniz?{' '}
            <button
              type="button"
              className="btn danger small"
              id="b-reset-yes"
              onClick={() => {
                setConfirmReset(false);
                onResetAll();
              }}
            >
              Bəli, sil
            </button>{' '}
            <button
              type="button"
              className="btn ghost small"
              id="b-reset-no"
              onClick={() => setConfirmReset(false)}
            >
              Xeyr
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
