import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

interface ScanQuestionInput {
  number: number;
  type: 'test' | 'open';
  max: number;
}

interface GeminiScanResponse {
  studentName?: string | null;
  answers?: Array<{
    qNum: number;
    value: string;
    confidence: 'high' | 'medium' | 'low';
    note?: string;
  }>;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.post('/api/scan-test', async (req, res) => {
    try {
      const body = req.body as {
        imageBase64?: unknown;
        mimeType?: unknown;
        questions?: unknown;
        students?: unknown;
      };

      if (typeof body.imageBase64 !== 'string' || body.imageBase64.length < 32) {
        res.status(400).json({ error: 'Şəkil məlumatı düzgün göndərilmədi.' });
        return;
      }
      if (body.imageBase64.length > 14 * 1024 * 1024) {
        res.status(413).json({ error: 'Şəkil həcmi çox böyükdür.' });
        return;
      }

      const mimeType = typeof body.mimeType === 'string' && ALLOWED_MIME_TYPES.has(body.mimeType)
        ? body.mimeType
        : 'image/jpeg';

      if (!Array.isArray(body.questions) || body.questions.length === 0 || body.questions.length > 60) {
        res.status(400).json({ error: 'Sualların siyahısı düzgün deyil (1–60 arası olmalıdır).' });
        return;
      }

      const questions: ScanQuestionInput[] = body.questions.map((q, idx) => {
        const item = q as Record<string, unknown>;
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

      const prompt = `Sən məktəb test vərəqlərini oxuyan dəqiq optik yoxlayıcısan.
Bu şəkildə şagirdin cavab kartı (OMR blank) olmadan birbaşa test vərəqinin üzərində işarələdiyi və ya yazdığı cavablar var.
Şəklə diqqətlə bax və şagirdin HƏR SUAL üzrə verdiyi cavabı çıxar.

Suallar:
${qDesc}${studentHint}

Qaydalar:
1. Test sualları üçün şagirdin dairəyə aldığı, altından xətt çəkdiyi, quş/plus/işarə qoyduğu və ya yazdığı variant hərfini ("A", "B", "C", "D" və ya "E") qaytar.
2. Özün sualı həll etməyə çalışma — YALNIZ şagirdin işarələdiyi cavabı oxu! Əgər şagird suala heç bir işarə qoymayıbsa və ya bu sual şəkildə görünmürsə, "value" sahəsini "" (boş sətir) qaytar.
3. Əgər şagird bir variantın üstündən xətt çəkib başqasını seçibsə, son seçilən cavabı götür və "confidence": "medium" verib "note" sahəsində Azərbaycan dilində qısa qeyd yaz (məs. "düzəliş edilib").
4. Əgər eyni sualda iki variant işarələnibsə və hansının seçildiyi aydın deyilsə, "value": "", "confidence": "low", "note": "bir neçə variant işarələnib" yaz.
5. Açıq suallar üçün: əgər müəllim vərəqdə bal yazıbsa həmin rəqəmi "value" kimi qaytar, yoxsa "value": "" saxla və şagirdin yazdığı cavabı qısaca "note" sahəsində qeyd et.
6. Əgər vərəqin yuxarısında şagirdin adı/soyadı yazılıbsa, "studentName" sahəsində qaytar; yoxdursa null qaytar.
7. Bütün 1..${questions.length} suallar üçün nəticə qaytar.`;

      let response;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: body.imageBase64,
                  },
                },
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

      res.json({
        ok: true,
        studentName: typeof parsed.studentName === 'string' ? parsed.studentName.trim() || null : null,
        answers: normalizedAnswers,
      });
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      const msg = apiErr?.message || String(err);
      if (msg === 'GEMINI_API_KEY_MISSING') {
        res.status(503).json({
          error: 'GEMINI_API_KEY konfiqurasiya olunmayıb. Zəhmət olmasa Settings > Secrets bölməsindən API açarını əlavə edin.',
        });
        return;
      }
      if (apiErr?.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
        res.status(403).json({
          error: 'Gemini API açarı etibarsızdır və ya icazə çatmır. Zəhmət olmasa Settings > Secrets bölməsini yoxlayın.',
        });
        return;
      }
      if (apiErr?.status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'API sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.',
        });
        return;
      }
      console.error('Scan test error:', err);
      res.status(500).json({
        error: `Test vərəqi oxunarkən xəta baş verdi (${apiErr?.status ?? '500'}). Şəklin aydın olduğuna əmin olub yenidən cəhd edin.`,
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`KSQ server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
