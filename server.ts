import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const CHAT_SYSTEM_INSTRUCTION = `You are the Fieldnotes Symptom & Cycle Journal Assistant.
Your goal is to make logging physical or cycle symptoms effortless, calm, and fast on mobile.

When the user describes how they feel in natural language:
1. Extract all distinct symptoms, baseline ("symptom-free") check-ins, or "period started" events into structured entries matching the Fieldnotes taxonomy:
   - category: "Physical", "Cycle", or "Baseline"
   - region:
     - For Physical: "Head & Neck", "Arms & Hands", "Chest & Torso", "Back & Spine", "Pelvis & Groin", or "Legs & Feet"
     - For Cycle: "Flow Level", "Mood & Emotional", or "Systemic & Other"
     - For Baseline: "Daily Check-in"
   - subregion: Specific body part or group (e.g., "Forehead & Temples", "Eyes", "Shoulders", "Lower Back", "Abdomen & Stomach", "Knees", "Flow Level", "Mood & Emotional", "Systemic & Other")
   - side: "Left", "Right", "Both sides", or "None"
   - symptom: Short clinical descriptor (e.g., "Throbbing", "Sharp pain", "Dull ache", "Nausea", "Cramping", "Fatigue / Exhaustion", "Brain Fog", "Symptom-free today", "Period started")
   - severity: Integer 0 to 10 (0 for baseline or periodStart; if user doesn't specify a number for a symptom, infer from words: mild=3, moderate=5, bad/high=7, severe/intense=9, or default to 5)
   - severityExplicit: true if the user explicitly stated a number (e.g. "6/10") or clear intensity word ("mild", "severe"), false if you had to guess default 5
   - baseline: true ONLY if the user states they have no symptoms / feel fine today
   - periodStart: true ONLY if the user states their period started today
   - tags: Any mentioned triggers from ["Sleep", "Stress", "Illness", "Food", "Exercise", "Weather", "Hormonal", "Medication", "Alcohol/Caffeine", "Injury", "Other"]
   - notes: Concise extra context mentioned by the user (e.g., "worse when standing", "after skipping lunch")

2. Keep your conversational "reply" brief (1-2 short sentences), warm, and non-alarmist. Do not give medical diagnoses.
3. Provide 2-4 short "followUpChips" (under 5 words each) the user can tap next (e.g., "Severity is 7/10", "Triggered by Stress", "Also feeling fatigued", "That's all for now").`;

