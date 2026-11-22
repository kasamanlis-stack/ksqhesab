import type { GradeScale, Question, TestPaperAnswerItem, VariantId } from '../types/ksq';
import { cellState, getQuestionKey, gradeOf, maxTotal, qPts } from './ksq';

function normalizeAz(text: string): string {
  return text
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchStudentIndex(
  detectedName: string | null | undefined,
  students: string[],
): number {
  if (!detectedName || !students.length) return -1;
  const target = normalizeAz(detectedName);
  if (!target) return -1;

  // 1. Exact normalized match
  const exactIdx = students.findIndex((s) => normalizeAz(s) === target);
  if (exactIdx >= 0) return exactIdx;

  // 2. Token overlap (handles "Murad Əliyev" vs "Əliyev Murad")
  const targetTokens = target.split(' ').filter((t) => t.length >= 2);
  if (!targetTokens.length) return -1;

  let bestIdx = -1;
  let bestScore = 0;
  let tied = false;

  students.forEach((student, idx) => {
    const sNorm = normalizeAz(student);
    const sTokens = sNorm.split(' ').filter((t) => t.length >= 2);
    if (!sTokens.length) return;
    let matches = 0;
    for (const tok of targetTokens) {
      if (sTokens.includes(tok)) matches++;
    }
    const ratio = matches / Math.max(targetTokens.length, sTokens.length);
    if (matches > 0 && (ratio > bestScore || (matches === sTokens.length && bestScore < 1))) {
      bestScore = ratio;
      bestIdx = idx;
      tied = false;
    } else if (matches > 0 && ratio === bestScore) {
      tied = true;
    }
  });

  return bestScore >= 0.5 && !tied ? bestIdx : -1;
}

export function mergeScanAnswers(
  existing: TestPaperAnswerItem[],
  incoming: TestPaperAnswerItem[],
): TestPaperAnswerItem[] {
  const len = Math.max(existing.length, incoming.length);
  const merged: TestPaperAnswerItem[] = [];
  for (let i = 0; i < len; i++) {
    const cur = existing[i] ?? { value: '', confidence: 'low' as const, note: '' };
    const inc = incoming[i] ?? { value: '', confidence: 'low' as const, note: '' };

    if (cur.value === '' && inc.value !== '') {
      merged.push(inc);
    } else if (cur.value !== '' && inc.value === '') {
      merged.push(cur);
    } else if (cur.value !== '' && inc.value !== '') {
      if (cur.value === inc.value) {
        merged.push({
          value: cur.value,
          confidence: cur.confidence === 'high' || inc.confidence === 'high' ? 'high' : cur.confidence,
          note: cur.note || inc.note,
        });
      } else if (cur.confidence === 'low' && inc.confidence !== 'low') {
        merged.push(inc);
      } else {
        merged.push({
          ...cur,
          confidence: 'medium',
          note: cur.note
            ? `${cur.note}; digər səhifədə: ${inc.value}`
            : `digər səhifədə fərqli işarə: ${inc.value}`,
        });
      }
    } else {
      const notVisible = (s: string) => /görünmür|yoxdur/i.test(s);
      const note =
        cur.note && !notVisible(cur.note)
          ? cur.note
          : inc.note && !notVisible(inc.note)
            ? inc.note
            : cur.note || inc.note;
      merged.push({
        value: '',
        confidence: cur.confidence,
        note,
      });
    }
  }
  return merged;
}

export interface TestScanSummaryItem {
  qNum: number;
  type: 'test' | 'open';
  studentValue: string;
  correctKey: string;
  status: 'correct' | 'wrong' | 'blank' | 'partial' | 'unkeyed';
  pts: number;
  max: number;
}

export interface TestScanSummary {
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  unkeyedCount: number;
  pts: number;
  maxPts: number;
  pct: number;
  grade: 2 | 3 | 4 | 5;
  hasAnyKey: boolean;
  items: TestScanSummaryItem[];
}

export function summarizeScanVsKey(
  questions: Question[],
  scannedValues: string[],
  scale: GradeScale,
  variant: VariantId = 'A',
): TestScanSummary {
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  let unkeyedCount = 0;
  let pts = 0;
  const maxPts = maxTotal(questions);
  const hasAnyKey = questions.some((q) =>
    q.type === 'test' ? Boolean(getQuestionKey(q, variant)) : q.max > 0,
  );

  const items: TestScanSummaryItem[] = questions.map((q, i) => {
    const v = scannedValues[i] ?? '';
    const key = getQuestionKey(q, variant);
    const p = qPts(q, v, variant);
    pts += p;

    if (v === '') {
      blankCount++;
      return {
        qNum: i + 1,
        type: q.type,
        studentValue: v,
        correctKey: key,
        status: 'blank',
        pts: 0,
        max: q.max,
      };
    }

    if (q.type === 'test' && !key) {
      unkeyedCount++;
      return {
        qNum: i + 1,
        type: q.type,
        studentValue: v,
        correctKey: '',
        status: 'unkeyed',
        pts: 0,
        max: q.max,
      };
    }

    const st = cellState(q, v, variant);
    if (st === 'c') {
      correctCount++;
      return {
        qNum: i + 1,
        type: q.type,
        studentValue: v,
        correctKey: key,
        status: 'correct',
        pts: p,
        max: q.max,
      };
    }
    if (st === 'p') {
      return {
        qNum: i + 1,
        type: q.type,
        studentValue: v,
        correctKey: key,
        status: 'partial',
        pts: p,
        max: q.max,
      };
    }
    wrongCount++;
    return {
      qNum: i + 1,
      type: q.type,
      studentValue: v,
      correctKey: key,
      status: 'wrong',
      pts: p,
      max: q.max,
    };
  });

  const pct = maxPts ? (pts / maxPts) * 100 : 0;
  return {
    correctCount,
    wrongCount,
    blankCount,
    unkeyedCount,
    pts,
    maxPts,
    pct,
    grade: gradeOf(pct, scale),
    hasAnyKey,
    items,
  };
}
