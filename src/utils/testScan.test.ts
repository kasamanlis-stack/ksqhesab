import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStudentIndex, summarizeScanVsKey } from './testScan';
import type { Question } from '../types/ksq';

test('matchStudentIndex handles Azerbaijani characters and reversed name order', () => {
  const students = ['Əliyev Murad', 'Həsənova Leyla', 'Şıxəliyev Rauf'];
  assert.equal(matchStudentIndex('Əliyev Murad', students), 0);
  assert.equal(matchStudentIndex('Murad Aliyev', students), 0);
  assert.equal(matchStudentIndex('Murad Eliyev', students), 0);
  assert.equal(matchStudentIndex('Leyla Həsənova', students), 1);
  assert.equal(matchStudentIndex('Sixeliyev Rauf', students), 2);
  assert.equal(matchStudentIndex('Kərimova Nərmin', students), -1);
  assert.equal(matchStudentIndex(null, students), -1);
});

test('summarizeScanVsKey accurately counts correct, wrong, blank, partial, and grade', () => {
  const questions: Question[] = [
    { type: 'test', key: 'A', max: 1, topic: '' },
    { type: 'test', key: 'B', max: 1, topic: '' },
    { type: 'test', key: 'C', max: 1, topic: '' },
    { type: 'open', key: '', max: 2, topic: '' },
  ];
  const scale = { s3: 31, s4: 61, s5: 81, hard: 50 };
  const summary = summarizeScanVsKey(questions, ['A', 'D', '', '1.5'], scale);

  assert.equal(summary.correctCount, 1);
  assert.equal(summary.wrongCount, 1);
  assert.equal(summary.blankCount, 1);
  assert.equal(summary.pts, 2.5);
  assert.equal(summary.maxPts, 5);
  assert.equal(summary.pct, 50);
  assert.equal(summary.grade, 3);
  assert.equal(summary.items[0].status, 'correct');
  assert.equal(summary.items[1].status, 'wrong');
  assert.equal(summary.items[2].status, 'blank');
  assert.equal(summary.items[3].status, 'partial');
});
