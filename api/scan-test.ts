import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface ScanQuestionInput {
  number: number;
  type: 'test' | 'open';
  max: number;
}

interface GeminiScanResponse {
  studentName?: string | null;
  variant?: string | null;
  answers?: Array<{
    qNum: number;
    value: string;
    confidence: 'high' | 'medium' | 'low';
    note?: string;
  }>;
}

export interface ScanTestHttpResult {
  status: number;
  body: Record<string, unknown>;
}

interface ApiRequest extends IncomingMessage {
  method?: string;
  body?: unknown;
}

interface ApiResponse extends ServerResponse {
  status?: (code: number) => ApiResponse;
  json?: (data: unknown) => void;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeVariant(raw: unknown): 'A' | 'B' | null {
  if (typeof raw !== 'string') return null;
  const up = raw.toUpperCase();
  const match = up.match(/\b([AB])\b/);
  if (match) return match[1] as 'A' | 'B';
  const trimmed = up.replace(/[^AB]/g, '');
  if (trimmed === 'A' || trimmed === 'B') return trimmed;
  return null;
}

export async function processScanTestRequest(rawBody: unknown): Promise<ScanTestHttpResult> {
  try {
    const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
      imageBase64?: unknown;
      mimeType?: unknown;
      images?: unknown;
      questions?: unknown;
      students?: unknown;
    };

    const rawImages: Array<{ imageBase64: string; mimeType: string }> = [];
    if (Array.isArray(body.images) && body.images.length > 0) {
      if (body.images.length > 4) {
        return { status: 400, body: { error: 'Bir sorğuda ən çox 4 səhifə göndərilə bilər.' } };
      }
      for (const entry of body.images) {
        const item = (entry && typeof entry === 'object' ? entry : {}) as {
          imageBase64?: unknown;
          mimeType?: unknown;
        };
        if (typeof item.imageBase64 !== 'string' || item.imageBase64.length < 32) {
          return { status: 400, body: { error: 'Səhifələrdən birinin şəkil məlumatı düzgün deyil.' } };
        }
        const mt =
          typeof item.mimeType === 'string' && ALLOWED_MIME_TYPES.has(item.mimeType)
            ? item.mimeType
            : 'image/jpeg';
        rawImages.push({ imageBase64: item.imageBase64, mimeType: mt });
      }
    } else if (typeof body.imageBase64 === 'string' && body.imageBase64.length >= 32) {
      const mt =
        typeof body.mimeType === 'string' && ALLOWED_MIME_TYPES.has(body.mimeType)
          ? body.mimeType
          : 'image/jpeg';
      rawImages.push({ imageBase64: body.imageBase64, mimeType: mt });
    } else {
      return { status: 400, body: { error: 'Şəkil məlumatı düzgün göndərilmədi.' } };
    }

    const totalSize = rawImages.reduce((s, img) => s + img.imageBase64.length, 0);
    if (totalSize > 14 * 1024 * 1024) {
      return { status: 413, body: { error: 'Şəkillərin ümumi həcmi çox böyükdür.' } };
    }

    if (!Array.isArray(body.questions) || body.questions.length === 0 || body.questions.length > 60) {
      return { status: 400, body: { error: 'Sualların siyahısı düzgün deyil (1–60 arası olmalıdır).' } };
    }

    const questions: ScanQuestionInput[] = body.questions.map((q, idx) => {
      const item = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
      return {
        number: typeof item.number === 'number' ? item.number : idx + 1,
        type: item.type === 'open' ? 'open' : 'test',
        max: typeof item.max === 'number' ? item.max : 1,
      };
    });

    const students = Array.isArray(body.students)
      ? body.students.filter((s): s is string => typeof s === 'string').slice(0, 100)
      : [];

    const ai = getAiClient();

    const qDesc = questions
      .map((q) =>
        q.type === 'test'
          ? `${q.number}. Test sualı (variantlar: A, B, C, D, E)`
          : `${q.number}. Açıq sual (maks. bal: ${q.max})`,
      )
      .join('\n');

    const studentHint = students.length
      ? `\nSinifdəki şagird siyahısı (əgər vərəqdə ad yazılıbsa uyğunlaşdır): ${students.join(', ')}.`
      : '';

    const pageNote =
      rawImages.length > 1
        ? `Sənə eyni şagirdin ${rawImages.length} səhifəlik test vərəqinin şəkilləri ardıcıl göndərilib (məsələn, 1-ci və 2-ci səhifə). Bütün səhifələri diqqətlə oxu və cavabları vahid 1..${questions.length} siyahısında birləşdir.`
        : 'Bu şəkildə şagirdin cavab kartı (OMR blank) olmadan birbaşa test vərəqinin üzərində işarələdiyi və ya yazdığı cavablar var.';

    const prompt = `Sən məktəb test vərəqlərini oxuyan dəqiq optik yoxlayıcısan.
${pageNote}
Testlər adətən iki variantlı olur: A variantı və B variantı.

Suallar:
${qDesc}${studentHint}

Qaydalar:
1. Test sualları üçün şagirdin dairəyə aldığı, altından xətt çəkdiyi, quş/plus/işarə qoyduğu və ya yazdığı variant hərfini ("A", "B", "C", "D" və ya "E") qaytar.
2. Özün sualı həll etməyə çalışma — YALNIZ şagirdin işarələdiyi cavabı oxu! Əgər şagird suala heç bir işarə qoymayıbsa və ya sual göndərilən səhifələrin heç birində görünmürsə, "value" sahəsini "" (boş sətir) qaytar.
3. Əgər sual səhifələrdən birində görünmürsə, digər səhifələrə bax — yalnız bütün səhifələrdə yoxdursa boş qaytar.
4. Əgər şagird bir variantın üstündən xətt çəkib başqasını seçibsə, son seçilən cavabı götür və "confidence": "medium" verib "note" sahəsində Azərbaycan dilində qısa qeyd yaz (məs. "düzəliş edilib").
5. Əgər eyni sualda iki variant işarələnibsə və hansının seçildiyi aydın deyilsə, "value": "", "confidence": "low", "note": "bir neçə variant işarələnib" yaz.
6. Açıq suallar üçün: əgər müəllim vərəqdə bal yazıbsa həmin rəqəmi "value" kimi qaytar, yoxsa "value": "" saxla və şagirdin yazdığı cavabı qısaca "note" sahəsində qeyd et.
7. Əgər vərəqdə şagirdin adı/soyadı yazılıbsa, "studentName" sahəsində qaytar; yoxdursa "" qaytar.
8. Əgər vərəqdə testin variantı ("A variantı", "Variant A", "A" və ya "B variantı", "Variant B", "B") yazılıbsa və ya işarələnibsə, "variant" sahəsində "A" və ya "B" qaytar; yoxdursa "" qaytar.
9. Bütün 1..${questions.length} suallar üçün nəticə qaytar.`;

    let response;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              ...rawImages.map((img) => ({
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.imageBase64,
                },
              })),
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                studentName: {
                  type: Type.STRING,
                  description: 'Vərəqdə yazılmış şagirdin adı və soyadı, yoxdursa boş sətir.',
                },
                variant: {
                  type: Type.STRING,
                  description: 'Vərəqdə göstərilən test variantı (yalnız A və ya B), yoxdursa boş sətir.',
                },
                answers: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      qNum: { type: Type.INTEGER },
                      value: { type: Type.STRING },
                      confidence: { type: Type.STRING },
                      note: { type: Type.STRING },
                    },
                    required: ['qNum', 'value', 'confidence'],
                  },
                },
              },
              required: ['answers'],
            },
          },
        });
        break;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if ((status === 503 || status === 429) && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        throw err;
      }
    }
    if (!response) {
      throw new Error('Empty response from Gemini API');
    }

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText) as GeminiScanResponse;

    const byNum = new Map<number, { value: string; confidence: 'high' | 'medium' | 'low'; note: string }>();
    for (const item of parsed.answers || []) {
      const qNum = Number(item.qNum);
      if (!Number.isInteger(qNum) || qNum < 1 || qNum > questions.length) continue;
      const qDef = questions[qNum - 1];
      let val = String(item.value ?? '').trim();
      if (qDef.type === 'test') {
        val = val.toUpperCase().replace(/[^A-E]/g, '').slice(0, 1);
      } else {
        val = val.replace(',', '.').replace(/[^0-9.]/g, '');
        if (val !== '' && Number(val) > qDef.max) val = String(qDef.max);
      }
      const conf =
        item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low'
          ? item.confidence
          : 'medium';
      byNum.set(qNum, {
        value: val,
        confidence: conf,
        note: typeof item.note === 'string' ? item.note.trim() : '',
      });
    }

    const normalizedAnswers = questions.map((q) => {
      const found = byNum.get(q.number);
      return (
        found ?? {
          value: '',
          confidence: 'low' as const,
          note: '',
        }
      );
    });

    return {
      status: 200,
      body: {
        ok: true,
        studentName: typeof parsed.studentName === 'string' ? parsed.studentName.trim() || null : null,
        variant: normalizeVariant(parsed.variant),
        answers: normalizedAnswers,
      },
    };
  } catch (err) {
    const apiErr = err as { status?: number; message?: string };
    const msg = apiErr?.message || String(err);
    if (msg === 'GEMINI_API_KEY_MISSING') {
      return {
        status: 503,
        body: {
          error:
            'GEMINI_API_KEY konfiqurasiya olunmayıb. Zəhmət olmasa server mühitində (Settings > Secrets və ya Vercel Environment Variables) GEMINI_API_KEY əlavə edin.',
        },
      };
    }
    if (apiErr?.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
      return {
        status: 403,
        body: {
          error: 'Gemini API açarı etibarsızdır və ya icazə çatmır. Zəhmət olmasa GEMINI_API_KEY dəyərini yoxlayın.',
        },
      };
    }
    if (apiErr?.status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
      return {
        status: 429,
        body: {
          error: 'API sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.',
        },
      };
    }
    if (apiErr?.status === 503 || msg.includes('UNAVAILABLE')) {
      return {
        status: 503,
        body: {
          error: 'AI xidməti hazırda yüklüdür (503). Bir neçə saniyə sonra yenidən cəhd edin.',
        },
      };
    }
    console.error('Scan test error:', err);
    return {
      status: 500,
      body: {
        error: `Test vərəqi oxunarkən xəta baş verdi (${apiErr?.status ?? '500'}). Şəklin aydın olduğuna əmin olub yenidən cəhd edin.`,
      },
    };
  }
}

function sendJson(res: ApiResponse, statusCode: number, payload: unknown): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const withStatus = res.status(statusCode);
    if (typeof withStatus.json === 'function') {
      withStatus.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: ApiRequest): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }
    return req.body;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Yalnız POST sorğusu dəstəklənir.' });
    return;
  }
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Sorğu JSON formatında deyil.' });
    return;
  }
  const result = await processScanTestRequest(parsedBody);
  sendJson(res, result.status, result.body);
}
