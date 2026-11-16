import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SYMPTOM_TREE,
  normalizeLegacyLog,
  SymptomLogEntry,
  SymptomTree,
  todayISODate,
  TrackerSettings,
  cycleDayFor,
  severityLabel,
} from '../data/symptomTree';
import { db, handleFirestoreError, OperationType } from '../firebase';

const LOGS_STORAGE_KEY = 'symptomLogs_v2';
const SETTINGS_STORAGE_KEY = 'trackerSettings_v1';
const TREE_STORAGE_KEY = 'symptomCustomTree_v4';
const QUEUE_STORAGE_KEY = 'fieldnotes_sync_queue_v1';
const LAST_SYNC_KEY = 'fieldnotes_last_sync_v1';

export interface PendingMutation {
  type: 'upsert_log' | 'delete_log' | 'upsert_settings';
  logId?: string;
  timestamp: number;
}

export function loadLocalLogs(): SymptomLogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeLegacyLog(item))
      .sort(
        (a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
      );
  } catch {
    return [];
  }
}

export function saveLocalLogs(logs: SymptomLogEntry[]): void {
  try {
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to save logs to localStorage', e);
  }
}

export function loadLocalSettings(): TrackerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      profile: parsed.profile === 'male' ? 'male' : 'female',
      cycleAnchor:
        typeof parsed.cycleAnchor === 'string'
          ? parsed.cycleAnchor.slice(0, 32)
          : '',
      cycleLength:
        typeof parsed.cycleLength === 'number' &&
        parsed.cycleLength >= 15 &&
        parsed.cycleLength <= 60
          ? Math.round(parsed.cycleLength)
          : 28,
      reminderEnabled: Boolean(parsed.reminderEnabled),
      reminderTime:
        typeof parsed.reminderTime === 'string' &&
        parsed.reminderTime.length >= 4
          ? parsed.reminderTime.slice(0, 10)
          : '20:00',
      customFavorites: Array.isArray(parsed.customFavorites)
        ? parsed.customFavorites
            .map((s: unknown) => String(s).slice(0, 200))
            .slice(0, 10)
        : DEFAULT_SETTINGS.customFavorites,
      categoryNames: parsed.categoryNames || {},
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLocalSettings(settings: TrackerSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings to localStorage', e);
  }
}

export function loadLocalTree(): SymptomTree {
  try {
    const raw = localStorage.getItem(TREE_STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SYMPTOM_TREE));
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SYMPTOM_TREE));
  }
}

export function saveLocalTree(tree: SymptomTree): void {
  try {
    localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(tree));
  } catch (e) {
    console.error('Failed to save custom symptom tree', e);
  }
}

export function loadSyncQueue(): PendingMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSyncQueue(queue: PendingMutation[]): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to save sync queue', e);
  }
}

export function enqueueMutation(mutation: PendingMutation): PendingMutation[] {
  const current = loadSyncQueue();
  const filtered = current.filter((m) => {
    if (
      mutation.type === 'upsert_settings' &&
      m.type === 'upsert_settings'
    ) {
      return false;
    }
    if (mutation.logId && m.logId === mutation.logId) {
      return false;
    }
    return true;
  });
  const next = [...filtered, mutation];
  saveSyncQueue(next);
  return next;
}

export function getLastSyncISO(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

export function setLastSyncISO(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso);
  } catch {
    // ignore
  }
}

function sanitizeId(raw: string, maxLen: number): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, maxLen);
  return cleaned || `id_${Date.now()}`;
}

