export type ViewId = 'setup' | 'students' | 'answers' | 'results' | 'analysis';

export type QuestionType = 'test' | 'open';

export type VariantId = 'A' | 'B';

export interface Question {
  type: QuestionType;
  key: string;
  keyB?: string;
  max: number;
  topic: string;
}

export interface KsqMeta {
  cls: string;
  subject: string;
  title: string;
  date: string;
}

export interface GradeScale {
  s3: number;
  s4: number;
  s5: number;
  hard: number;
}

export interface KsqState {
  meta: KsqMeta;
  scale: GradeScale;
  q: Question[];
  students: string[];
  ans: Record<string, string[]>;
  studentVariants?: Record<string, VariantId>;
}

export type CellState = '' | 'c' | 'x' | 'p';

export interface StudentScore {
  pts: number;
  correct: number;
  answered: number;
  pct: number;
  grade: 2 | 3 | 4 | 5;
}

export interface ClassStats {
  sc: Array<{ n: string } & StudentScore>;
  k: number;
  avg: number;
  med: number;
  min: number;
  max: number;
  dist: Record<2 | 3 | 4 | 5, number>;
  mastery: number;
  quality: number;
  avgGrade: number;
}

export interface QuestionStat {
  i: number;
  q: Question;
  rate: number;
  blank: number;
  opts: Record<string, number>;
  wrong: string;
  cnt: number;
}

export type SortMode = 'list' | 'desc' | 'asc';

export interface OmrAnswer {
  v: string;
  flag: string;
  f: number[];
}

export interface OmrReadSuccess {
  ok: true;
  id: number | null;
  idFlag: string;
  answers: OmrAnswer[];
  preview: string;
}

export interface OmrReadFailure {
  ok: false;
  error: string;
}

export type OmrReadResult = OmrReadSuccess | OmrReadFailure;

export type ScanItem =
  | (OmrReadSuccess & {
      name: string;
      key: string;
      done: boolean;
      si: number;
      variant?: VariantId;
      manual?: boolean;
    })
  | (OmrReadFailure & {
      name: string;
      key: string;
      done: boolean;
    });

export interface TestPaperAnswerItem {
  value: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export type TestPaperScanItem =
  | {
      ok: true;
      name: string;
      key: string;
      done: boolean;
      previews: string[];
      detectedName: string | null;
      detectedVariant: VariantId | null;
      variant: VariantId;
      si: number;
      manual?: boolean;
      answers: TestPaperAnswerItem[];
    }
  | {
      ok: false;
      name: string;
      key: string;
      done: boolean;
      error: string;
    };
