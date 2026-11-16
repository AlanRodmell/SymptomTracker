import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  CornerDownLeft,
  Download,
  Edit3,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { ConversationalLogger } from './components/ConversationalLogger';
import {
  cycleDayFor,
  FlattenedSymptomItem,
  flattenSymptomTree,
  getCyclePredictions,
  normalizeLegacyLog,
  parsePathToFields,
  severityLabel,
  severityTone,
  SymptomLogEntry,
  SymptomTree,
  SymptomTreeNode,
  toDatetimeLocalValue,
  todayISODate,
  TrackerSettings,
  TRIGGER_TAGS,
} from './data/symptomTree';
import { auth, googleProvider } from './firebase';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWA';
import {
  AIInsightsResult,
  buildLocalFallbackInsights,
  generateAIInsights,
  loadCachedAIInsights,
} from './services/aiInsights';
import {
  buildCSVExport,
  deleteSymptomLogFromCloud,
  enqueueMutation,
  ensureUserSettingsDoc,
  getLastSyncISO,
  loadLocalLogs,
  loadLocalSettings,
  loadLocalTree,
  loadSyncQueue,
  pushSymptomLogToCloud,
  saveLocalLogs,
  saveLocalSettings,
  saveLocalTree,
  saveSyncQueue,
  setLastSyncISO,
  subscribeToCloudData,
} from './services/syncEngine';

type ScreenView = 'chat' | 'history' | 'insights';

