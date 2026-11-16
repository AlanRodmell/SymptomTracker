import {
  cycleDayFor,
  SymptomLogEntry,
  TrackerSettings,
} from '../data/symptomTree';

export interface AIPatternItem {
  title: string;
  observation: string;
  tag: string;
}

export interface AIInsightsResult {
  headline: string;
  summary: string;
  customAnswer: string;
  keyPatterns: AIPatternItem[];
  clinicianNotes: string[];
  generatedAtISO: string;
  isOfflineFallback?: boolean;
}

const INSIGHTS_CACHE_KEY = 'fieldnotes_ai_insights_v1';

export function loadCachedAIInsights(): AIInsightsResult | null {
  try {
    const raw = localStorage.getItem(INSIGHTS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AIInsightsResult;
  } catch {
    return null;
  }
}

export function saveCachedAIInsights(result: AIInsightsResult): void {
  try {
    localStorage.setItem(INSIGHTS_CACHE_KEY, JSON.stringify(result));
  } catch {
    // ignore
  }
}

export function buildLocalFallbackInsights(
  logs: SymptomLogEntry[],
  settings: TrackerSettings,
  question?: string
): AIInsightsResult {
  const symptomLogs = logs.filter((l) => !l.baseline && !l.periodStart);
  const baselineCount = logs.filter((l) => l.baseline).length;

  if (symptomLogs.length === 0) {
    return {
      headline:
        baselineCount > 0
          ? `${baselineCount} symptom-free day${baselineCount === 1 ? '' : 's'} logged so far.`
          : 'Log a few check-ins in Chat to unlock personalized pattern analysis.',
      summary:
        'As you record symptoms, severity scores, and triggers in Chat, Fieldnotes automatically identifies correlations across sleep, stress, timing, and cycle phases.',
      customAnswer: question
        ? 'There are no symptom entries logged yet to answer this question. Try logging a few entries in Chat first.'
        : '',
      keyPatterns: [],
      clinicianNotes: [],
      generatedAtISO: new Date().toISOString(),
      isOfflineFallback: true,
    };
  }

  const bySymptom: Record<string, { count: number; totalSev: number }> = {};
  const byTrigger: Record<string, number> = {};

  for (const l of symptomLogs) {
    const key = `${l.symptom} (${l.subregion})`;
    if (!bySymptom[key]) bySymptom[key] = { count: 0, totalSev: 0 };
    bySymptom[key].count += 1;
    bySymptom[key].totalSev += l.severity;

    for (const t of l.tags || []) {
      byTrigger[t] = (byTrigger[t] || 0) + 1;
    }
  }

  const topSym = Object.entries(bySymptom).sort(
    (a, b) => b[1].count - a[1].count
  )[0];
  const topTrig = Object.entries(byTrigger).sort((a, b) => b[1] - a[1])[0];
  const overallAvg = (
    symptomLogs.reduce((acc, l) => acc + l.severity, 0) / symptomLogs.length
  ).toFixed(1);

  const keyPatterns: AIPatternItem[] = [];
  if (topSym) {
    keyPatterns.push({
      title: `Primary Symptom: ${topSym[0]}`,
      observation: `Logged ${topSym[1].count} time${topSym[1].count === 1 ? '' : 's'} with an average intensity of ${(topSym[1].totalSev / topSym[1].count).toFixed(1)}/10.`,
      tag: 'Frequency',
    });
  }
  if (topTrig) {
    keyPatterns.push({
      title: `Top Reported Trigger: ${topTrig[0]}`,
      observation: `Co-occurred across ${topTrig[1]} logged entry${topTrig[1] === 1 ? '' : 'ies'}.`,
      tag: 'Trigger Link',
    });
  }

  return {
    headline: `${symptomLogs.length} symptom entries tracked (avg intensity ${overallAvg}/10).`,
    summary: `Your most frequently recorded issue is ${topSym ? topSym[0] : 'general discomfort'}, alongside ${baselineCount} symptom-free baseline day${baselineCount === 1 ? '' : 's'}.`,
    customAnswer: question
      ? `Offline summary based on ${symptomLogs.length} local logs: your most frequent entry is ${topSym ? topSym[0] : 'none'} with an average severity of ${overallAvg}/10.`
      : '',
    keyPatterns,
    clinicianNotes: [
      `Total of ${symptomLogs.length} symptom episodes recorded with mean severity ${overallAvg}/10.`,
      topSym
        ? `Most frequent complaint: ${topSym[0]} (${topSym[1].count} occurrences).`
        : 'No dominant recurring symptom cluster yet.',
    ],
    generatedAtISO: new Date().toISOString(),
    isOfflineFallback: true,
  };
}

export async function generateAIInsights(
  logs: SymptomLogEntry[],
  settings: TrackerSettings,
  isOnline: boolean,
  question?: string
): Promise<AIInsightsResult> {
  if (!isOnline || logs.length === 0) {
    return buildLocalFallbackInsights(logs, settings, question);
  }

  try {
    const enrichedLogs = logs.slice(0, 80).map((l) => ({
      ...l,
      cycleDay:
        settings.profile !== 'male'
          ? cycleDayFor(
              new Date(l.dateISO),
              settings.cycleAnchor,
              settings.cycleLength
            )
          : null,
    }));

    const response = await fetch('/api/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: enrichedLogs,
        profile: settings.profile,
        cycleAnchor: settings.cycleAnchor,
        cycleLength: settings.cycleLength,
        question,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const result: AIInsightsResult = {
      headline:
        data.headline || 'Pattern synthesis complete based on your recent logs.',
      summary: data.summary || '',
      customAnswer: data.customAnswer || '',
      keyPatterns: Array.isArray(data.keyPatterns) ? data.keyPatterns : [],
      clinicianNotes: Array.isArray(data.clinicianNotes)
        ? data.clinicianNotes
        : [],
      generatedAtISO: new Date().toISOString(),
      isOfflineFallback: false,
    };

    if (!question) {
      saveCachedAIInsights(result);
    }
    return result;
  } catch (err) {
    console.warn('Falling back to local insights generator:', err);
    return buildLocalFallbackInsights(logs, settings, question);
  }
}
