'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TestMessage {
  role: 'user' | 'assistant' | 'waiting';
  content?: string;
  sessionId?: string;
  id?: string; // transcript DB id — used to dedup
}

export default function TestPage() {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [phone] = useState('+447700216011');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  // lastSyncedAt initialized to NOW: polls only pick up messages created after page load
  const lastSyncedAt = useRef<string>(new Date().toISOString());
  // Track DB IDs we've already rendered to deduplicate
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Continuous transcript sync ───────────────────────────────────────────
  // Polls every 3s whenever there's a sessionId. Picks up:
  //   - Approved drafts from dashboard
  //   - Manual messages sent by owner from dashboard
  //   - Any assistant message regardless of how it arrived
  const syncTranscript = useCallback(async (sid: string) => {
    try {
      const url = `/api/test/poll?sessionId=${sid}${lastSyncedAt.current ? `&since=${encodeURIComponent(lastSyncedAt.current)}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      const newMsgs: any[] = data.messages || [];
      if (!newMsgs.length) return;

      // Update our last-synced timestamp
      lastSyncedAt.current = newMsgs[newMsgs.length - 1].created_at;

      // Filter to only messages we haven't rendered yet
      const unseen = newMsgs.filter(m => !seenIds.current.has(m.id));
      if (!unseen.length) return;

      unseen.forEach(m => seenIds.current.add(m.id));

      setMessages(prev => {
        let updated = [...prev];
        for (const m of unseen) {
          if (m.role === 'assistant') {
            // Replace the waiting bubble if present, otherwise append
            const waitingIdx = updated.findIndex(x => x.role === 'waiting');
            if (waitingIdx !== -1) {
              updated[waitingIdx] = { role: 'assistant', content: m.content, id: m.id };
            } else {
              updated.push({ role: 'assistant', content: m.content, id: m.id });
            }
          }
          // user messages sent from /test are added locally already — skip to avoid duplication
          // (they don't have an id set at local-add time, so seenIds won't catch them)
        }
        return updated;
      });
    } catch {/* silent */}
  }, []);

  // Start/stop polling when sessionId changes
  useEffect(() => {
    if (!sessionId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => syncTranscript(sessionId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId, syncTranscript]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, from: phone, id: sessionId })
      });
      const data = await res.json();

      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      if (data.draft) {
        // Approval mode — neutral waiting dots until dashboard approves
        setMessages(prev => [...prev, { role: 'waiting', sessionId: data.sessionId }]);
      } else if (data.reply) {
        // Non-approval mode — show reply immediately
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const hasWaiting = messages.some(m => m.role === 'waiting');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col h-[700px]">
        <div className="p-6 bg-brand-purple text-white">
          <h1 className="text-xl font-bold italic tracking-tight">Resevia Agent Test</h1>
          <p className="text-[10px] uppercase font-black tracking-widest opacity-80 mt-1">Simulated Client: {phone}</p>
          {sessionId && (
            <p className="text-[9px] opacity-40 mt-0.5 font-mono tracking-tight">
              {sessionId} {pollRef.current ? '· syncing' : ''}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-gray-400 italic text-sm">
              Start chatting with Sophia...
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id || i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'waiting' ? (
                <div className="flex items-center space-x-1.5 px-4 py-3 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              ) : (
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-brand-purple text-white rounded-tr-none shadow-indigo-100 shadow-lg'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-md'
                }`}>
                  {m.content}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 px-4 py-2 rounded-2xl animate-pulse text-xs text-gray-400 italic">
                Sophia is typing...
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <form onSubmit={sendMessage} className="p-4 border-t border-gray-100 bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-brand-purple/20 outline-none text-black"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-brand-purple text-white px-6 rounded-2xl font-bold disabled:opacity-50 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              Send
            </button>
          </div>
        </form>
      </div>

      {/* Owner-only tip — outside the simulated client frame */}
      {hasWaiting ? (
        <a
          href={`/dashboard/sessions/${(messages.find(m => m.role === 'waiting') as any)?.sessionId || sessionId}`}
          target="_blank"
          className="mt-4 inline-flex items-center space-x-2 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Sophia drafted a reply — Review &amp; Approve in Dashboard →</span>
        </a>
      ) : (
        <p className="mt-6 text-[10px] text-gray-400 uppercase font-black tracking-widest text-center">
          This is a standalone testing harness bypassing twilio
        </p>
      )}
    </div>
  );
}
