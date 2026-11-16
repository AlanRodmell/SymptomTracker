export type SymptomTreeNode = { [key: string]: SymptomTreeNode | string[] };

export interface SymptomTree {
  Physical: { [region: string]: SymptomTreeNode | string[] };
  Cycle: { [group: string]: SymptomTreeNode | string[] };
  [customCategory: string]: { [group: string]: SymptomTreeNode | string[] };
}

const bilat = (arr: string[]) => ({
  Left: [...arr],
  Right: [...arr],
  'Both sides': [...arr],
});

export const DEFAULT_SYMPTOM_TREE: SymptomTree = {
  Physical: {
    'Head & Neck': {
      'Head / Scalp': ['Ache', 'Throbbing', 'Sharp pain', 'Tenderness'],
      'Forehead & Temples': bilat([
        'Pressure',
        'Throbbing',
        'Dull ache',
        'Sharp pain',
      ]),
      Eyes: bilat([
        'Dry/Itchy',
        'Ache behind eyes',
        'Stabbing pain',
        'Pressure',
      ]),
      Ears: bilat(['Ache', 'Ringing', 'Pressure', 'Sharp pain']),
      'Nose & Sinuses': ['Congestion', 'Dryness', 'Pain', 'Pressure'],
      'Mouth & Jaw': bilat([
        'Toothache',
        'Jaw Clenching',
        'Soreness',
        'Clicking/Popping',
      ]),
      'Neck & Throat': ['Stiffness', 'Sore throat', 'Swollen Glands', 'Ache'],
    },
    'Arms & Hands': {
      Shoulders: bilat(['Stiffness', 'Ache', 'Sharp pain', 'Tension']),
      'Upper Arms': bilat(['Ache', 'Weakness', 'Soreness']),
      Elbows: bilat(['Ache', 'Sharp pain', 'Stiffness']),
      'Forearms & Wrists': bilat([
        'Ache',
        'Sharp pain',
        'Stiffness',
        'Weakness',
        'Tingling',
      ]),
      'Hands & Fingers': bilat([
        'Stiffness',
        'Ache',
        'Coldness',
        'Tingling',
        'Swelling',
      ]),
    },
    'Chest & Torso': {
      'Chest & Ribs': bilat(['Tightness', 'Ache', 'Sharp pain', 'Pressure']),
      Breasts: bilat(['Tenderness', 'Swelling', 'Sharp pain', 'Ache']),
      'Abdomen & Stomach': [
        'Cramping',
        'Bloating',
        'Sharp pain',
        'Nausea',
        'Indigestion',
      ],
      'Internal Organs (Heart/Lungs)': [
        'Palpitations',
        'Shortness of breath',
        'Pain when breathing',
      ],
    },
    'Back & Spine': {
      'Upper & Mid Back': ['Ache', 'Spasm', 'Stiffness', 'Sharp pain'],
      'Lower Back': [
        'Dull ache',
        'Severe cramping',
        'Stiffness',
        'Shooting pain',
      ],
      Spine: ['Tenderness', 'Sharp pain', 'Ache'],
      'Kidneys / Flanks': bilat(['Dull ache', 'Sharp pain', 'Tenderness']),
    },
    'Pelvis & Groin': {
      Hips: bilat(['Ache', 'Stiffness', 'Sharp pain', 'Clicking']),
      'Pelvis (General)': ['Pressure', 'Ache', 'Sharp pain', 'Cramping'],
      'Groin / Genitals': [
        'Soreness',
        'Itchiness',
        'Dryness',
        'Burning',
        'Sharp pain',
      ],
      Buttocks: bilat(['Ache', 'Shooting pain', 'Spasm']),
      'Internal Reproductive': [
        'Menstrual cramping',
        'Ovulation pain',
        'Deep pressure',
        'Sharp twinge',
      ],
    },
    'Legs & Feet': {
      Thighs: bilat(['Ache', 'Cramping', 'Weakness', 'Soreness']),
      Knees: bilat(['Ache', 'Sharp pain', 'Swelling', 'Stiffness']),
      'Shins & Calves': bilat(['Cramping', 'Ache', 'Tightness', 'Splints']),
      Ankles: bilat(['Ache', 'Swelling', 'Stiffness', 'Sharp pain']),
      'Feet & Toes': bilat([
        'Ache',
        'Sharp pain',
        'Swelling',
        'Coldness',
        'Tingling',
      ]),
    },
  },
  Cycle: {
    'Flow Level': ['Spotting', 'Light', 'Medium', 'Heavy', 'Passing Clots'],
    'Mood & Emotional': [
      'Irritability / Frustration',
      'Anxiety / Restlessness',
      'Sadness / Tearfulness',
      'Mood Swings',
      'Apathy / Low Motivation',
      'Brain Fog / Difficulty Concentrating',
    ],
    'Systemic & Other': [
      'Fatigue / Exhaustion',
      'Sleep Disturbances (Insomnia/Oversleeping)',
      'Food Cravings / Appetite Changes',
      'Gastrointestinal Issues (Diarrhea/Constipation)',
      'Severe Bloating / Water Retention',
      'Hot Flashes / Temperature Fluctuations',
      'Libido Changes',
    ],
  },
};

