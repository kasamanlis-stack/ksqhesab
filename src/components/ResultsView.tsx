import { useState } from 'react';
import type { KsqState, SortMode } from '../types/ksq';
import {
  buildResultsCsv,
  buildResultsTsv,
  classStats,
  fmt,
  hasData,
  maxTotal,
  scoreOf,
} from '../utils/ksq';

interface ResultsViewProps {
  state: KsqState;
  onCopyText: (text: string) => void;
}

export function ResultsView({ state, onCopyText }: ResultsViewProps) {
  const [sort, setSort] = useState<SortMode>('list');
  const c = classStats(state);
  const mt = maxTotal(state.q);
  const nt = state.q.filter((q) => q.type === 'test').length;

  const kpis: Array<[string, string]> = [
    ['İştirak', `${c.k} / ${state.students.length}`],
    ['Orta nəticə', `${fmt(c.avg)}%`],
    ['Orta qiymət', fmt(c.avgGrade)],
    ['Mənimsəmə (3–5)', `${fmt(c.mastery)}%`],
    ['Keyfiyyət (4–5)', `${fmt(c.quality)}%`],
    ['Maks. bal', fmt(mt)],
  ];

  const rows = state.students.map((n, i) => ({
    i,
    n,
    has: hasData(state.ans, n),
    ...scoreOf(state, n),
  }));
  if (sort !== 'list') {
    rows.sort(
      (a, b) =>
        Number(b.has) - Number(a.has) || (sort === 'desc' ? b.pct - a.pct : a.pct - b.pct),
    );
  }

  const handleDownloadCsv = () => {
    const csv = buildResultsCsv(state);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download =
      (['KSQ', state.meta.cls, state.meta.title].filter(Boolean).join('_') || 'KSQ') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <section className="view on" id="v-results">
      <div className="kpis" id="kpis">
        {kpis.map(([l, v]) => (
          <div className="kpi" key={l}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Şagirdlər üzrə nəticələr</h2>
        <div className="row" style={{ margin: '6px 0 12px' }}>
          <button
            type="button"
            className="btn ghost small"
            id="b-copy-res"
            onClick={() => onCopyText(buildResultsTsv(state))}
          >
            Cədvəli kopyala (Excel/Word üçün)
          </button>
          <button
            type="button"
            className="btn ghost small"
            id="b-csv"
            title="Qiymət cədvəlini CSV formatında yüklə"
            onClick={handleDownloadCsv}
          >
            Excel-ə ixrac
          </button>
          <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            Sırala
            <select
              id="sort"
              className="ksq-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
            >
              <option value="list">siyahı üzrə</option>
              <option value="desc">nəticə ↓</option>
              <option value="asc">nəticə ↑</option>
            </select>
          </label>
        </div>

        <div className="tw">
          <table id="t-res" className="ksq-table">
            {!state.students.length ? (
              <tbody>
                <tr>
                  <td className="empty">Şagird siyahısı boşdur.</td>
                </tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>№</th>
                    <th className="name">Şagird</th>
                    {nt > 0 && <th>Düzgün test</th>}
                    <th>Bal</th>
                    <th>Faiz</th>
                    <th style={{ minWidth: 140 }} />
                    <th>Qiymət</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) =>
                    !r.has ? (
                      <tr key={`${r.i}-${r.n}`}>
                        <td>{r.i + 1}</td>
                        <td className="name">{r.n}</td>
                        {nt > 0 && <td>–</td>}
                        <td>–</td>
                        <td>–</td>
                        <td />
                        <td>
                          <span className="hint">iştirak etməyib</span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={`${r.i}-${r.n}`}>
                        <td>{r.i + 1}</td>
                        <td className="name">{r.n}</td>
                        {nt > 0 && (
                          <td>
                            {r.correct} / {nt}
                          </td>
                        )}
                        <td>
                          {fmt(r.pts)} / {fmt(mt)}
                        </td>
                        <td>
                          <b>{fmt(r.pct)}%</b>
                        </td>
                        <td>
                          <div className="bar">
                            <i style={{ width: `${Math.min(100, r.pct)}%` }} />
                          </div>
                        </td>
                        <td>
                          <span className={`grade g${r.grade}`}>{r.grade}</span>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </section>
  );
}
