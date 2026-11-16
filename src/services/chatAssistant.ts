import {
  FlattenedSymptomItem,
  SymptomLogEntry,
  TRIGGER_TAGS,
} from '../data/symptomTree';

export interface ProposedChatEntry {
  category: string;
  region: string;
  subregion: string;
  side: string;
  symptom: string;
  severity: number;
  severityExplicit: boolean;
  baseline: boolean;
  periodStart: boolean;
  tags: string[];
  notes: string;
}

export interface ChatAssistantResponse {
  reply: string;
  proposedEntries: ProposedChatEntry[];
  followUpChips: string[];
  usedOfflineFallback?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestampISO: string;
  loggedEntries?: SymptomLogEntry[];
  followUpChips?: string[];
  isOfflineReply?: boolean;
}

/**
 * Fast, deterministic local NLU parser used when the device is offline
 * or if the server endpoint is temporarily unreachable.
 */
export function parseSymptomLocally(
  userText: string,
  flattenedSymptoms: FlattenedSymptomItem[],
  profile: 'female' | 'male'
): ChatAssistantResponse {
  const lower = userText.toLowerCase().trim();

  // 1. Check for baseline / symptom-free
  if (
    /\b(symptom[- ]?free|no symptoms|feeling great|feeling fine|feel good|all good|nothing today)\b/i.test(
      lower
    )
  ) {
    return {
      reply: 'Logged today as a symptom-free baseline day.',
      proposedEntries: [
        {
          category: 'Baseline',
          region: 'Daily Check-in',
          subregion: 'Baseline',
          side: 'None',
          symptom: 'Symptom-free today',
          severity: 0,
          severityExplicit: true,
          baseline: true,
          periodStart: false,
          tags: [],
          notes: '',
        },
      ],
      followUpChips: ['View today’s log', 'Log another note'],
      usedOfflineFallback: true,
    };
  }

  // 2. Check for period start
  if (
    profile !== 'male' &&
    /\b(period started|started my period|got my period|cycle day 1)\b/i.test(
      lower
    )
  ) {
    return {
      reply:
        'Recorded your period start for today and anchored Cycle Day 1.',
      proposedEntries: [
        {
          category: 'Cycle',
          region: 'Flow Level',
          subregion: 'Period Start',
          side: 'None',
          symptom: 'Period started',
          severity: 0,
          severityExplicit: true,
          baseline: false,
          periodStart: true,
          tags: ['Hormonal'],
          notes: '',
        },
      ],
      followUpChips: ['Add menstrual cramping', 'Log flow level', 'Done'],
      usedOfflineFallback: true,
    };
  }

  // 3. Extract severity number (e.g. "7/10", "level 6", "severity 8") or intensity adjectives
  let severity = 5;
  let severityExplicit = false;
  const slashMatch = lower.match(/\b(10|[1-9])\s*(?:\/\s*10|out of 10)\b/);
  const levelMatch = lower.match(/\b(?:severity|level|at a|around a)\s*(10|[1-9])\b/);
  if (slashMatch) {
    severity = parseInt(slashMatch[1], 10);
    severityExplicit = true;
  } else if (levelMatch) {
    severity = parseInt(levelMatch[1], 10);
    severityExplicit = true;
  } else if (/\b(severe|intense|unbearable|worst|awful)\b/.test(lower)) {
    severity = 8;
    severityExplicit = true;
  } else if (/\b(moderate|medium)\b/.test(lower)) {
    severity = 5;
    severityExplicit = true;
  } else if (/\b(mild|slight|faint|minor|light)\b/.test(lower)) {
    severity = 3;
    severityExplicit = true;
  }

  // 4. Extract laterality
  let detectedSide: 'Left' | 'Right' | 'Both sides' | 'None' = 'None';
  if (/\b(both|bilateral)\b/.test(lower)) detectedSide = 'Both sides';
  else if (/\bleft\b/.test(lower)) detectedSide = 'Left';
  else if (/\bright\b/.test(lower)) detectedSide = 'Right';

  // 5. Extract trigger tags
  const detectedTags: string[] = [];
  const triggerSynonyms: Record<string, string> = {
    sleep: 'Sleep',
    insomnia: 'Sleep',
    tired: 'Sleep',
    stress: 'Stress',
    anxious: 'Stress',
    work: 'Stress',
    sick: 'Illness',
    cold: 'Illness',
    flu: 'Illness',
    food: 'Food',
    meal: 'Food',
    ate: 'Food',
    dairy: 'Food',
    exercise: 'Exercise',
    workout: 'Exercise',
    gym: 'Exercise',
    run: 'Exercise',
    weather: 'Weather',
    rain: 'Weather',
    pressure: 'Weather',
    hormone: 'Hormonal',
    period: 'Hormonal',
    meds: 'Medication',
    medication: 'Medication',
    pill: 'Medication',
    coffee: 'Alcohol/Caffeine',
    caffeine: 'Alcohol/Caffeine',
    wine: 'Alcohol/Caffeine',
    alcohol: 'Alcohol/Caffeine',
    injury: 'Injury',
    strained: 'Injury',
  };
  for (const [word, tag] of Object.entries(triggerSynonyms)) {
    if (lower.includes(word) && !detectedTags.includes(tag)) {
      detectedTags.push(tag);
    }
  }
  for (const tag of TRIGGER_TAGS) {
    if (lower.includes(tag.toLowerCase()) && !detectedTags.includes(tag)) {
      detectedTags.push(tag);
    }
  }

  // 6. Score flattened symptoms against user text
  const words = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  let bestItem: FlattenedSymptomItem | null = null;
  let bestScore = 0;

  // Common natural language aliases
  const enrichedQuery =
    lower +
    (lower.includes('headache') || lower.includes('migraine')
      ? ' head forehead temples throbbing ache'
      : '') +
    (lower.includes('stomach') || lower.includes('belly')
      ? ' abdomen cramping nausea bloating'
      : '') +
    (lower.includes('tired') || lower.includes('exhausted')
      ? ' fatigue exhaustion'
      : '');

  const enrichedWords = enrichedQuery
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  for (const item of flattenedSymptoms) {
    let score = 0;
    for (const w of enrichedWords) {
      if (item.symptom.toLowerCase().includes(w)) score += 4;
      if (item.subregion.toLowerCase().includes(w)) score += 3;
      if (item.region.toLowerCase().includes(w)) score += 2;
    }
    if (
      detectedSide !== 'None' &&
      item.side.toLowerCase() === detectedSide.toLowerCase()
    ) {
      score += 3;
    } else if (detectedSide === 'None' && item.side === 'Both sides') {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestItem && bestScore >= 3) {
    const finalSide =
      detectedSide !== 'None'
        ? detectedSide
        : bestItem.side !== 'None'
          ? bestItem.side
          : 'None';
    return {
      reply: `Logged ${bestItem.symptom} (${bestItem.subregion}${finalSide !== 'None' ? ` · ${finalSide}` : ''}) at ${severity}/10.${
        !severityExplicit
          ? ' You can slide the severity bar on the card below to fine-tune it.'
          : ''
      }`,
      proposedEntries: [
        {
          category: bestItem.category,
          region: bestItem.region,
          subregion: bestItem.subregion,
          side: finalSide,
          symptom: bestItem.symptom,
          severity,
          severityExplicit,
          baseline: false,
          periodStart: false,
          tags: detectedTags,
          notes: userText.slice(0, 240),
        },
      ],
      followUpChips: ['Set severity 7/10', 'Add Stress trigger', 'Log another'],
      usedOfflineFallback: true,
    };
  }

  // Fallback if no specific leaf matched: still log a clean general entry if words exist
  if (words.length >= 1) {
    return {
      reply:
        'Could you share where on your body you feel this and roughly how intense it is (1–10)? Or tap one of the quick options below.',
      proposedEntries: [],
      followUpChips: [
        'Throbbing headache 6/10',
        'Lower back ache 5/10',
        'Stomach cramping 4/10',
        'Fatigue 6/10',
      ],
      usedOfflineFallback: true,
    };
  }

  return {
    reply:
      'Tell me what you’re feeling in your own words — for example, "throbbing behind my left eye 6/10 after poor sleep".',
    proposedEntries: [],
    followUpChips: [
      'Symptom-free today',
      'Headache behind eyes 5/10',
      'Stomach bloating 4/10',
    ],
    usedOfflineFallback: true,
  };
}

export async function sendSymptomChatMessage(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  profile: 'female' | 'male',
  flattenedSymptoms: FlattenedSymptomItem[],
  isOnline: boolean
): Promise<ChatAssistantResponse> {
  const latestUserText =
    messages[messages.length - 1]?.text || '';

  if (!isOnline) {
    return parseSymptomLocally(latestUserText, flattenedSymptoms, profile);
  }

  try {
    const response = await fetch('/api/chat-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, profile }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as ChatAssistantResponse;
    return {
      reply:
        data.reply ||
        'I have noted that down. Adjust any details on the entry card below.',
      proposedEntries: Array.isArray(data.proposedEntries)
        ? data.proposedEntries
        : [],
      followUpChips: Array.isArray(data.followUpChips)
        ? data.followUpChips.slice(0, 4)
        : [],
      usedOfflineFallback: false,
    };
  } catch (err) {
    console.warn('Falling back to local offline symptom parser:', err);
    return parseSymptomLocally(latestUserText, flattenedSymptoms, profile);
  }
}
