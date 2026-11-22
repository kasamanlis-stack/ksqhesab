import { useEffect, useState } from 'react';

interface StudentsViewProps {
  students: string[];
  onApplyStudents: (rawText: string) => void;
}

export function StudentsView({ students, onApplyStudents }: StudentsViewProps) {
  const [text, setText] = useState<string>(() => students.join('\n'));

  useEffect(() => {
    setText(students.join('\n'));
  }, [students]);

  return (
    <section className="view on" id="v-students">
      <div className="card">
        <h2>Şagird siyahısı</h2>
        <p className="hint">Hər sətirə bir şagird yazın və ya siyahını Word/Excel-dən yapışdırın.</p>
        <textarea
          id="st-list"
          className="ksq-textarea"
          aria-label="Şagird siyahısı"
          placeholder={'Əliyev Murad\nHəsənova Leyla\n...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn"
            id="b-st-apply"
            onClick={() => onApplyStudents(text)}
          >
            Siyahını yadda saxla
          </button>
          <span id="st-count" className="hint" style={{ margin: 0 }}>
            {students.length ? `${students.length} şagird` : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
