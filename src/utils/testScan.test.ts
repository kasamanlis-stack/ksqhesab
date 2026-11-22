import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStudentIndex, mergeScanAnswers, summarizeScanVsKey } from './testScan';
import type { Question, TestPaperAnswerItem } from '../types/ksq';

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

test('summarizeScanVsKey accurately counts correct, wrong, blank, partial, and grade for Variant A and B', () => {
  const questions: Question[] = [
    { type: 'test', key: 'A', keyB: 'C', max: 1, topic: '' },
    { type: 'test', key: 'B', keyB: 'D', max: 1, topic: '' },
    { type: 'test', key: 'C', keyB: 'E', max: 1, topic: '' },
    { type: 'open', key: '', keyB: '', max: 2, topic: '' },
  ];
  const scale = { s3: 31, s4: 61, s5: 81, hard: 50 };
  const summaryA = summarizeScanVsKey(questions, ['A', 'D', '', '1.5'], scale, 'A');

  assert.equal(summaryA.correctCount, 1);
  assert.equal(summaryA.wrongCount, 1);
  assert.equal(summaryA.blankCount, 1);
  assert.equal(summaryA.pts, 2.5);
  assert.equal(summaryA.maxPts, 5);
  assert.equal(summaryA.pct, 50);
  assert.equal(summaryA.grade, 3);
  assert.equal(summaryA.items[0].status, 'correct');
  assert.equal(summaryA.items[1].status, 'wrong');
  assert.equal(summaryA.items[2].status, 'blank');
  assert.equal(summaryA.items[3].status, 'partial');

  // Evaluate against Variant B: C, D, E, max=2
  const summaryB = summarizeScanVsKey(questions, ['C', 'D', 'A', '2'], scale, 'B');
  assert.equal(summaryB.correctCount, 3);
  assert.equal(summaryB.wrongCount, 1);
  assert.equal(summaryB.blankCount, 0);
  assert.equal(summaryB.pts, 4);
  assert.equal(summaryB.pct, 80);
  assert.equal(summaryB.grade, 4);
  assert.equal(summaryB.items[0].correctKey, 'C');
  assert.equal(summaryB.items[2].correctKey, 'E');
});

test('mergeScanAnswers combines Page 1 and Page 2 answers cleanly without losing Page 1 values', () => {
  const page1: TestPaperAnswerItem[] = [
    { value: 'A', confidence: 'high', note: '' },
    { value: 'B', confidence: 'high', note: '' },
    { value: '', confidence: 'low', note: 'sual şəkildə görünmür' },
    { value: '', confidence: 'low', note: 'səhifədə yoxdur' },
    { value: 'C', confidence: 'high', note: '' },
  ];
  const page2: TestPaperAnswerItem[] = [
    { value: '', confidence: 'low', note: 'sual şəkildə görünmür' },
    { value: '', confidence: 'low', note: '' },
    { value: 'D', confidence: 'high', note: '' },
    { value: '', confidence: 'high', note: 'boş qoyulub' },
    { value: 'E', confidence: 'high', note: '' },
  ];

  const merged = mergeScanAnswers(page1, page2);
  assert.equal(merged.length, 5);
  assert.equal(merged[0].value, 'A');
  assert.equal(merged[1].value, 'B');
  assert.equal(merged[2].value, 'D');
  assert.equal(merged[2].confidence, 'high');
  assert.equal(merged[3].value, '');
  assert.equal(merged[3].note, 'boş qoyulub');
  assert.equal(merged[4].value, 'C');
  assert.match(merged[4].note, /E/);
});