export const TRIGGER_TAGS = [
  'Sleep',
  'Stress',
  'Illness',
  'Food',
  'Exercise',
  'Weather',
  'Hormonal',
  'Medication',
  'Alcohol/Caffeine',
  'Injury',
  'Other',
] as const;

export interface SymptomLogEntry {
  id: string;
  dateISO: string;
  path: string[];
  category: string;
  region: string;
  subregion: string;
  side: string;
  symptom: string;
  severity: number;
  baseline: boolean;
  periodStart: boolean;
  notes: string;
  tags: string[];
  synced?: boolean;
  updatedAtISO?: string;
}

export interface TrackerSettings {
  profile: 'female' | 'male';
  cycleAnchor: string;
  cycleLength: number;
  reminderEnabled: boolean;
  reminderTime: string;
  customFavorites: string[];
  categoryNames?: Record<string, string>;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
  profile: 'female',
  cycleAnchor: '',
  cycleLength: 28,
  reminderEnabled: false,
  reminderTime: '20:00',
  customFavorites: [
    'Physical > Head & Neck > Forehead & Temples > Both sides > Throbbing',
    'Physical > Chest & Torso > Abdomen & Stomach > Cramping',
    'Physical > Back & Spine > Lower Back > Dull ache',
    'Cycle > Systemic & Other > Fatigue / Exhaustion',
  ],
  categoryNames: {},
};

export interface FlattenedSymptomItem {
  path: string[];
  pathKey: string;
  category: string;
  region: string;
  subregion: string;
  side: string;
  symptom: string;
  shortLabel: string;
  contextLabel: string;
  searchText: string;
}

export function parsePathToFields(path: string[]) {
  const category = (path[0] || 'Physical').slice(0, 40);
  if (path[0] === 'Baseline') {
    return {
      category: 'Baseline',
      region: 'Daily Check-in',
      subregion: 'Baseline',
      side: 'None',
      symptom: (path[1] || 'Symptom-free today').slice(0, 120),
    };
  }
  if (path.length === 2) {
    return {
      category,
      region: path[1].slice(0, 80),
      subregion: path[1].slice(0, 80),
      side: 'None',
      symptom: path[1].slice(0, 120),
    };
  }
  if (path.length === 3) {
    return {
      category,
      region: path[1].slice(0, 80),
      subregion: path[1].slice(0, 80),
      side: 'None',
      symptom: path[2].slice(0, 120),
    };
  }
  if (path.length === 4) {
    return {
      category,
      region: path[1].slice(0, 80),
      subregion: path[2].slice(0, 80),
      side: 'None',
      symptom: path[3].slice(0, 120),
    };
  }
  return {
    category,
    region: (path[1] || 'General').slice(0, 80),
    subregion: (path[2] || 'General').slice(0, 80),
    side: (path[3] || 'None').slice(0, 40),
    symptom: (path[path.length - 1] || 'Symptom').slice(0, 120),
  };
}