export async function ensureUserSettingsDoc(
  uid: string,
  settings: TrackerSettings
): Promise<void> {
  const safeUid = sanitizeId(uid, 128);
  const path = `users/${safeUid}`;
  const userRef = doc(db, 'users', safeUid);

  const payload = {
    uid: safeUid,
    profile: settings.profile === 'male' ? 'male' : 'female',
    cycleAnchor: String(settings.cycleAnchor || '').slice(0, 32),
    cycleLength: Math.min(
      60,
      Math.max(15, Math.round(Number(settings.cycleLength) || 28))
    ),
    reminderEnabled: Boolean(settings.reminderEnabled),
    reminderTime: String(settings.reminderTime || '20:00').slice(0, 10),
    customFavorites: (settings.customFavorites || [])
      .map((f) => String(f).slice(0, 200))
      .slice(0, 10),
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, payload);
    } else {
      await updateDoc(userRef, {
        profile: payload.profile,
        cycleAnchor: payload.cycleAnchor,
        cycleLength: payload.cycleLength,
        reminderEnabled: payload.reminderEnabled,
        reminderTime: payload.reminderTime,
        customFavorites: payload.customFavorites,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function pushSymptomLogToCloud(
  uid: string,
  entry: SymptomLogEntry,
  settings: TrackerSettings
): Promise<void> {
  const safeUid = sanitizeId(uid, 128);
  const safeLogId = sanitizeId(entry.id, 64);
  const path = `users/${safeUid}/logs/${safeLogId}`;
  const logRef = doc(db, 'users', safeUid, 'logs', safeLogId);

  // Master gate invariant: ensure parent user document exists first
  await ensureUserSettingsDoc(safeUid, settings);

  const baseFields = {
    id: safeLogId,
    userId: safeUid,
    dateISO: String(entry.dateISO || new Date().toISOString()).slice(0, 40),
    category: String(entry.category || entry.path[0] || 'Physical').slice(0, 40),
    region: String(entry.region || entry.path[1] || 'General').slice(0, 80),
    subregion: String(entry.subregion || entry.path[2] || 'General').slice(0, 80),
    side: String(entry.side || 'None').slice(0, 40),
    symptom: String(
      entry.symptom || entry.path[entry.path.length - 1] || 'Symptom'
    ).slice(0, 120),
    severity: Math.min(10, Math.max(0, Math.round(Number(entry.severity) || 0))),
    baseline: Boolean(entry.baseline),
    periodStart: Boolean(entry.periodStart),
    notes: String(entry.notes || '').slice(0, 1000),
    tags: (entry.tags || []).map((t) => String(t).slice(0, 40)).slice(0, 12),
    updatedAt: serverTimestamp(),
  };

  try {
    const existingSnap = await getDoc(logRef);
    if (!existingSnap.exists()) {
      await setDoc(logRef, {
        ...baseFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(logRef, {
        dateISO: baseFields.dateISO,
        category: baseFields.category,
        region: baseFields.region,
        subregion: baseFields.subregion,
        side: baseFields.side,
        symptom: baseFields.symptom,
        severity: baseFields.severity,
        baseline: baseFields.baseline,
        periodStart: baseFields.periodStart,
        notes: baseFields.notes,
        tags: baseFields.tags,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSymptomLogFromCloud(
  uid: string,
  logId: string
): Promise<void> {
  const safeUid = sanitizeId(uid, 128);
  const safeLogId = sanitizeId(logId, 64);
  const path = `users/${safeUid}/logs/${safeLogId}`;
  const logRef = doc(db, 'users', safeUid, 'logs', safeLogId);
  try {
    await deleteDoc(logRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToCloudData(
  uid: string,
  onLogsUpdate: (cloudLogs: SymptomLogEntry[]) => void,
  onSettingsUpdate: (cloudSettings: Partial<TrackerSettings>) => void
): () => void {
  const safeUid = sanitizeId(uid, 128);
  const userPath = `users/${safeUid}`;
  const logsPath = `users/${safeUid}/logs`;

  const unsubUser = onSnapshot(
    doc(db, 'users', safeUid),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        onSettingsUpdate({
          profile: data.profile === 'male' ? 'male' : 'female',
          cycleAnchor:
            typeof data.cycleAnchor === 'string' ? data.cycleAnchor : '',
          cycleLength:
            typeof data.cycleLength === 'number' ? data.cycleLength : 28,
          reminderEnabled: Boolean(data.reminderEnabled),
          reminderTime:
            typeof data.reminderTime === 'string' ? data.reminderTime : '20:00',
          customFavorites: Array.isArray(data.customFavorites)
            ? data.customFavorites
            : DEFAULT_SETTINGS.customFavorites,
        });
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, userPath);
    }
  );

  // Query Enforcer rule compliance: explicitly filter where('userId', '==', safeUid)
  const logsQuery = query(
    collection(db, 'users', safeUid, 'logs'),
    where('userId', '==', safeUid)
  );

  const unsubLogs = onSnapshot(
    logsQuery,
    (snap) => {
      const items: SymptomLogEntry[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const reconstructedPath = reconstructPathFromDoc(d);
        items.push({
          id: String(d.id || docSnap.id),
          dateISO: String(d.dateISO || new Date().toISOString()),
          path: reconstructedPath,
          category: String(d.category || 'Physical'),
          region: String(d.region || 'General'),
          subregion: String(d.subregion || 'General'),
          side: String(d.side || 'None'),
          symptom: String(d.symptom || 'Symptom'),
          severity: Number(d.severity ?? 0),
          baseline: Boolean(d.baseline),
          periodStart: Boolean(d.periodStart),
          notes: String(d.notes || ''),
          tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
          synced: true,
        });
      });
      items.sort(
        (a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
      );
      onLogsUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, logsPath);
    }
  );

  return () => {
    unsubUser();
    unsubLogs();
  };
}

function reconstructPathFromDoc(d: Record<string, unknown>): string[] {
  const cat = String(d.category || 'Physical');
  const region = String(d.region || 'General');
  const subregion = String(d.subregion || 'General');
  const side = String(d.side || 'None');
  const symptom = String(d.symptom || 'Symptom');

  if (cat === 'Baseline' || Boolean(d.baseline)) {
    return ['Baseline', symptom];
  }
  if (Boolean(d.periodStart)) {
    return ['Cycle', 'Period started'];
  }
  if (cat === 'Cycle') {
    return ['Cycle', region, symptom];
  }
  if (side !== 'None' && side !== '') {
    return [cat, region, subregion, side, symptom];
  }
  if (subregion !== region) {
    return [cat, region, subregion, symptom];
  }
  return [cat, region, symptom];
}

export function buildCSVExport(
  logs: SymptomLogEntry[],
  settings: TrackerSettings
): string {
  const csvEscape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const header = [
    'id',
    'date',
    'time',
    'category',
    'level1',
    'level2',
    'level3',
    'severity_score',
    'severity_label',
    'tags',
    'cycle_day',
    'notes',
  ];
  const rows: string[][] = [header];

  logs
    .slice()
    .reverse()
    .forEach((l) => {
      const d = new Date(l.dateISO);
      const cDay = cycleDayFor(d, settings.cycleAnchor, settings.cycleLength);
      rows.push([
        l.id,
        todayISODate(d),
        d.toTimeString().slice(0, 5),
        l.path[0] || l.category,
        l.path[1] || l.region,
        l.path[2] || l.subregion,
        l.path.slice(3).join(' › ') || l.symptom,
        l.baseline || l.periodStart ? '' : String(l.severity),
        l.periodStart
          ? 'Period started'
          : l.baseline
            ? 'Symptom-free'
            : severityLabel(l.severity),
        (l.tags || []).join('; '),
        cDay ? String(cDay) : '',
        l.notes || '',
      ]);
    });

  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
