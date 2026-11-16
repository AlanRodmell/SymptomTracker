import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CornerDownLeft,
  ListTree,
  Mic,
  MicOff,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  FlattenedSymptomItem,
  severityLabel,
  severityTone,
  SymptomLogEntry,
  todayISODate,
} from '../data/symptomTree';
import {
  ChatMessage,
  ProposedChatEntry,
  sendSymptomChatMessage,
} from '../services/chatAssistant';
import { TRIGGER_TAGS } from '../data/symptomTree';

interface ConversationalLoggerProps {
  profile: 'female' | 'male';
  isOnline: boolean;
  flattenedSymptoms: FlattenedSymptomItem[];
  quickStarters: string[];
  todaysCount: number;
  streakCount: number;
  onCommitLog: (entry: SymptomLogEntry) => void;
  onDeleteLog: (id: string) => void;
  onUpdateCycleAnchor: (dateStr: string) => void;
  onOpenBodyTree: () => void;
  onOpenHistory: () => void;
}

const CHAT_STORAGE_KEY = 'fieldnotes_chat_thread_v1';

export const ConversationalLogger: React.FC<ConversationalLoggerProps> = ({
  profile,
  isOnline,
  flattenedSymptoms,
  quickStarters,
  todaysCount,
  streakCount,
  onCommitLog,
  onDeleteLog,
  onUpdateCycleAnchor,
  onOpenBodyTree,
  onOpenHistory,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-20);
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'welcome_msg',
        role: 'assistant',
        text: 'How are you feeling today? Tell me in your own words — like "throbbing behind my left eye 6/10 from poor sleep" — or tap a quick option below.',
        timestampISO: new Date().toISOString(),
        followUpChips: [
          'Symptom-free today',
          'Throbbing temple headache 6/10',
          'Lower back ache 4/10',
          ...(profile !== 'male' ? ['Period started today'] : []),
        ],
      },
    ];
  });

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  const buildEntryFromProposal = (
    prop: ProposedChatEntry,
    indexOffset: number
  ): SymptomLogEntry => {
    const id = `log_${Date.now()}_${indexOffset}`;
    const cat = (prop.category || 'Physical').slice(0, 40);
    const region = (prop.region || 'General').slice(0, 80);
    const subregion = (prop.subregion || region).slice(0, 80);
    const side = (prop.side || 'None').slice(0, 40);
    const symptom = (prop.symptom || 'Symptom').slice(0, 120);

    let path: string[] = [cat, region, subregion, symptom];
    if (prop.baseline || cat === 'Baseline') {
      path = ['Baseline', 'Symptom-free today'];
    } else if (prop.periodStart) {
      path = ['Cycle', 'Period started'];
    } else if (cat === 'Cycle') {
      path = ['Cycle', region, symptom];
    } else if (side !== 'None' && side !== '') {
      path = [cat, region, subregion, side, symptom];
    }

    const validTags = (prop.tags || [])
      .filter((t) =>
        (TRIGGER_TAGS as readonly string[]).some(
          (allowed) => allowed.toLowerCase() === t.toLowerCase()
        )
      )
      .slice(0, 12);

    return {
      id,
      dateISO: new Date().toISOString(),
      path,
      category: prop.baseline ? 'Baseline' : cat,
      region: prop.baseline ? 'Daily Check-in' : region,
      subregion: prop.baseline ? 'Baseline' : subregion,
      side,
      symptom: prop.baseline
        ? 'Symptom-free today'
        : prop.periodStart
          ? 'Period started'
          : symptom,
      severity:
        prop.baseline || prop.periodStart
          ? 0
          : Math.min(10, Math.max(1, Math.round(Number(prop.severity) || 5))),
      baseline: Boolean(prop.baseline),
      periodStart: Boolean(prop.periodStart),
      notes: String(prop.notes || '').slice(0, 1000),
      tags: validTags,
      synced: false,
    };
  };

  const handleSendText = async (rawText?: string) => {
    const textToSend = (rawText ?? input).trim();
    if (!textToSend || isSending) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestampISO: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!rawText) setInput('');
    setIsSending(true);

    try {
      const apiMessages = nextMessages.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const result = await sendSymptomChatMessage(
        apiMessages,
        profile,
        flattenedSymptoms,
        isOnline
      );

      const createdEntries: SymptomLogEntry[] = [];
      result.proposedEntries.forEach((prop, idx) => {
        const entry = buildEntryFromProposal(prop, idx);
        if (entry.periodStart) {
          onUpdateCycleAnchor(todayISODate(new Date()));
        }
        onCommitLog(entry);
        createdEntries.push(entry);
      });

      const assistantMsg: ChatMessage = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        text: result.reply,
        timestampISO: new Date().toISOString(),
        loggedEntries: createdEntries,
        followUpChips: result.followUpChips,
        isOfflineReply: result.usedOfflineFallback,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdateInlineEntry = (
    messageId: string,
    updatedEntry: SymptomLogEntry
  ) => {
    onCommitLog(updatedEntry);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.loggedEntries) return m;
        return {
          ...m,
          loggedEntries: m.loggedEntries.map((e) =>
            e.id === updatedEntry.id ? updatedEntry : e
          ),
        };
      })
    );
  };

  const handleUndoInlineEntry = (messageId: string, entryId: string) => {
    onDeleteLog(entryId);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.loggedEntries) return m;
        return {
          ...m,
          loggedEntries: m.loggedEntries.filter((e) => e.id !== entryId),
        };
      })
    );
  };

  const toggleVoiceDictation = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor || typeof SpeechRecognitionCtor !== 'function') {
      return;
    }

    const recognition = new (SpeechRecognitionCtor as new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    })();

    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const activeChips =
    messages[messages.length - 1]?.followUpChips?.length
      ? messages[messages.length - 1].followUpChips!
      : quickStarters;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] max-w-2xl mx-auto">
      {/* Quiet Sub-header status line */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between text-xs text-[#5B675F]">
        <div className="flex items-center gap-2 font-mono-num">
          <span>
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{streakCount}d streak</span>
          {todaysCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-[#2F5241] font-medium hover:underline"
              >
                {todaysCount} logged today
              </button>
            </>
          )}
        </div>

        {messages.length > 1 && (
          <button
            type="button"
            onClick={() => setMessages((prev) => [prev[0]])}
            className="text-xs text-[#5B675F] hover:text-[#17211B] flex items-center gap-1 py-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear chat</span>
          </button>
        )}
      </div>

      {/* Main Conversational Stream */}
      <div className="flex-1 px-4 py-4 space-y-5 overflow-y-auto">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm sm:text-[15px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#2F5241] text-white rounded-br-xs'
                  : 'bg-white border border-[#E3E7DF] text-[#17211B] rounded-bl-xs'
              }`}
            >
              <p>{msg.text}</p>
            </div>

            {/* Interactive Auto-Logged Receipt Cards */}
            {msg.loggedEntries && msg.loggedEntries.length > 0 && (
              <div className="w-full max-w-[92%] sm:max-w-[84%] mt-2.5 space-y-2.5">
                {msg.loggedEntries.map((entry) => {
                  const tone = severityTone(entry.severity);
                  return (
                    <div
                      key={entry.id}
                      className="rounded-2xl bg-white border border-[#2F5241]/35 p-4 space-y-3 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs text-[#2F5241] font-medium">
                            <Check className="w-3.5 h-3.5" />
                            <span>Logged</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#5B675F] font-normal">
                              {entry.category} › {entry.region}
                            </span>
                          </div>
                          <h3 className="font-display text-base font-semibold text-[#17211B] mt-0.5">
                            {entry.symptom}
                            {entry.side !== 'None' ? ` (${entry.side})` : ''}
                          </h3>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleUndoInlineEntry(msg.id, entry.id)
                          }
                          className="min-h-[36px] px-2.5 rounded-lg text-xs text-[#5B675F] hover:text-[#9E2A2B] hover:bg-[#F6F7F4] flex items-center gap-1 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Undo</span>
                        </button>
                      </div>

                      {!entry.baseline && !entry.periodStart && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#5B675F]">Severity</span>
                            <span
                              className={`font-mono-num font-semibold ${tone.text}`}
                            >
                              {entry.severity}/10 ·{' '}
                              {severityLabel(entry.severity)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={10}
                            value={entry.severity}
                            onChange={(e) =>
                              handleUpdateInlineEntry(msg.id, {
                                ...entry,
                                severity: Number(e.target.value),
                              })
                            }
                            className="severity-slider bg-[#E3E7DF]"
                          />
                        </div>
                      )}

                      {!entry.baseline && (
                        <div className="pt-1 flex flex-wrap gap-1.5">
                          {[
                            'Sleep',
                            'Stress',
                            'Food',
                            'Weather',
                            'Exercise',
                            'Hormonal',
                            'Medication',
                          ].map((tag) => {
                            const active = entry.tags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  const nextTags = active
                                    ? entry.tags.filter((t) => t !== tag)
                                    : [...entry.tags, tag];
                                  handleUpdateInlineEntry(msg.id, {
                                    ...entry,
                                    tags: nextTags,
                                  });
                                }}
                                className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                                  active
                                    ? 'bg-[#2F5241] text-white'
                                    : 'bg-[#F6F7F4] text-[#5B675F] hover:text-[#17211B]'
                                }`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {isSending && (
          <div className="text-xs text-[#5B675F] px-2 py-1">
            Logging entry...
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Sticky Bottom Options & Composer Bar */}
      <div className="sticky bottom-0 z-20 bg-[#F6F7F4]/95 backdrop-blur-md pt-2 pb-4 px-4 border-t border-[#E3E7DF] space-y-2.5">
        {/* Options & Quick Starters Strip */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={onOpenBodyTree}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#17211B] text-white text-xs font-medium flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Browse Body Tree</span>
          </button>

          {activeChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isSending}
              onClick={() => handleSendText(chip)}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-[#E3E7DF] hover:border-[#2F5241] text-xs font-medium text-[#17211B] transition-colors whitespace-nowrap shrink-0"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Single Clean Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendText();
          }}
          className="flex items-center gap-2 bg-white rounded-2xl border border-[#E3E7DF] p-1.5 shadow-xs"
        >
          <button
            type="button"
            onClick={toggleVoiceDictation}
            className={`min-h-[42px] min-w-[42px] rounded-xl flex items-center justify-center transition-colors shrink-0 ${
              isListening
                ? 'bg-[#9E2A2B] text-white'
                : 'text-[#5B675F] hover:text-[#17211B] hover:bg-[#F6F7F4]'
            }`}
            title="Dictate symptom by voice"
            aria-label="Dictate symptom by voice"
          >
            {isListening ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe how you feel (e.g. headache behind left eye 6/10)..."
            className="flex-1 min-h-[42px] px-2 text-sm text-[#17211B] placeholder:text-[#5B675F] focus:outline-none bg-transparent"
          />

          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className="min-h-[42px] px-4 rounded-xl bg-[#2F5241] text-white text-xs sm:text-sm font-medium flex items-center gap-1.5 hover:bg-[#244032] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Send</span>
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
