import type {
  CellState,
  ClassStats,
  GradeScale,
  KsqState,
  Question,
  QuestionStat,
  StudentScore,
} from '../types/ksq';

export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
export const STORAGE_KEY = 'ksq-hesablayici-v1';

export function blankQ(): Question {
  return { type: 'test', key: '', max: 1, topic: '' };
}

export function createInitialState(): KsqState {
  const q: Question[] = [];
  for (let i = 0; i < 16; i++) {
    q.push(blankQ());
  }
  return {
    meta: { cls: '', subject: '', title: '', date: '' },
    scale: { s3: 31, s4: 61, s5: 81, hard: 50 },
    q,
    students: [],
    ans: {},
  };
}

export function loadState(): KsqState {
  const base = createInitialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<KsqState>;
      Object.assign(base, parsed);
    }
  } catch {
    // ignore storage parse failures
  }
  if (!base.q || !base.q.length) {
    base.q = [];
    for (let i = 0; i < 16; i++) {
      base.q.push(blankQ());
    }
  }
  return base;
}

export function fmt(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace('.', ',');
}

export function cellState(q: Question, v: string | undefined): CellState {
  if (v === undefined || v === '') return '';
  if (q.type === 'test') return v === q.key ? 'c' : 'x';
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  if (n >= q.max && q.max > 0) return 'c';
  if (n <= 0) return 'x';
  return 'p';
}

export function maxTotal(questions: Question[]): number {
  return questions.reduce((s, q) => s + (Number(q.max) || 0), 0);
}

export function qPts(q: Question, v: string | undefined): number {
  if (v === undefined || v === '') return 0;
  if (q.type === 'test') return v === q.key ? Number(q.max) || 0 : 0;
  return Math.min(Number(v) || 0, Number(q.max) || 0);
}

export function gradeOf(p: number, scale: GradeScale): 2 | 3 | 4 | 5 {
  const r = Math.round(p);
  return r >= scale.s5 ? 5 : r >= scale.s4 ? 4 : r >= scale.s3 ? 3 : 2;
}

export function scoreOf(state: KsqState, studentName: string): StudentScore {
  const a = state.ans[studentName] || [];
  let pts = 0;
  let correct = 0;
  let answered = 0;
  state.q.forEach((q, i) => {
    const v = a[i];
    if (v !== undefined && v !== '') answered++;
    const p = qPts(q, v);
    pts += p;
    if (q.type === 'test' && v === q.key) correct++;
  });
  const mt = maxTotal(state.q);
  const pct = mt ? (pts / mt) * 100 : 0;
  return {
    pts,
    correct,
    answered,
    pct,
    grade: gradeOf(pct, state.scale),
  };
}

export function hasData(ans: Record<string, string[]>, studentName: string): boolean {
  const a = ans[studentName];
  return Boolean(a && a.some((v) => v !== undefined && v !== ''));
}

export function participants(state: KsqState): string[] {
  return state.students.filter((n) => hasData(state.ans, n));
}

export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function classStats(state: KsqState): ClassStats {
  const ps = participants(state);
  const sc = ps.map((n) => ({ n, ...scoreOf(state, n) }));
  const pcts = sc.map((s) => s.pct);
  const dist: Record<2 | 3 | 4 | 5, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
  sc.forEach((s) => {
    dist[s.grade]++;
  });
  const k = sc.length;
  return {
    sc,
    k,
    avg: k ? pcts.reduce((a, b) => a + b, 0) / k : 0,
    med: median(pcts),
    min: k ? Math.min(...pcts) : 0,
    max: k ? Math.max(...pcts) : 0,
    dist,
    mastery: k ? ((dist[3] + dist[4] + dist[5]) / k) * 100 : 0,
    quality: k ? ((dist[4] + dist[5]) / k) * 100 : 0,
    avgGrade: k ? sc.reduce((a, s) => a + s.grade, 0) / k : 0,
  };
}

export function qStats(state: KsqState): QuestionStat[] {
  const ps = participants(state);
  return state.q.map((q, i) => {
    let got = 0;
    let cnt = 0;
    let blank = 0;
    const opts: Record<string, number> = {};
    ps.forEach((n) => {
      const v = (state.ans[n] || [])[i];
      if (v === undefined || v === '') {
        blank++;
      } else if (q.type === 'test') {
        opts[v] = (opts[v] || 0) + 1;
      }
      got += qPts(q, v);
      cnt++;
    });
    const rate = cnt && q.max ? (got / (cnt * q.max)) * 100 : 0;
    let wrong = '';
    if (q.type === 'test') {
      const w = Object.entries(opts)
        .filter(([k]) => k !== q.key)
        .sort((a, b) => b[1] - a[1])[0];
      if (w) wrong = `${w[0]} (${w[1]})`;
    }
    return { i, q, rate, blank, opts, wrong, cnt };
  });
}