const INSIGHTS_SYSTEM_INSTRUCTION = `You are the Fieldnotes Clinical Pattern & Rhythm Analyst.
You analyze a user's logged symptom history, severity scores, trigger tags, timestamps, and (if enabled) menstrual cycle days to surface calm, objective, evidence-based observations.

Rules:
- Never diagnose medical conditions or prescribe treatments.
- Ground every observation in actual numbers, dates, severity averages, cycle days, or triggers present in the user's logs.
- Keep language clear, minimalist, and supportive.
- If the user asks a specific question (e.g. "What triggers my headaches?" or "Summarize for my doctor"), provide a direct, well-structured answer in "customAnswer" grounded in their logs.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/chat-log', async (req, res) => {
    try {
      const { messages, profile } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; text: string }>;
        profile?: 'female' | 'male';
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array is required.' });
        return;
      }

      const ai = getAIClient();
      const conversationTranscript = messages
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'User' : 'Fieldnotes'}: ${m.text}`)
        .join('\n');

      const prompt = `User Profile: ${profile === 'male' ? 'Physical Only (no menstrual cycle tracking)' : 'Physical & Cycle tracking enabled'}
Current Local Time: ${new Date().toISOString()}

Recent Conversation:
${conversationTranscript}

Analyze the latest user message in context and return the structured JSON response.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction: CHAT_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description:
                  'Concise, supportive 1-2 sentence response confirming the logged symptom or asking a clarifying question.',
              },
              proposedEntries: {
                type: Type.ARRAY,
                description:
                  'Zero or more structured symptom log entries extracted from the latest user message.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    region: { type: Type.STRING },
                    subregion: { type: Type.STRING },
                    side: { type: Type.STRING },
                    symptom: { type: Type.STRING },
                    severity: { type: Type.INTEGER },
                    severityExplicit: { type: Type.BOOLEAN },
                    baseline: { type: Type.BOOLEAN },
                    periodStart: { type: Type.BOOLEAN },
                    tags: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    notes: { type: Type.STRING },
                  },
                  required: [
                    'category',
                    'region',
                    'subregion',
                    'side',
                    'symptom',
                    'severity',
                    'severityExplicit',
                    'baseline',
                    'periodStart',
                    'tags',
                    'notes',
                  ],
                },
              },
              followUpChips: {
                type: Type.ARRAY,
                description:
                  '2 to 4 short tap-reply suggestions (max 4 words each).',
                items: { type: Type.STRING },
              },
            },
            required: ['reply', 'proposedEntries', 'followUpChips'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error) {
      console.error('Gemini /api/chat-log error:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to process message';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/insights', async (req, res) => {
    try {
      const { logs, profile, cycleAnchor, cycleLength, question } = req.body as {
        logs: Array<{
          dateISO: string;
          category: string;
          region: string;
          subregion: string;
          side: string;
          symptom: string;
          severity: number;
          baseline: boolean;
          periodStart: boolean;
          tags: string[];
          notes: string;
          cycleDay?: number | null;
        }>;
        profile?: 'female' | 'male';
        cycleAnchor?: string;
        cycleLength?: number;
        question?: string;
      };

      if (!Array.isArray(logs)) {
        res.status(400).json({ error: 'Logs array is required.' });
        return;
      }

      const ai = getAIClient();
      const compactLogs = logs.slice(0, 80).map((l) => ({
        date: l.dateISO,
        type: l.baseline
          ? 'Symptom-free baseline'
          : l.periodStart
            ? 'Period started'
            : `${l.category} > ${l.region} > ${l.subregion}${l.side !== 'None' ? ` (${l.side})` : ''} > ${l.symptom}`,
        severity: l.baseline || l.periodStart ? null : l.severity,
        triggers: l.tags,
        cycleDay: l.cycleDay ?? null,
        notes: l.notes || '',
      }));

      const prompt = `User Profile: ${profile === 'male' ? 'Physical Only' : `Cycle Tracking Enabled (Anchor: ${cycleAnchor || 'Not set'}, Length: ${cycleLength || 28} days)`}
Total Logged Entries Provided: ${compactLogs.length}
${question ? `Specific User Question: "${question}"` : 'Task: Analyze the logged entries and surface key correlations, temporal or cycle patterns, and clinician summary points.'}

Logged History (most recent first):
${JSON.stringify(compactLogs, null, 2)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction: INSIGHTS_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: {
                type: Type.STRING,
                description:
                  'Concise 1-sentence headline summarizing the most important pattern in the user’s logs.',
              },
              summary: {
                type: Type.STRING,
                description:
                  '2-3 sentence narrative synthesis of symptom frequency, severity trends, and trigger or cycle correlations.',
              },
              customAnswer: {
                type: Type.STRING,
                description:
                  'If the user asked a specific question, provide a direct, helpful answer grounded in their logs; otherwise empty string.',
              },
              keyPatterns: {
                type: Type.ARRAY,
                description:
                  '2 to 4 concrete patterns observed in the data (e.g. Trigger correlation, Time-of-day clustering, Cycle phase link, Severity trend).',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    observation: { type: Type.STRING },
                    tag: {
                      type: Type.STRING,
                      description:
                        'Short label like "Trigger Link", "Cycle Rhythm", "Timing", or "Intensity"',
                    },
                  },
                  required: ['title', 'observation', 'tag'],
                },
              },
              clinicianNotes: {
                type: Type.ARRAY,
                description:
                  '2 to 3 concise, factual bullet points or questions the user can share with a healthcare provider.',
                items: { type: Type.STRING },
              },
            },
            required: [
              'headline',
              'summary',
              'customAnswer',
              'keyPatterns',
              'clinicianNotes',
            ],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error) {
      console.error('Gemini /api/insights error:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to generate insights';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Fieldnotes server listening on http://localhost:${PORT}`);
  });
}

startServer();
