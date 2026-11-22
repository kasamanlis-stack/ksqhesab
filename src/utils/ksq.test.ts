import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResultsCsv,
  buildResultsTsv,
  cellState,
  classStats,
  createInitialState,
  fmt,
  gradeOf,
  maxTotal,
  median,
  parseStudentLines,
  qPts,
  qStats,
  reportText,
  scoreOf,
} from './ksq';

test('fmt formats numbers with comma decimal and 1 decimal place', () => {
  assert.equal(fmt(10), '10');
  assert.equal(fmt(81.26), '81,3');
  assert.equal(fmt(0), '0');
});

test('parseStudentLines strips numbering and blank lines', () => {
  const input = '1. Əliyev Murad\n2) Həsənova Leyla\n\n  3. Məmmədov Tural  \n';
  assert.deepEqual(parseStudentLines(input), [
    'Əliyev Murad',
    'Həsənova Leyla',
    'Məmmədov Tural',
  ]);
});

test('cellState and qPts handle test, Variant A/B, and open questions accurately', () => {
  const testQ = { type: 'test' as const, key: 'B', keyB: 'D', max: 2, topic: '1.1' };
  const openQ = { type: 'open' as const, key: '', keyB: '', max: 4, topic: '2.1' };

  assert.equal(cellState(testQ, '', 'A'), '');
  assert.equal(cellState(testQ, 'B', 'A'), 'c');
  assert.equal(cellState(testQ, 'A', 'A'), 'x');
  assert.equal(qPts(testQ, 'B', 'A'), 2);
  assert.equal(qPts(testQ, 'A', 'A'), 0);

  assert.equal(cellState(testQ, 'D', 'B'), 'c');
  assert.equal(cellState(testQ, 'B', 'B'), 'x');
  assert.equal(qPts(testQ, 'D', 'B'), 2);
  assert.equal(qPts(testQ, 'B', 'B'), 0);

  assert.equal(cellState(openQ, ''), '');
  assert.equal(cellState(openQ, '4'), 'c');
  assert.equal(cellState(openQ, '2.5'), 'p');
  assert.equal(cellState(openQ, '0'), 'x');
  assert.equal(qPts(openQ, '2.5'), 2.5);
  assert.equal(qPts(openQ, '6'), 4);
});

test('gradeOf respects rounded percentage thresholds', () => {
  const scale = { s3: 31, s4: 61, s5: 81, hard: 50 };
  assert.equal(gradeOf(30.4, scale), 2);
  assert.equal(gradeOf(30.6, scale), 3);
  assert.equal(gradeOf(60.6, scale), 4);
  assert.equal(gradeOf(80.5, scale), 5);
});

test('median, classStats, qStats, reportText, TSV and CSV compute consistently with A/B variants', () => {
  assert.equal(median([]), 0);
  assert.equal(median([10, 30, 20]), 20);
  assert.equal(median([10, 40, 20, 30]), 25);

  const state = createInitialState();
  state.meta = { cls: '7A', subject: 'Ədəbiyyat', title: 'KSQ-2', date: '2026-11-22' };
  state.q = [
    { type: 'test', key: 'A', keyB: 'D', max: 1, topic: '1.1.1' },
    { type: 'test', key: 'B', keyB: 'E', max: 1, topic: '1.1.1' },
    { type: 'open', key: '', keyB: '', max: 2, topic: '2.2.1' },
  ];
  state.students = ['Əliyev Murad', 'Həsənova Leyla', 'Quliyev Rauf'];
  state.studentVariants = {
    'Əliyev Murad': 'A',
    'Həsənova Leyla': 'B',
  };
  state.ans = {
    'Əliyev Murad': ['A', 'B', '2'], // Var A: 4/4 = 100% -> 5
    'Həsənova Leyla': ['D', 'C', '0'], // Var B: Q1='D' correct (1), Q2='C' wrong vs 'E' (0), Q3=0 -> 1/4 = 25% -> 2
    // Quliyev Rauf absent
  };

  assert.equal(maxTotal(state.q), 4);
  const s1 = scoreOf(state, 'Əliyev Murad');
  assert.equal(s1.pts, 4);
  assert.equal(s1.correct, 2);
  assert.equal(s1.pct, 100);
  assert.equal(s1.grade, 5);

  const s2 = scoreOf(state, 'Həsənova Leyla');
  assert.equal(s2.pts, 1);
  assert.equal(s2.correct, 1);
  assert.equal(s2.pct, 25);
  assert.equal(s2.grade, 2);

  const c = classStats(state);
  assert.equal(c.k, 2);
  assert.equal(c.avg, 62.5);
  assert.equal(c.med, 62.5);
  assert.equal(c.dist[5], 1);
  assert.equal(c.dist[2], 1);
  assert.equal(c.mastery, 50);
  assert.equal(c.quality, 50);

  const qs = qStats(state);
  assert.equal(qs[0].rate, 100);
  assert.equal(qs[1].rate, 50);
  assert.equal(qs[1].wrong, 'C (1)');
  assert.equal(qs[2].rate, 50);

  const rep = reportText(state, c, qs);
  assert.match(rep, /7A sinfi, Ədəbiyyat, KSQ-2 \(22\.11\.2026\)/);
  assert.match(rep, /Sinifdə 3 şagird var, KSQ-də 2 şagird iştirak edib/);
  assert.match(rep, /Yüksək nəticə göstərən şagirdlər \(“5”\): Əliyev Murad/);

  const tsv = buildResultsTsv(state);
  assert.match(tsv, /Əliyev Murad\tA\t2\/2\t4\t100%\t5/);
  assert.match(tsv, /Həsənova Leyla\tB\t1\/2\t1\t25%\t2/);
  assert.match(tsv, /Quliyev Rauf\tA\t–\t–\t–\tiştirak etməyib/);

  const csv = buildResultsCsv(state);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"1";"Əliyev Murad";"A";"A";"B";"2";"2";"4";"100";"5"/);
  assert.match(csv, /"2";"Həsənova Leyla";"B";"D";"C";"0";"1";"1";"25";"2"/);
});
