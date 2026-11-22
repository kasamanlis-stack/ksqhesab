import { useEffect, useState } from 'react';
import type { GradeScale, KsqMeta, Question, QuestionType } from '../types/ksq';

interface SetupViewProps {
  meta: KsqMeta;
  scale: GradeScale;
  questions: Question[];
  onMetaChange: (field: keyof KsqMeta, value: string) => void;
  onScaleChange: (field: keyof GradeScale, value: number) => void;
  onApplyQuestionCount: (count: number) => void;
  onQuestionChange: (index: number, patch: Partial<Question>) => void;
  onApplyQuickKey: (rawKey: string) => void;
}

export function SetupView({
  meta,
  scale,
  questions,
  onMetaChange,
  onScaleChange,
  onApplyQuestionCount,
  onQuestionChange,
  onApplyQuickKey,
}: SetupViewProps) {
  const [nDraft, setNDraft] = useState<string>(String(questions.length));
  const [quickKey, setQuickKey] = useState<string>('');

  useEffect(() => {
    setNDraft(String(questions.length));
  }, [questions.length]);

  const handleApplyN = () => {
    const n = Math.max(1, Math.min(60, parseInt(nDraft, 10) || 1));
    setNDraft(String(n));
    onApplyQuestionCount(n);
  };

  return (
    <section className="view on" id="v-setup">
      <div className="card">
        <h2>KSQ haqqında</h2>
        <div className="row">
          <label className="f">
            Sinif
            <input
              id="m-class"
              className="ksq-input"
              placeholder="7A"
              style={{ width: 90 }}
              value={meta.cls}
              onChange={(e) => onMetaChange('cls', e.target.value)}
            />
          </label>
          <label className="f">
            Fənn
            <input
              id="m-subject"
              className="ksq-input"
              placeholder="Ədəbiyyat"
              style={{ width: 170 }}
              value={meta.subject}
              onChange={(e) => onMetaChange('subject', e.target.value)}
            />
          </label>
          <label className="f">
            KSQ
            <input
              id="m-title"
              className="ksq-input"
              placeholder="KSQ-2"
              style={{ width: 120 }}
              value={meta.title}
              onChange={(e) => onMetaChange('title', e.target.value)}
            />
          </label>
          <label className="f">
            Tarix
            <input
              id="m-date"
              className="ksq-input"
              type="date"
              value={meta.date}
              onChange={(e) => onMetaChange('date', e.target.value)}
            />
          </label>
          <label className="f">
            Sual sayı
            <input
              id="m-n"
              className="ksq-input"
              type="number"
              min={1}
              max={60}
              style={{ width: 80 }}
              value={nDraft}
              onChange={(e) => setNDraft(e.target.value)}
            />
          </label>
          <button type="button" className="btn ghost" id="b-apply-n" onClick={handleApplyN}>
            Tətbiq et
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Cavab açarı</h2>
        <p className="hint">
          Test sualları üçün düzgün variantı yazın (A, B, C…). Açıq sual üçün növü “Açıq” seçin və maksimal balı yazın; şagirdin aldığı balı sonra daxil edəcəksiniz. “Mövzu / standart” sütunu təhlildə çətinlik yaradan mövzuları göstərmək üçündür.
        </p>
        <div className="tw">
          <table id="t-key" className="ksq-table">
            <thead>
              <tr>
                <th>Sual</th>
                <th>Növ</th>
                <th>Düzgün cavab</th>
                <th>Maks. bal</th>
                <th style={{ textAlign: 'left' }}>Mövzu / standart</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q, i) => (
                <tr key={i}>
                  <td>
                    <b>{i + 1}</b>
                  </td>
                  <td>
                    <select
                      aria-label={`Sual ${i + 1} növü`}
                      value={q.type}
                      onChange={(e) => {
                        const nextType = e.target.value as QuestionType;
                        const patch: Partial<Question> = { type: nextType };
                        if (nextType === 'test' && !q.max) {
                          patch.max = 1;
                        }
                        onQuestionChange(i, patch);
                      }}
                    >
                      <option value="test">Test</option>
                      <option value="open">Açıq</option>
                    </select>
                  </td>
                  <td>
                    {q.type === 'test' ? (
                      <input
                        aria-label={`Sual ${i + 1} düzgün cavab`}
                        maxLength={1}
                        value={q.key}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase().replace(/[^A-E]/g, '');
                          onQuestionChange(i, { key: v });
                        }}
                      />
                    ) : (
                      <span className="hint">bal ilə</span>
                    )}
                  </td>
                  <td>
                    <input
                      aria-label={`Sual ${i + 1} maksimal bal`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={q.max}
                      style={{ width: 60, textTransform: 'none' }}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        onQuestionChange(i, { max: v });
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <input
                      aria-label={`Sual ${i + 1} mövzu`}
                      className="tp"
                      value={q.topic}
                      placeholder="məs. 1.3.5"
                      onChange={(e) => onQuestionChange(i, { topic: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="f" style={{ flex: 1, minWidth: 260 }}>
            Test açarını bir sətirlə daxil edin (məs. ABDCA BBEAC)
            <input
              id="key-quick"
              className="ksq-input"
              placeholder="ABDCABBEAC"
              value={quickKey}
              onChange={(e) => setQuickKey(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn ghost"
            id="b-key-quick"
            onClick={() => onApplyQuickKey(quickKey)}
          >
            Açara yaz
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Qiymət şkalası (faizlə)</h2>
        <p className="hint">Qiymət şkalanız fərqlidirsə, aşağı sərhədləri dəyişin.</p>
        <div className="row">
          <label className="f">
            “3” üçün, % ≥
            <input
              id="s3"
              className="ksq-input"
              type="number"
              style={{ width: 80 }}
              value={scale.s3}
              onChange={(e) => onScaleChange('s3', Number(e.target.value) || 0)}
            />
          </label>
          <label className="f">
            “4” üçün, % ≥
            <input
              id="s4"
              className="ksq-input"
              type="number"
              style={{ width: 80 }}
              value={scale.s4}
              onChange={(e) => onScaleChange('s4', Number(e.target.value) || 0)}
            />
          </label>
          <label className="f">
            “5” üçün, % ≥
            <input
              id="s5"
              className="ksq-input"
              type="number"
              style={{ width: 80 }}
              value={scale.s5}
              onChange={(e) => onScaleChange('s5', Number(e.target.value) || 0)}
            />
          </label>
          <label className="f">
            Çətin sual həddi, % &lt;
            <input
              id="hard"
              className="ksq-input"
              type="number"
              style={{ width: 80 }}
              value={scale.hard}
              onChange={(e) => onScaleChange('hard', Number(e.target.value) || 0)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