export default function App() {
  // Core Offline-First State
  const [logs, setLogs] = useState<SymptomLogEntry[]>(() => loadLocalLogs());
  const [settings, setSettings] = useState<TrackerSettings>(() =>
    loadLocalSettings()
  );
  const [tree, setTree] = useState<SymptomTree>(() => loadLocalTree());

  // Minimalist View & Sheet State
  const [activeView, setActiveView] = useState<ScreenView>('chat');
  const [bodyTreeModalOpen, setBodyTreeModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auth & Cloud Sync State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(
    () => loadSyncQueue().length
  );
  const [lastSyncISO, setLastSyncState] = useState<string | null>(() =>
    getLastSyncISO()
  );

  // Connectivity & PWA Install
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // AI-Driven Insights State
  const [aiInsights, setAiInsights] = useState<AIInsightsResult | null>(() =>
    loadCachedAIInsights()
  );
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [insightQuestion, setInsightQuestion] = useState('');
  const lastAnalyzedCountRef = useRef<number>(-1);

  // Body Tree Sheet State (for visual picking when preferred over typing)
  const [searchQuery, setSearchQuery] = useState('');
  const [treeCategory, setTreeCategory] = useState<string>('Physical');
  const [currentPath, setCurrentPath] = useState<string[]>(['Physical']);
  const [selectedLeafPath, setSelectedLeafPath] = useState<string[] | null>(
    null
  );
  const [severity, setSeverity] = useState<number>(4);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [datetimeLocal, setDatetimeLocal] = useState<string>(() =>
    toDatetimeLocalValue(new Date())
  );
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  // History Filter State
  const [historyCategory, setHistoryCategory] = useState<string>('All');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [confirmClear, setConfirmClear] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  };

  useEffect(() => {
    saveLocalLogs(logs);
  }, [logs]);

  useEffect(() => {
    saveLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveLocalTree(tree);
  }, [tree]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;

    const unsub = subscribeToCloudData(
      user.uid,
      (cloudLogs) => {
        setLogs((prevLocal) => {
          const queue = loadSyncQueue();
          const pendingDeletes = new Set(
            queue.filter((m) => m.type === 'delete_log').map((m) => m.logId)
          );
          const pendingUpserts = new Set(
            queue.filter((m) => m.type === 'upsert_log').map((m) => m.logId)
          );

          const mergedMap = new Map<string, SymptomLogEntry>();
          for (const cLog of cloudLogs) {
            if (!pendingDeletes.has(cLog.id)) {
              mergedMap.set(cLog.id, { ...cLog, synced: true });
            }
          }
          for (const lLog of prevLocal) {
            if (pendingDeletes.has(lLog.id)) continue;
            if (!mergedMap.has(lLog.id) || pendingUpserts.has(lLog.id)) {
              mergedMap.set(lLog.id, lLog);
            }
          }

          return Array.from(mergedMap.values()).sort(
            (a, b) =>
              new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
          );
        });
        const nowISO = new Date().toISOString();
        setLastSyncISO(nowISO);
        setLastSyncState(nowISO);
      },
      (cloudSettings) => {
        const queue = loadSyncQueue();
        const hasPendingSettings = queue.some(
          (m) => m.type === 'upsert_settings'
        );
        if (!hasPendingSettings) {
          setSettings((prev) => ({
            ...prev,
            ...cloudSettings,
          }));
        }
      }
    );

    return () => unsub();
  }, [authReady, user]);

  const flushSyncQueue = async () => {
    if (!user || !isOnline || isSyncing) return;
    setIsSyncing(true);
    try {
      await ensureUserSettingsDoc(user.uid, settings);

      const queue = loadSyncQueue();
      const currentLogs = loadLocalLogs();
      const logMap = new Map(currentLogs.map((l) => [l.id, l]));

      for (const item of queue) {
        if (item.type === 'upsert_settings') {
          await ensureUserSettingsDoc(user.uid, settings);
        } else if (item.type === 'delete_log' && item.logId) {
          await deleteSymptomLogFromCloud(user.uid, item.logId);
        } else if (item.type === 'upsert_log' && item.logId) {
          const entry = logMap.get(item.logId);
          if (entry) {
            await pushSymptomLogToCloud(user.uid, entry, settings);
          }
        }
      }

      const unsyncedLogs = currentLogs.filter((l) => !l.synced);
      for (const entry of unsyncedLogs) {
        await pushSymptomLogToCloud(user.uid, entry, settings);
      }

      saveSyncQueue([]);
      setPendingCount(0);
      setLogs((prev) => prev.map((l) => ({ ...l, synced: true })));
      const nowISO = new Date().toISOString();
      setLastSyncISO(nowISO);
      setLastSyncState(nowISO);
    } catch (e) {
      console.error('Sync flush error:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (authReady && user && isOnline) {
      flushSyncQueue();
    }
  }, [authReady, user, isOnline]);

  // Run AI Insights automatically when opening the Insights tab if logs changed
  const handleRunAIInsights = async (customQ?: string) => {
    if (isGeneratingInsights) return;
    setIsGeneratingInsights(true);
    try {
      const res = await generateAIInsights(
        logs,
        settings,
        isOnline,
        customQ?.trim() || undefined
      );
      setAiInsights(res);
      lastAnalyzedCountRef.current = logs.length;
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  useEffect(() => {
    if (activeView === 'insights') {
      if (
        !aiInsights ||
        lastAnalyzedCountRef.current !== logs.length
      ) {
        handleRunAIInsights();
      }
    }
  }, [activeView, logs.length]);

  const flattenedSymptoms = useMemo(
    () => flattenSymptomTree(tree, settings.profile),
    [tree, settings.profile]
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    return flattenedSymptoms
      .filter((item) => tokens.every((tok) => item.searchText.includes(tok)))
      .slice(0, 10);
  }, [searchQuery, flattenedSymptoms]);

  const quickStarterChips = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of logs) {
      if (l.baseline || l.periodStart) continue;
      const key = `${l.symptom} (${l.subregion})`;
      counts[key] = (counts[key] || 0) + 1;
    }
    const topFrequent = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => `${k} 5/10`);

    return [
      'Symptom-free today',
      ...(topFrequent.length > 0
        ? topFrequent
        : ['Throbbing headache 6/10', 'Lower back ache 4/10']),
      ...(settings.profile !== 'male' ? ['Period started today'] : []),
    ];
  }, [logs, settings.profile]);

  const streakCount = useMemo(() => {
    const days = new Set(logs.map((l) => todayISODate(new Date(l.dateISO))));
    let streak = 0;
    const cursor = new Date();
    while (true) {
      const key = todayISODate(cursor);
      if (days.has(key)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [logs]);

  const todaysLogs = useMemo(() => {
    const todayKey = todayISODate();
    return logs.filter((l) => todayISODate(new Date(l.dateISO)) === todayKey);
  }, [logs]);

  const cyclePrediction = useMemo(() => {
    if (settings.profile === 'male') return null;
    return getCyclePredictions(settings.cycleAnchor, settings.cycleLength);
  }, [settings.profile, settings.cycleAnchor, settings.cycleLength]);

  const commitLogEntry = async (entry: SymptomLogEntry) => {
    setLogs((prev) => {
      const updated = [entry, ...prev.filter((l) => l.id !== entry.id)].sort(
        (a, b) =>
          new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
      );
      saveLocalLogs(updated);
      return updated;
    });

    if (user && isOnline) {
      try {
        setIsSyncing(true);
        await pushSymptomLogToCloud(user.uid, entry, settings);
        setLogs((prev) =>
          prev.map((l) => (l.id === entry.id ? { ...l, synced: true } : l))
        );
        const nowISO = new Date().toISOString();
        setLastSyncISO(nowISO);
        setLastSyncState(nowISO);
      } catch {
        const q = enqueueMutation({
          type: 'upsert_log',
          logId: entry.id,
          timestamp: Date.now(),
        });
        setPendingCount(q.length);
      } finally {
        setIsSyncing(false);
      }
    } else {
      const q = enqueueMutation({
        type: 'upsert_log',
        logId: entry.id,
        timestamp: Date.now(),
      });
      setPendingCount(q.length);
    }
  };

  const commitSettingsUpdate = async (nextSettings: TrackerSettings) => {
    setSettings(nextSettings);
    saveLocalSettings(nextSettings);

    if (user && isOnline) {
      try {
        setIsSyncing(true);
        await ensureUserSettingsDoc(user.uid, nextSettings);
        const nowISO = new Date().toISOString();
        setLastSyncISO(nowISO);
        setLastSyncState(nowISO);
      } catch {
        const q = enqueueMutation({
          type: 'upsert_settings',
          timestamp: Date.now(),
        });
        setPendingCount(q.length);
      } finally {
        setIsSyncing(false);
      }
    } else {
      const q = enqueueMutation({
        type: 'upsert_settings',
        timestamp: Date.now(),
      });
      setPendingCount(q.length);
    }
  };

  const resetLoggerToCategory = (cat: string) => {
    setTreeCategory(cat);
    setCurrentPath([cat]);
    setSelectedLeafPath(null);
    setEditingLogId(null);
    setSeverity(4);
    setSelectedTags([]);
    setNotes('');
    setDatetimeLocal(toDatetimeLocalValue(new Date()));
  };

  const currentTreeNode = useMemo(() => {
    let cursor: SymptomTreeNode | string[] | undefined = tree[currentPath[0]];
    for (let i = 1; i < currentPath.length; i++) {
      if (!cursor || Array.isArray(cursor)) return null;
      cursor = cursor[currentPath[i]];
    }
    return cursor || null;
  }, [tree, currentPath]);

  const handleSelectTreeOption = (choice: string) => {
    if (!currentTreeNode) return;
    if (Array.isArray(currentTreeNode)) {
      const fullPath = [...currentPath, choice];
      setSelectedLeafPath(fullPath);
      setDatetimeLocal(toDatetimeLocalValue(new Date()));
    } else {
      const nextNode = currentTreeNode[choice];
      if (!nextNode) {
        setSelectedLeafPath([...currentPath, choice]);
      } else {
        setCurrentPath([...currentPath, choice]);
      }
    }
  };

  const handleSaveDetailedLog = () => {
    const targetPath = selectedLeafPath || currentPath;
    const parsed = parsePathToFields(targetPath);
    const id = editingLogId || `log_${Date.now()}`;
    const parsedDate = datetimeLocal ? new Date(datetimeLocal) : new Date();
    const dateISO = isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();

    const entry: SymptomLogEntry = {
      id,
      dateISO,
      path: targetPath,
      ...parsed,
      severity,
      baseline: false,
      periodStart: false,
      notes: notes.trim().slice(0, 1000),
      tags: selectedTags.slice(0, 12),
      synced: false,
    };

    commitLogEntry(entry);
    showToast(editingLogId ? 'Entry updated' : 'Symptom logged');
    resetLoggerToCategory(treeCategory);
    setBodyTreeModalOpen(false);
  };

  const handleEditLog = (entry: SymptomLogEntry) => {
    setEditingLogId(entry.id);
    setTreeCategory(entry.path[0] || 'Physical');
    setCurrentPath(entry.path.slice(0, -1));
    setSelectedLeafPath(entry.path);
    setSeverity(entry.severity || 4);
    setSelectedTags(entry.tags || []);
    setNotes(entry.notes || '');
    setDatetimeLocal(toDatetimeLocalValue(new Date(entry.dateISO)));
    setBodyTreeModalOpen(true);
  };

  const handleDeleteLog = async (id: string) => {
    setLogs((prev) => {
      const next = prev.filter((l) => l.id !== id);
      saveLocalLogs(next);
      return next;
    });

    if (user && isOnline) {
      try {
        await deleteSymptomLogFromCloud(user.uid, id);
      } catch {
        const q = enqueueMutation({
          type: 'delete_log',
          logId: id,
          timestamp: Date.now(),
        });
        setPendingCount(q.length);
      }
    } else {
      const q = enqueueMutation({
        type: 'delete_log',
        logId: id,
        timestamp: Date.now(),
      });
      setPendingCount(q.length);
    }
    showToast('Entry removed');
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Signed in · Cloud sync active');
    } catch {
      showToast('Sign-in cancelled');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    showToast('Signed out · Offline local mode');
  };

  const handleExportCSV = () => {
    const csv = buildCSVExport(logs, settings);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldnotes-${todayISODate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported CSV');
  };

  const handleExportJSON = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      logs,
      tree,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldnotes-backup-${todayISODate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Saved JSON backup');
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.logs)) throw new Error('Invalid backup');
        const importedLogs = data.logs.map((item: Record<string, unknown>) =>
          normalizeLegacyLog(item)
        );
        const mergedMap = new Map<string, SymptomLogEntry>();
        for (const l of [...logs, ...importedLogs]) {
          mergedMap.set(l.id, l);
        }
        const merged = Array.from(mergedMap.values()).sort(
          (a, b) =>
            new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
        );
        setLogs(merged);
        if (data.tree && typeof data.tree === 'object') {
          setTree(data.tree);
        }
        if (data.settings && typeof data.settings === 'object') {
          commitSettingsUpdate({ ...settings, ...data.settings });
        }
        showToast(`Restored ${importedLogs.length} entries`);
      } catch {
        showToast('Could not read backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return logs.filter((l) => {
      if (historyCategory !== 'All' && l.category !== historyCategory) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        ...l.path,
        l.notes,
        ...(l.tags || []),
        severityLabel(l.severity),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, historyCategory, historySearch]);

  const insightsData = useMemo(() => {
    const symptomOnly = logs.filter((l) => !l.baseline && !l.periodStart);
    const heatmapDays: {
      dateStr: string;
      dayNum: string;
      count: number;
      maxSev: number;
    }[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayISODate(d);
      const dayLogs = logs.filter(
        (l) => todayISODate(new Date(l.dateISO)) === key
      );
      const maxSev = dayLogs.reduce(
        (m, l) => Math.max(m, l.baseline ? 1 : l.severity),
        0
      );
      heatmapDays.push({
        dateStr: key,
        dayNum: String(d.getDate()),
        count: dayLogs.length,
        maxSev,
      });
    }

    return {
      totalSymptomLogs: symptomOnly.length,
      baselineDays: logs.filter((l) => l.baseline).length,
      heatmapDays,
    };
  }, [logs]);

  const activeInsights =
    aiInsights || buildLocalFallbackInsights(logs, settings);

  const handleCopyDoctorSummary = () => {
    const text = [
      `Fieldnotes Clinical Summary (${todayISODate()})`,
      activeInsights.headline,
      activeInsights.summary,
      ...(activeInsights.clinicianNotes.length > 0
        ? ['\nKey Observations:', ...activeInsights.clinicianNotes.map((n) => `- ${n}`)]
        : []),
    ].join('\n');
    navigator.clipboard?.writeText(text);
    showToast('Copied clinician summary to clipboard');
  };

  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#17211B]">
      {/* Minimalist 3-Zone Top Bar (Wordmark — 3 View Links — Sync/Settings Button) */}
      <header className="sticky top-0 z-30 h-14 bg-[#F6F7F4]/95 backdrop-blur-md border-b border-[#E3E7DF] px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
        <a
          href="#chat"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('chat');
          }}
          className="font-display text-lg font-bold tracking-tight text-[#17211B] whitespace-nowrap shrink-0"
        >
          Fieldnotes
        </a>

        {/* Clean Single-Line Options Bar */}
        <nav className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-[#5B675F]">
          <button
            type="button"
            onClick={() => setActiveView('chat')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'chat'
                ? 'text-[#17211B] underline underline-offset-8 decoration-2 decoration-[#2F5241]'
                : 'hover:text-[#17211B]'
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveView('history')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'history'
                ? 'text-[#17211B] underline underline-offset-8 decoration-2 decoration-[#2F5241]'
                : 'hover:text-[#17211B]'
            }`}
          >
            History ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('insights')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'insights'
                ? 'text-[#17211B] underline underline-offset-8 decoration-2 decoration-[#2F5241]'
                : 'hover:text-[#17211B]'
            }`}
          >
            Insights
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] text-xs font-medium text-[#17211B] hover:border-[#2F5241]/40 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {!isOnline ? (
              <WifiOff className="w-3.5 h-3.5 text-[#B85D19]" />
            ) : user ? (
              <Cloud className="w-3.5 h-3.5 text-[#2F5241]" />
            ) : (
              <Settings className="w-3.5 h-3.5 text-[#5B675F]" />
            )}
            <span className="hidden sm:inline">
              {!isOnline
                ? 'Offline'
                : user
                  ? isSyncing
                    ? 'Syncing'
                    : 'Synced'
                  : 'Options'}
            </span>
          </button>
        </div>
      </header>

      {/* Subtle Offline / Pending Queue Bar */}
      {(!isOnline || pendingCount > 0) && (
        <div className="bg-[#EFECE4] border-b border-[#E3E7DF] px-4 py-1.5 text-xs text-[#4A554E] flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <CloudOff className="w-3.5 h-3.5 text-[#8F6B1A] shrink-0" />
            <span>
              {!isOnline
                ? 'Offline mode — logs save locally and sync when reconnected.'
                : `${pendingCount} offline change${pendingCount === 1 ? '' : 's'} queued for sync.`}
            </span>
          </div>
          {isOnline && user && (
            <button
              type="button"
              onClick={flushSyncQueue}
              className="font-medium text-[#2F5241] hover:underline whitespace-nowrap shrink-0 ml-3"
            >
              Sync now
            </button>
          )}
        </div>
      )}

      {/* ================= PRIMARY VIEW 1: PURE CONVERSATIONAL CANVAS ================= */}
      {activeView === 'chat' && (
        <ConversationalLogger
          profile={settings.profile}
          isOnline={isOnline}
          flattenedSymptoms={flattenedSymptoms}
          quickStarters={quickStarterChips}
          todaysCount={todaysLogs.length}
          streakCount={streakCount}
          onCommitLog={commitLogEntry}
          onDeleteLog={handleDeleteLog}
          onUpdateCycleAnchor={(dateStr) =>
            commitSettingsUpdate({ ...settings, cycleAnchor: dateStr })
          }
          onOpenBodyTree={() => {
            resetLoggerToCategory('Physical');
            setBodyTreeModalOpen(true);
          }}
          onOpenHistory={() => setActiveView('history')}
        />
      )}

      {/* ================= VIEW 2: CLEAN HISTORY LIST ================= */}
      {activeView === 'history' && (
        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-semibold text-[#17211B]">
              Symptom History
            </h1>
            <button
              type="button"
              onClick={handleExportCSV}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] text-xs font-medium text-[#17211B] flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-[#E3E7DF] p-3.5 flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1 flex items-center">
              <Search className="w-4 h-4 text-[#5B675F] absolute left-3 pointer-events-none" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search symptoms, triggers, or notes..."
                className="w-full min-h-[40px] pl-9 pr-4 py-1.5 rounded-xl bg-[#F6F7F4] text-sm text-[#17211B] placeholder:text-[#5B675F] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#F6F7F4] rounded-xl">
              {[
                'All',
                'Physical',
                ...(settings.profile !== 'male' ? ['Cycle'] : []),
                'Baseline',
              ].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setHistoryCategory(cat)}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    historyCategory === cat
                      ? 'bg-white text-[#17211B] shadow-xs'
                      : 'text-[#5B675F] hover:text-[#17211B]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E3E7DF] p-8 text-center space-y-2">
              <p className="text-sm font-medium text-[#17211B]">
                No entries found
              </p>
              <p className="text-xs text-[#5B675F]">
                Return to Chat to log how you’re feeling in plain words.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E3E7DF] divide-y divide-[#E3E7DF]">
              {filteredHistory.map((entry) => {
                const d = new Date(entry.dateISO);
                const cDay =
                  settings.profile !== 'male'
                    ? cycleDayFor(
                        d,
                        settings.cycleAnchor,
                        settings.cycleLength
                      )
                    : null;
                const tone = severityTone(entry.severity);

                return (
                  <div
                    key={entry.id}
                    className="p-4 flex items-start justify-between gap-4 hover:bg-[#FAFBF9]"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#5B675F] font-mono-num">
                        <span>
                          {d.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {d.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        {cDay && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Cycle day {cDay}</span>
                          </>
                        )}
                        {!entry.baseline && !entry.periodStart && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className={`font-semibold ${tone.text}`}>
                              {severityLabel(entry.severity)}{' '}
                              {entry.severity}/10
                            </span>
                          </>
                        )}
                      </div>

                      <div className="font-display text-sm sm:text-base font-semibold text-[#17211B]">
                        {entry.path.join(' › ')}
                      </div>

                      {(entry.tags.length > 0 || entry.notes) && (
                        <div className="text-xs text-[#5B675F] space-y-0.5">
                          {entry.tags.length > 0 && (
                            <div>Triggers: {entry.tags.join(' · ')}</div>
                          )}
                          {entry.notes && (
                            <div className="italic text-[#17211B]/80">
                              “{entry.notes}”
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!entry.baseline && !entry.periodStart && (
                        <button
                          type="button"
                          onClick={() => handleEditLog(entry)}
                          className="min-h-[38px] min-w-[38px] rounded-xl text-[#5B675F] hover:text-[#17211B] hover:bg-[#F6F7F4] flex items-center justify-center"
                          aria-label="Edit entry"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteLog(entry.id)}
                        className="min-h-[38px] min-w-[38px] rounded-xl text-[#5B675F] hover:text-[#9E2A2B] hover:bg-[#F6F7F4] flex items-center justify-center"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* ================= VIEW 3: AI-DRIVEN INSIGHTS ================= */}
      {activeView === 'insights' && (
        <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
          {/* Header + Refresh Button */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-xl font-semibold text-[#17211B]">
                Pattern & Rhythm Analysis
              </h1>
              <p className="text-xs text-[#5B675F]">
                Synthesized from your logged symptoms, severity scores, and
                triggers
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRunAIInsights()}
              disabled={isGeneratingInsights}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] text-xs font-medium text-[#17211B] hover:border-[#2F5241] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isGeneratingInsights ? 'animate-spin' : ''}`}
              />
              <span>{isGeneratingInsights ? 'Analyzing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* Primary AI Narrative Synthesis Card */}
          <section className="bg-white rounded-2xl border border-[#E3E7DF] p-5 space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs text-[#2F5241] font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isGeneratingInsights
                    ? 'Synthesizing your recent entries...'
                    : 'Overview'}
                </span>
              </div>
              <h2 className="font-display text-lg font-semibold text-[#17211B] text-balance">
                {activeInsights.headline}
              </h2>
              {activeInsights.summary && (
                <p className="text-sm text-[#5B675F] leading-relaxed">
                  {activeInsights.summary}
                </p>
              )}
            </div>

            {/* Custom Q&A Answer (when user asks a question about their patterns) */}
            {activeInsights.customAnswer && (
              <div className="p-4 rounded-xl bg-[#F6F7F4] space-y-1 text-sm text-[#17211B]">
                <div className="text-xs font-medium text-[#2F5241]">
                  Answer based on your logs
                </div>
                <p className="leading-relaxed">{activeInsights.customAnswer}</p>
              </div>
            )}

            {/* Interactive "Ask About Your History" Input + Quick Question Chips */}
            <div className="pt-2 border-t border-[#E3E7DF] space-y-2.5">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {[
                  'What triggers my symptoms most?',
                  'Summarize for my doctor',
                  ...(settings.profile !== 'male'
                    ? ['Any cycle phase correlations?']
                    : []),
                  'Are my symptoms improving?',
                ].map((qChip) => (
                  <button
                    key={qChip}
                    type="button"
                    disabled={isGeneratingInsights}
                    onClick={() => {
                      setInsightQuestion(qChip);
                      handleRunAIInsights(qChip);
                    }}
                    className="min-h-[34px] px-3 py-1 rounded-xl bg-[#F6F7F4] hover:bg-[#ECEFE9] text-xs font-medium text-[#17211B] whitespace-nowrap shrink-0 transition-colors"
                  >
                    {qChip}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!insightQuestion.trim()) return;
                  handleRunAIInsights(insightQuestion);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={insightQuestion}
                  onChange={(e) => setInsightQuestion(e.target.value)}
                  placeholder="Ask a question about your symptom history..."
                  className="flex-1 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#F6F7F4] text-sm text-[#17211B] placeholder:text-[#5B675F] focus:outline-none focus:ring-2 focus:ring-[#2F5241]"
                />
                <button
                  type="submit"
                  disabled={!insightQuestion.trim() || isGeneratingInsights}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#2F5241] text-white text-xs font-medium flex items-center gap-1 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <span>Ask</span>
                  <CornerDownLeft className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </section>

          {/* Discovered Correlations & Patterns */}
          {activeInsights.keyPatterns.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="font-display text-sm font-semibold text-[#17211B] px-1">
                Observed Correlations
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeInsights.keyPatterns.map((pat, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-[#E3E7DF] p-4 space-y-1.5"
                  >
                    <div className="text-xs text-[#2F5241] font-medium">
                      {pat.tag}
                    </div>
                    <h3 className="font-display text-sm font-semibold text-[#17211B]">
                      {pat.title}
                    </h3>
                    <p className="text-xs text-[#5B675F] leading-relaxed">
                      {pat.observation}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Doctor / Appointment Summary Points */}
          {activeInsights.clinicianNotes.length > 0 && (
            <section className="bg-white rounded-2xl border border-[#E3E7DF] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-[#17211B]">
                    Appointment Summary Notes
                  </h2>
                  <p className="text-xs text-[#5B675F]">
                    Concise points ready to share with a clinician
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyDoctorSummary}
                  className="min-h-[36px] px-3 py-1 rounded-xl bg-[#F6F7F4] hover:bg-[#ECEFE9] text-xs font-medium text-[#17211B] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
              <ul className="space-y-2 text-sm text-[#17211B] pt-1">
                {activeInsights.clinicianNotes.map((note, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="font-mono-num text-xs text-[#5B675F] pt-0.5">
                      0{idx + 1}.
                    </span>
                    <span className="leading-relaxed">{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Cycle Forecast + 28-Day Intensity Grid */}
          {cyclePrediction && (
            <section className="bg-white rounded-2xl border border-[#E3E7DF] p-5 space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-base font-semibold text-[#17211B]">
                  Cycle Day {cyclePrediction.cycleDay} ·{' '}
                  {cyclePrediction.phaseName}
                </h2>
                <span className="text-xs font-mono-num text-[#5B675F]">
                  Next period in {cyclePrediction.daysUntilNextPeriod}d
                </span>
              </div>
              <p className="text-xs text-[#5B675F]">
                {cyclePrediction.phaseSummary}
              </p>
            </section>
          )}

          <section className="bg-white rounded-2xl border border-[#E3E7DF] p-5 space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-base font-semibold text-[#17211B]">
                28-Day Intensity Rhythm
              </h2>
              <span className="font-mono-num text-xs text-[#5B675F]">
                {insightsData.totalSymptomLogs} symptoms ·{' '}
                {insightsData.baselineDays} symptom-free
              </span>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {insightsData.heatmapDays.map((cell) => {
                const bgClass =
                  cell.count === 0
                    ? 'bg-[#F0F2EE] text-[#5B675F]'
                    : cell.maxSev >= 7
                      ? 'bg-[#17211B] text-white'
                      : cell.maxSev >= 4
                        ? 'bg-[#2F5241] text-white'
                        : 'bg-[#A3B8AC] text-[#17211B]';
                return (
                  <div
                    key={cell.dateStr}
                    title={`${cell.dateStr}: ${cell.count} entries`}
                    className={`h-10 rounded-xl flex items-center justify-center font-mono-num text-xs ${bgClass}`}
                  >
                    {cell.dayNum}
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {/* ================= SLIDE-UP BODY TREE PICKER SHEET ================= */}
      {bodyTreeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl border border-[#E3E7DF] p-5 sm:p-6 max-h-[88vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E7DF]">
              <h2 className="font-display text-base font-semibold text-[#17211B]">
                {editingLogId ? 'Edit Symptom Entry' : 'Browse Body Tree'}
              </h2>
              <button
                type="button"
                onClick={() => setBodyTreeModalOpen(false)}
                className="min-h-[38px] min-w-[38px] rounded-xl flex items-center justify-center text-[#5B675F] hover:text-[#17211B]"
                aria-label="Close body tree"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!selectedLeafPath ? (
              <div className="space-y-4">
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-[#5B675F] absolute left-3 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Quick search (e.g. temple, knee, nausea)..."
                    className="w-full min-h-[42px] pl-9 pr-4 py-2 rounded-xl bg-[#F6F7F4] text-sm text-[#17211B]"
                  />
                </div>

                {searchResults.length > 0 ? (
                  <div className="divide-y divide-[#E3E7DF] max-h-64 overflow-y-auto">
                    {searchResults.map((item: FlattenedSymptomItem) => (
                      <button
                        key={item.pathKey}
                        type="button"
                        onClick={() => {
                          setTreeCategory(item.category);
                          setCurrentPath(item.path.slice(0, -1));
                          setSelectedLeafPath(item.path);
                          setSearchQuery('');
                        }}
                        className="w-full min-h-[48px] py-2 px-2 text-left hover:bg-[#F6F7F4] flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-medium text-[#17211B]">
                            {item.shortLabel}
                          </div>
                          <div className="text-xs text-[#5B675F]">
                            {item.category} › {item.contextLabel}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#5B675F]" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {Object.keys(tree)
                          .filter((cat) =>
                            settings.profile === 'male' ? cat !== 'Cycle' : true
                          )
                          .map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => resetLoggerToCategory(cat)}
                              className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium ${
                                treeCategory === cat
                                  ? 'bg-[#2F5241] text-white'
                                  : 'bg-[#F6F7F4] text-[#5B675F]'
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                      </div>
                      {currentPath.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentPath((prev) => prev.slice(0, -1))
                          }
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#F6F7F4] text-xs font-medium text-[#17211B] flex items-center gap-1"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Back</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(Array.isArray(currentTreeNode)
                        ? currentTreeNode
                        : currentTreeNode
                          ? Object.keys(currentTreeNode)
                          : []
                      ).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => handleSelectTreeOption(option)}
                          className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-[#F6F7F4] hover:bg-[#ECEFE9] text-left text-sm font-medium text-[#17211B] flex items-center justify-between"
                        >
                          <span>{option}</span>
                          <ChevronRight className="w-4 h-4 text-[#5B675F]" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[#5B675F]">
                      {selectedLeafPath.slice(0, -1).join(' › ')}
                    </p>
                    <h3 className="font-display text-lg font-semibold text-[#17211B]">
                      {selectedLeafPath[selectedLeafPath.length - 1]}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedLeafPath(null)}
                    className="min-h-[36px] px-3 py-1 rounded-xl bg-[#F6F7F4] text-xs font-medium text-[#17211B]"
                  >
                    Change
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5B675F]">Severity</span>
                    <span className="font-mono-num font-semibold text-[#17211B]">
                      {severity}/10 · {severityLabel(severity)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={severity}
                    onChange={(e) => setSeverity(Number(e.target.value))}
                    className="severity-slider bg-[#E3E7DF]"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {TRIGGER_TAGS.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag]
                          )
                        }
                        className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-medium ${
                          active
                            ? 'bg-[#2F5241] text-white'
                            : 'bg-[#F6F7F4] text-[#17211B]'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-[#F6F7F4] text-sm"
                />

                <button
                  type="button"
                  onClick={handleSaveDetailedLog}
                  className="w-full min-h-[48px] rounded-xl bg-[#2F5241] text-white text-sm font-medium"
                >
                  {editingLogId ? 'Update Entry' : 'Save to Log'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SETTINGS & CLOUD SYNC SHEET ================= */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl border border-[#E3E7DF] p-5 sm:p-6 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E7DF]">
              <h2 className="font-display text-lg font-semibold text-[#17211B]">
                Options, Sync & Backup
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="min-h-[38px] min-w-[38px] rounded-xl flex items-center justify-center text-[#5B675F] hover:text-[#17211B]"
                aria-label="Close options"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[#F6F7F4] flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#17211B]">
                  {user ? user.displayName || user.email : 'Cloud Sync'}
                </div>
                <div className="text-xs text-[#5B675F]">
                  {user
                    ? `${logs.length} entries backed up${
                        lastSyncISO
                          ? ` · Synced ${new Date(lastSyncISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                          : ''
                      }`
                    : 'Sign in with Google to sync across devices'}
                </div>
              </div>
              {user ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={flushSyncQueue}
                    disabled={isSyncing || !isOnline}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] text-xs font-medium flex items-center gap-1"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                    />
                    <span>Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] text-xs font-medium"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#2F5241] text-white text-xs font-medium whitespace-nowrap shrink-0"
                >
                  Sign In
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    commitSettingsUpdate({ ...settings, profile: 'female' })
                  }
                  className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border ${
                    settings.profile !== 'male'
                      ? 'bg-[#2F5241] text-white border-[#2F5241]'
                      : 'bg-[#F6F7F4] text-[#17211B] border-[#E3E7DF]'
                  }`}
                >
                  Cycle Tracking On
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commitSettingsUpdate({ ...settings, profile: 'male' })
                  }
                  className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border ${
                    settings.profile === 'male'
                      ? 'bg-[#2F5241] text-white border-[#2F5241]'
                      : 'bg-[#F6F7F4] text-[#17211B] border-[#E3E7DF]'
                  }`}
                >
                  Physical Only
                </button>
              </div>

              {settings.profile !== 'male' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#5B675F] block mb-1">
                      Last Period Start
                    </label>
                    <input
                      type="date"
                      value={settings.cycleAnchor}
                      onChange={(e) =>
                        commitSettingsUpdate({
                          ...settings,
                          cycleAnchor: e.target.value,
                        })
                      }
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-[#F6F7F4] border border-[#E3E7DF] text-xs font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#5B675F] block mb-1">
                      Cycle Length (days)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={60}
                      value={settings.cycleLength}
                      onChange={(e) =>
                        commitSettingsUpdate({
                          ...settings,
                          cycleLength: Number(e.target.value) || 28,
                        })
                      }
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-[#F6F7F4] border border-[#E3E7DF] text-xs font-mono-num"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E3E7DF]">
              <button
                type="button"
                onClick={handleExportCSV}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F6F7F4] text-xs font-medium text-[#17211B] flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F6F7F4] text-xs font-medium text-[#17211B] flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Backup JSON</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F6F7F4] text-xs font-medium text-[#17211B] flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Restore JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportJSON}
                className="hidden"
              />

              {!isInstalled && (isInstallable || isIOS) ? (
                <button
                  type="button"
                  onClick={() => (isIOS ? setShowIOSGuide(true) : install())}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-[#2F5241] text-white text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Install App</span>
                </button>
              ) : !confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F6F7F4] text-xs font-medium text-[#9E2A2B] flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Local</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setLogs([]);
                    saveLocalLogs([]);
                    setConfirmClear(false);
                    showToast('Local history cleared');
                  }}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-[#9E2A2B] text-white text-xs font-medium"
                >
                  Confirm Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-[#17211B]">
              Install Fieldnotes on iOS
            </h3>
            <p className="text-sm text-[#5B675F]">
              1. Tap the <strong>Share</strong> button in Safari.
              <br />
              2. Tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#2F5241] text-white text-sm font-medium"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#17211B] text-white text-xs font-medium shadow-lg whitespace-nowrap"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