export function flattenSymptomTree(
  tree: SymptomTree,
  profile: 'female' | 'male'
): FlattenedSymptomItem[] {
  const items: FlattenedSymptomItem[] = [];

  function walk(node: SymptomTreeNode | string[], currentPath: string[]) {
    if (Array.isArray(node)) {
      for (const leaf of node) {
        const fullPath = [...currentPath, leaf];
        const parsed = parsePathToFields(fullPath);
        const pathKey = fullPath.join(' > ');
        const hasSide =
          parsed.side !== 'None' &&
          ['Left', 'Right', 'Both sides'].includes(parsed.side);
        const shortLabel = hasSide
          ? `${parsed.symptom} (${parsed.side === 'Both sides' ? 'Both' : parsed.side})`
          : parsed.symptom;
        const contextLabel =
          parsed.subregion !== parsed.region
            ? `${parsed.region} · ${parsed.subregion}`
            : parsed.region;
        items.push({
          path: fullPath,
          pathKey,
          ...parsed,
          shortLabel,
          contextLabel,
          searchText: fullPath.join(' ').toLowerCase(),
        });
      }
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...currentPath, k]);
      }
    }
  }

  for (const [cat, catNode] of Object.entries(tree)) {
    if (profile === 'male' && cat === 'Cycle') continue;
    walk(catNode, [cat]);
  }

  return items;
}