export function reportText(state: KsqState, c: ClassStats, qs: QuestionStat[]): string {
  const m = state.meta;
  const hard = state.scale.hard;
  if (!c.k) return 'Hələ şagird cavabı daxil edilməyib.';
  const head = [m.cls && m.cls + ' sinfi', m.subject, m.title].filter(Boolean).join(', ');
  const hq = qs.filter((s) => s.cnt && s.rate < hard).sort((a, b) => a.rate - b.rate);
  const gq = qs.filter((s) => s.cnt && s.rate >= 75).sort((a, b) => b.rate - a.rate);
  const sorted = [...c.sc].sort((a, b) => b.pct - a.pct);
  const topN = sorted.filter((s) => s.grade === 5).map((s) => s.n);
  let t = '';
  t += `${head || 'KSQ'}${m.date ? ' (' + m.date.split('-').reverse().join('.') + ')' : ''} üzrə nəticələrin təhlili\n\n`;
  t += `Sinifdə ${state.students.length} şagird var, KSQ-də ${c.k} şagird iştirak edib. Qiymətləndirmə ${state.q.length} sual üzrə (maksimal bal: ${fmt(maxTotal(state.q))}) aparılıb.\n\n`;
  t += `Ümumi nəticələr: sinif üzrə orta nəticə ${fmt(c.avg)}%, median ${fmt(c.med)}%, ən yüksək nəticə ${fmt(c.max)}%, ən aşağı nəticə ${fmt(c.min)}% təşkil edir. Orta qiymət ${fmt(c.avgGrade)}-dir.\n`;
  t += `Qiymətlərin bölgüsü: “5” – ${c.dist[5]}, “4” – ${c.dist[4]}, “3” – ${c.dist[3]}, “2” – ${c.dist[2]} şagird. Mənimsəmə göstəricisi ${fmt(c.mastery)}%, keyfiyyət göstəricisi ${fmt(c.quality)}%-dir.\n\n`;
  if (topN.length) t += `Yüksək nəticə göstərən şagirdlər (“5”): ${topN.join(', ')}.\n\n`;
  if (gq.length) {
    t += `Ən yaxşı mənimsənilən suallar: ${gq
      .slice(0, 5)
      .map((s) => s.i + 1 + ' (' + fmt(s.rate) + '%' + (s.q.topic ? ', ' + s.q.topic : '') + ')')
      .join('; ')}.\n\n`;
  }
  if (hq.length) {
    t += `Həll faizi ${hard}%-dən aşağı olan suallar: ${hq
      .map(
        (s) =>
          s.i +
          1 +
          ' (' +
          fmt(s.rate) +
          '%' +
          (s.q.topic ? ', ' + s.q.topic : '') +
          (s.wrong ? ', ən çox seçilən yanlış variant ' + s.wrong : '') +
          ')',
      )
      .join('; ')}.\n`;
    const ht = [...new Set(hq.map((s) => s.q.topic).filter(Boolean))];
    if (ht.length) t += `Bu suallar aşağıdakı mövzu/standartlara aiddir: ${ht.join(', ')}.\n`;
    t += '\n';
  } else {
    t += `Həll faizi ${hard}%-dən aşağı olan sual qeydə alınmayıb.\n\n`;
  }
  t += `Növbəti təlim üçün təkliflər:\n`;
  if (hq.length) {
    t += `– ${hq.map((s) => s.i + 1).join(', ')} nömrəli sualların əhatə etdiyi ${
      [...new Set(hq.map((s) => s.q.topic).filter(Boolean))].join(', ') || 'mövzular'
    } üzrə təkrar və möhkəmləndirmə tapşırıqları planlaşdırılsın.\n`;
  }
  if (c.dist[2]) {
    t += `– “2” qiyməti alan ${c.dist[2]} şagirdlə fərdi iş və əlavə məşğələ təşkil olunsun.\n`;
  }
  t += `– …`;
  return t;
}

export function parseStudentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(Boolean);
}

export function buildResultsTsv(state: KsqState): string {
  const nt = state.q.filter((q) => q.type === 'test').length;
  const lines = [['№', 'Şagird', ...(nt ? ['Düzgün test'] : []), 'Bal', 'Faiz', 'Qiymət'].join('\t')];
  state.students.forEach((n, i) => {
    const r = scoreOf(state, n);
    lines.push(
      hasData(state.ans, n)
        ? [i + 1, n, ...(nt ? [`${r.correct}/${nt}`] : []), fmt(r.pts), `${fmt(r.pct)}%`, r.grade].join('\t')
        : [i + 1, n, ...(nt ? ['–'] : []), '–', '–', 'iştirak etməyib'].join('\t'),
    );
  });
  return lines.join('\n');
}

export function buildResultsCsv(state: KsqState): string {
  const nt = state.q.filter((q) => q.type === 'test').length;
  const head = ['№', 'Şagird', ...state.q.map((_, i) => 'S' + (i + 1)), ...(nt ? ['Düzgün test'] : []), 'Bal', 'Faiz', 'Qiymət'];
  const rows: Array<Array<string | number>> = [head];
  state.students.forEach((n, i) => {
    const r = scoreOf(state, n);
    const a = state.ans[n] || [];
    rows.push(
      hasData(state.ans, n)
        ? [i + 1, n, ...state.q.map((_, qi) => a[qi] ?? ''), ...(nt ? [r.correct] : []), fmt(r.pts), fmt(r.pct), r.grade]
        : [i + 1, n, ...state.q.map(() => ''), ...(nt ? [''] : []), '', '', 'iştirak etməyib'],
    );
  });
  return '\ufeff' + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
}
