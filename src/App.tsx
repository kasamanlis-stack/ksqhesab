import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisView } from './components/AnalysisView';
import { AnswersView } from './components/AnswersView';
import { ResultsView } from './components/ResultsView';
import { SetupView } from './components/SetupView';
import { StudentsView } from './components/StudentsView';
import type {
  GradeScale,
  KsqMeta,
  KsqState,
  Question,
  ScanItem,
  TestPaperScanItem,
  VariantId,
  ViewId,
} from './types/ksq';
import {
  blankQ,
  createInitialState,
  loadState,
  parseStudentLines,
  STORAGE_KEY,
} from './utils/ksq';

const NAV_TABS: Array<{ id: ViewId; label: string }> = [
  { id: 'setup', label: '1. Açar' },
  { id: 'students', label: '2. Şagirdlər' },
  { id: 'answers', label: '3. Cavablar' },
  { id: 'results', label: '4. Nəticələr' },
  { id: 'analysis', label: '5. Təhlil' },
];

export default function App() {
  const [view, setView] = useState<ViewId>('setup');
  const [state, setState] = useState<KsqState>(() => loadState());
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [testScans, setTestScans] = useState<TestPaperScanItem[]>([]);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const stateRef = useRef<KsqState>(state);
  stateRef.current = state;
  const saveTimerRef = useRef<number | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const saveDebounced = useCallback((nextState: KsqState) => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch {
        // ignore storage quota errors
      }
    }, 250);
  }, []);

  const saveNow = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    const onPageHide = () => saveNow();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(saveTimerRef.current);
      window.clearTimeout(toastTimerRef.current);
    };
  }, [saveNow]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 1600);
  }, []);

  const copyText = useCallback(
    (txt: string) => {
      const fallback = (text: string) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          toast('Kopyalandı');
        } catch {
          toast('Kopyalamaq alınmadı');
        }
        ta.remove();
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          () => toast('Kopyalandı'),
          () => fallback(txt),
        );
      } else {
        fallback(txt);
      }
    },
    [toast],
  );

  const updateState = useCallback(
    (updater: (prev: KsqState) => KsqState) => {
      setState((prev) => {
        const next = updater(prev);
        saveDebounced(next);
        return next;
      });
    },
    [saveDebounced],
  );

  const handleShowView = (nextView: ViewId) => {
    setView(nextView);
    window.scrollTo(0, 0);
  };

  const handleMetaChange = (field: keyof KsqMeta, value: string) => {
    updateState((prev) => ({
      ...prev,
      meta: { ...prev.meta, [field]: value },
    }));
  };

  const handleScaleChange = (field: keyof GradeScale, value: number) => {
    updateState((prev) => ({
      ...prev,
      scale: { ...prev.scale, [field]: value },
    }));
  };

  const handleApplyQuestionCount = (count: number) => {
    const n = Math.max(1, Math.min(60, count));
    updateState((prev) => {
      const nextQ = [...prev.q];
      while (nextQ.length < n) nextQ.push(blankQ());
      nextQ.length = n;
      return { ...prev, q: nextQ };
    });
    toast(`Sual sayı: ${n}`);
  };

  const handleQuestionChange = (index: number, patch: Partial<Question>) => {
    updateState((prev) => ({
      ...prev,
      q: prev.q.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    }));
  };

  const handleApplyQuickKey = (rawKey: string, variant: VariantId = 'A') => {
    const s = rawKey.toUpperCase().replace(/[^A-E]/g, '');
    let k = 0;
    const nextQ = state.q.map((q) => {
      if (q.type === 'test' && k < s.length) {
        return variant === 'B' ? { ...q, keyB: s[k++] } : { ...q, key: s[k++] };
      }
      return q;
    });
    updateState((prev) => ({
      ...prev,
      q: nextQ,
    }));
    toast(`${variant} variantı: ${k} test sualına açar yazıldı`);
  };

  const handleApplyStudents = (rawText: string) => {
    const names = parseStudentLines(rawText);
    updateState((prev) => {
      const na: Record<string, string[]> = {};
      const nv: Record<string, VariantId> = {};
      names.forEach((n) => {
        if (prev.ans[n]) na[n] = prev.ans[n];
        if (prev.studentVariants?.[n]) nv[n] = prev.studentVariants[n];
      });
      return { ...prev, students: names, ans: na, studentVariants: nv };
    });
    toast(`${names.length} şagird yadda saxlandı`);
  };

  const handleStudentVariantChange = (studentName: string, variant: VariantId) => {
    updateState((prev) => ({
      ...prev,
      studentVariants: {
        ...(prev.studentVariants || {}),
        [studentName]: variant,
      },
    }));
  };

  const handleAnswerChange = (studentName: string, qIndex: number, value: string) => {
    updateState((prev) => {
      const existing = prev.ans[studentName] ? [...prev.ans[studentName]] : [];
      existing[qIndex] = value;
      return {
        ...prev,
        ans: {
          ...prev.ans,
          [studentName]: existing,
        },
      };
    });
  };

  const handleApplyScanAnswers = (
    studentName: string,
    scanAnswers: string[],
    variant?: VariantId,
  ): number => {
    let written = 0;
    stateRef.current.q.forEach((q, i) => {
      if (i < scanAnswers.length && q.type === 'test') {
        written++;
      }
    });
    updateState((prev) => {
      const nextAns = prev.ans[studentName] ? [...prev.ans[studentName]] : [];
      scanAnswers.forEach((v, i) => {
        if (i < prev.q.length && prev.q[i].type === 'test') {
          nextAns[i] = v;
        }
      });
      const nextVariants =
        variant !== undefined
          ? { ...(prev.studentVariants || {}), [studentName]: variant }
          : prev.studentVariants;
      return {
        ...prev,
        ans: {
          ...prev.ans,
          [studentName]: nextAns,
        },
        studentVariants: nextVariants,
      };
    });
    return written;
  };

  const handleApplyTestPaperAnswers = (
    studentName: string,
    values: string[],
    variant: VariantId = 'A',
  ): number => {
    let written = 0;
    stateRef.current.q.forEach((_, i) => {
      if (i < values.length && values[i] !== '') {
        written++;
      }
    });
    updateState((prev) => {
      const nextAns = prev.ans[studentName] ? [...prev.ans[studentName]] : [];
      values.forEach((v, i) => {
        if (i < prev.q.length) {
          nextAns[i] = v;
        }
      });
      return {
        ...prev,
        ans: {
          ...prev.ans,
          [studentName]: nextAns,
        },
        studentVariants: {
          ...(prev.studentVariants || {}),
          [studentName]: variant,
        },
      };
    });
    return written;
  };

  const handleResetAll = () => {
    const fresh = createInitialState();
    setState(fresh);
    setScans([]);
    setTestScans([]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore storage errors
    }
    setView('setup');
    window.scrollTo(0, 0);
    toast('Təmizləndi');
  };

  return (
    <>
      <header className="ksq-header">
        <h1>KSQ hesablayıcısı</h1>
        <p>
          Cavab açarını və şagird cavablarını daxil edin. Bal, faiz, qiymət və sinif təhlili avtomatik hesablanır.
        </p>
      </header>

      <nav className="ksq-nav" aria-label="Bölmələr">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={view === tab.id ? 'on' : ''}
            aria-current={view === tab.id ? 'page' : undefined}
            onClick={() => handleShowView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="ksq-main">
        {view === 'setup' && (
          <SetupView
            meta={state.meta}
            scale={state.scale}
            questions={state.q}
            onMetaChange={handleMetaChange}
            onScaleChange={handleScaleChange}
            onApplyQuestionCount={handleApplyQuestionCount}
            onQuestionChange={handleQuestionChange}
            onApplyQuickKey={handleApplyQuickKey}
          />
        )}

        {view === 'students' && (
          <StudentsView students={state.students} onApplyStudents={handleApplyStudents} />
        )}

        {view === 'answers' && (
          <AnswersView
            state={state}
            scans={scans}
            onSetScans={setScans}
            testScans={testScans}
            onSetTestScans={setTestScans}
            onAnswerChange={handleAnswerChange}
            onStudentVariantChange={handleStudentVariantChange}
            onApplyScanAnswers={handleApplyScanAnswers}
            onApplyTestPaperAnswers={handleApplyTestPaperAnswers}
            onZoomImage={(src) => setZoomSrc(src)}
            onToast={toast}
          />
        )}

        {view === 'results' && <ResultsView state={state} onCopyText={copyText} />}

        {view === 'analysis' && (
          <AnalysisView state={state} onCopyText={copyText} onResetAll={handleResetAll} />
        )}
      </main>

      <div className={`toast${toastVisible ? ' on' : ''}`} id="toast" role="status" aria-live="polite">
        {toastMsg}
      </div>

      {zoomSrc && (
        <div
          id="zoom"
          role="dialog"
          aria-label="Blank önizləməsi"
          onClick={() => setZoomSrc(null)}
        >
          <img src={zoomSrc} alt="Skan edilmiş blank" />
        </div>
      )}
    </>
  );
}