export function todayISODate(d: Date = new Date()): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function toDatetimeLocalValue(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

export function severityLabel(score: number): string {
  if (score >= 9) return 'Severe';
  if (score >= 7) return 'High';
  if (score >= 4) return 'Moderate';
  if (score >= 1) return 'Mild';
  return 'Baseline';
}

export function severityTone(score: number): {
  text: string;
  barBg: string;
  dotBg: string;
} {
  if (score >= 9) {
    return {
      text: 'text-[#9E2A2B]',
      barBg: 'bg-[#9E2A2B]',
      dotBg: 'bg-[#9E2A2B]',
    };
  }
  if (score >= 7) {
    return {
      text: 'text-[#B85D19]',
      barBg: 'bg-[#C86D25]',
      dotBg: 'bg-[#C86D25]',
    };
  }
  if (score >= 4) {
    return {
      text: 'text-[#8F6B1A]',
      barBg: 'bg-[#B5892E]',
      dotBg: 'bg-[#B5892E]',
    };
  }
  return {
    text: 'text-[#2F5241]',
    barBg: 'bg-[#2F5241]',
    dotBg: 'bg-[#2F5241]',
  };
}

export function cycleDayFor(
  dateObj: Date,
  cycleAnchor?: string | null,
  cycleLength: number = 28
): number | null {
  if (!cycleAnchor) return null;
  const anchor = new Date(cycleAnchor + 'T00:00:00');
  if (isNaN(anchor.getTime())) return null;
  const d = new Date(todayISODate(dateObj) + 'T00:00:00');
  const diff = Math.round((d.getTime() - anchor.getTime()) / 86400000);
  if (diff < 0) return null;
  return (diff % Math.max(15, cycleLength)) + 1;
}

export interface CyclePredictions {
  cycleDay: number;
  phaseName: string;
  phaseSummary: string;
  nextPeriod: Date;
  ovulation: Date;
  fertileStart: Date;
  fertileEnd: Date;
  currentAnchor: Date;
  daysUntilNextPeriod: number;
}

export function getCyclePredictions(
  anchorDateStr?: string | null,
  cycleLength: number = 28
): CyclePredictions | null {
  if (!anchorDateStr) return null;
  const anchor = new Date(anchorDateStr + 'T00:00:00');
  if (isNaN(anchor.getTime())) return null;

  const LUTEAL_PHASE = 14;
  const safeLength = Math.min(60, Math.max(15, cycleLength || 28));
  const today = new Date(todayISODate(new Date()) + 'T00:00:00');
  const diffDays = Math.floor(
    (today.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 0) return null;

  const cyclesPassed = Math.floor(diffDays / safeLength);
  const currentAnchor = new Date(
    anchor.getTime() + cyclesPassed * safeLength * 86400000
  );
  const cycleDay =
    Math.floor((today.getTime() - currentAnchor.getTime()) / 86400000) + 1;

  const nextPeriod = new Date(currentAnchor.getTime() + safeLength * 86400000);
  const ovulation = new Date(
    nextPeriod.getTime() - LUTEAL_PHASE * 86400000
  );
  const fertileStart = new Date(ovulation.getTime() - 5 * 86400000);
  const fertileEnd = new Date(ovulation.getTime() + 1 * 86400000);
  const daysUntilNextPeriod = Math.max(
    0,
    Math.round((nextPeriod.getTime() - today.getTime()) / 86400000)
  );

  const ovulationDay = safeLength - LUTEAL_PHASE;
  let phaseName = 'Follicular Phase';
  let phaseSummary = 'Rising baseline energy following menstruation.';
  if (cycleDay <= 5) {
    phaseName = 'Menstrual Phase';
    phaseSummary = 'Active shedding phase; track flow level and cramping.';
  } else if (cycleDay >= ovulationDay - 4 && cycleDay <= ovulationDay + 1) {
    phaseName = 'Ovulatory Window';
    phaseSummary = 'Peak estrogen and fertile window around mid-cycle.';
  } else if (cycleDay > ovulationDay + 1) {
    phaseName = 'Luteal Phase';
    phaseSummary = 'Post-ovulation phase; watch for systemic or mood shifts.';
  }

  return {
    cycleDay,
    phaseName,
    phaseSummary,
    nextPeriod,
    ovulation,
    fertileStart,
    fertileEnd,
    currentAnchor,
    daysUntilNextPeriod,
  };
}

export function normalizeLegacyLog(raw: Record<string, unknown>): SymptomLogEntry {
  const rawId = String(raw.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const dateISO =
    typeof raw.dateISO === 'string' && raw.dateISO.length >= 10
      ? raw.dateISO.slice(0, 40)
      : new Date().toISOString();
  const path = Array.isArray(raw.path)
    ? raw.path.map((p) => String(p))
    : ['Physical', 'General', 'Symptom'];
  const parsed = parsePathToFields(path);
  const baseline = Boolean(raw.baseline);
  const periodStart = Boolean(raw.periodStart);
  const rawSev = Number(raw.severity ?? raw.discomfort ?? (baseline || periodStart ? 0 : 4));
  const severity = Number.isFinite(rawSev)
    ? Math.min(10, Math.max(0, Math.round(rawSev)))
    : 0;
  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 1000) : '';
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).slice(0, 40)).slice(0, 12)
    : [];

  return {
    id: rawId || `log_${Date.now()}`,
    dateISO,
    path,
    category:
      typeof raw.category === 'string' && raw.category
        ? raw.category.slice(0, 40)
        : parsed.category,
    region:
      typeof raw.region === 'string' && raw.region
        ? raw.region.slice(0, 80)
        : parsed.region,
    subregion:
      typeof raw.subregion === 'string' && raw.subregion
        ? raw.subregion.slice(0, 80)
        : parsed.subregion,
    side:
      typeof raw.side === 'string' && raw.side
        ? raw.side.slice(0, 40)
        : parsed.side,
    symptom:
      typeof raw.symptom === 'string' && raw.symptom
        ? raw.symptom.slice(0, 120)
        : parsed.symptom,
    severity,
    baseline,
    periodStart,
    notes,
    tags,
    synced: Boolean(raw.synced),
    updatedAtISO:
      typeof raw.updatedAtISO === 'string'
        ? raw.updatedAtISO
        : new Date().toISOString(),
  };
}
