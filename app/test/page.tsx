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
  const [phone, setPhone] = useState('+447700216011');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  
  // Ref for polling management to avoid useEffect loops
  const isSyncingRef = useRef(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedAt = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset session locally
  const resetSession = useCallback(() => {
    setSessionId(null);
    setSessionStatus(null);
    sessionStorage.removeItem(`resevia_session_${phone}`);
    setMessages([]);
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    if (pollRef.current) clearInterval(pollRef.current);
  }, [phone]);

  // Restore from storage on mount
  useEffect(() => {
    const savedPhone = localStorage.getItem('resevia_test_phone');
    if (savedPhone) {
      setPhone(savedPhone);
      const savedSid = sessionStorage.getItem(`resevia_session_${savedPhone}`);
      if (savedSid) setSessionId(savedSid);
    }
  }, []);

  const findActiveSession = useCallback(async (p: string) => {
    if (sessionId) return;
    try {
      const res = await fetch(`/api/test/session?phone=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        setSessionStatus(data.status);
        sessionStorage.setItem(`resevia_session_${p}`, data.sessionId);
      }
    } catch {/* silent */}
  }, [sessionId]);

  useEffect(() => {
    if (phone) {
      localStorage.setItem('resevia_test_phone', phone);
      findActiveSession(phone);
    }
  }, [phone, findActiveSession]);

  const handlePhoneChange = (newPhone: string) => {
    setPhone(newPhone);
    resetSession();
  };

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── 🔄 Continuous Sync Logic ──────────────────────────────────────────────
  const syncTranscript = useCallback(async (sid: string) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const url = `/api/test/poll?sessionId=${sid}${lastSyncedAt.current ? `&since=${encodeURIComponent(lastSyncedAt.current)}` : ''}&t=${Date.now()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status) setSessionStatus(data.status);
      
      const newPollMsgs: any[] = data.messages || [];
      const hasNewMessages = newPollMsgs.length > 0;
      if (hasNewMessages) {
        lastSyncedAt.current = newPollMsgs[newPollMsgs.length - 1].created_at;
      }

      setMessages(prev => {
        let updated = [...prev];
        let changed = false;

        if (hasNewMessages) {
          for (const m of newPollMsgs) {
            if (seenIds.current.has(m.id)) continue;
            seenIds.current.add(m.id);
            changed = true;

            if (m.role === 'assistant') {
              // Replace ONE waiting bubble if present
              const waitingIdx = updated.findIndex(x => x.role === 'waiting');
              if (waitingIdx !== -1) {
                updated[waitingIdx] = { role: 'assistant', content: m.content, id: m.id };
              } else {
                updated.push({ role: 'assistant', content: m.content, id: m.id });
              }
            } else if (m.role === 'user') {
              // Deduplicate: find local version and update ID
              const localMatchIdx = updated.findIndex(x => x.role === 'user' && x.content === m.content && x.id?.startsWith('local-'));
              if (localMatchIdx !== -1) {
                updated[localMatchIdx] = { ...updated[localMatchIdx], id: m.id };
              } else {
                updated.push({ role: 'user', content: m.content, id: m.id });
              }
            }
          }
        }

        // Handle waiting bubble based on hasDraft
        const currentlyHasWaiting = updated.some(m => m.role === 'waiting');
        if (data.hasDraft && !currentlyHasWaiting) {
          updated.push({ role: 'waiting', sessionId: sid });
          changed = true;
        } else if (!data.hasDraft && currentlyHasWaiting) {
          // Only remove waiting bubble if we just received a new assistant message effectively
          // (The assistant message logic above already handles the replacement, so this is for drafts deleted without approval)
          updated = updated.filter(m => m.role !== 'waiting');
          changed = true;
        }

        return changed ? updated : prev;
      });
    } catch {/* silent */} finally {
      isSyncingRef.current = false;
    }
  }, []); // Ref dependency means this stays stable

  // Centralized Poll Timer
  useEffect(() => {
    if (!sessionId) return;
    
    // Initial fetch
    syncTranscript(sessionId);
    
    // Dynamic heartbeat
    const interval = messages.some(m => m.role === 'waiting') ? 1500 : 3000;
    const pid = setInterval(() => syncTranscript(sessionId), interval);
    
    return () => clearInterval(pid);
  }, [sessionId, syncTranscript, messages.some(m => m.role === 'waiting')]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const tempId = `local-${Date.now()}`;
    setMessages(prev => [...prev, { role: 'user', content: input, id: tempId }]);
    
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, from: phone, id: sessionId })
      });
      const data = await res.json();

      if (data.sessionId && data.sessionId !== sessionId) {
        console.log(`[Test] Switching session: ${sessionId} -> ${data.sessionId}`);
        setSessionId(data.sessionId);
        setSessionStatus(data.status || 'active');
        sessionStorage.setItem(`resevia_session_${phone}`, data.sessionId);
        // Clear history for the new session
        setMessages([{ role: 'user', content: input }]); // Keep the current user message as first
        lastSyncedAt.current = null;
        seenIds.current = new Set();
      }

      if (data.draft) {
        setMessages(prev => {
          if (prev.some(m => m.role === 'waiting')) return prev;
          return [...prev, { role: 'waiting', sessionId: data.sessionId }];
        });
      } else if (data.reply) {
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
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col h-[750px]">
        <div className="p-6 bg-brand-purple text-white relative">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-xl font-bold italic tracking-tight">Resevia Agent Test</h1>
              <p className="text-[10px] uppercase font-black tracking-widest opacity-80 mt-1">Live Simulation</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => sessionId && syncTranscript(sessionId)}
                className="text-[9px] font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors border border-white/10"
                title="Force Sync"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button 
                onClick={resetSession}
                className="text-[9px] font-black uppercase tracking-widest bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black tracking-widest opacity-60">Simulated Client Phone</label>
            <input 
              type="text" 
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm outline-none focus:bg-white/20 transition-all font-mono"
              placeholder="+44..."
            />
          </div>

          {sessionId && (
            <div className="flex items-center justify-between mt-3">
              <p className="text-[9px] opacity-40 font-mono tracking-tight flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Connected: {sessionId.substring(0,8)}...
              </p>
              {sessionStatus && (
                <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shadow-sm ${
                  sessionStatus === 'review' 
                    ? 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse' 
                    : sessionStatus === 'handed_over'
                    ? 'bg-rose-100 text-rose-700 border-rose-200'
                    : sessionStatus === 'completed'
                    ? 'bg-gray-100 text-gray-500 border-gray-200'
                    : 'bg-white/10 text-white border-white/5 opacity-80'
                }`}>
                   {sessionStatus === 'review' ? 'Approval Needed' : sessionStatus === 'handed_over' ? 'Escalated' : sessionStatus.replace('_', ' ')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-gray-400 italic text-sm text-center px-8">
              Send a message to start or enter a phone number to resume.
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
                Thinking...
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
      
      {hasWaiting ? (
        <a 
          href={`/dashboard/sessions/${(messages.find(m => m.role === 'waiting') as any)?.sessionId || sessionId}`}
          target="_blank"
          className="mt-4 inline-flex items-center space-x-2 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100 transition-colors shadow-sm"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Review & ApproveSophia's Draft →</span>
        </a>
      ) : (
        <p className="mt-6 text-[10px] text-gray-400 uppercase font-black tracking-widest text-center">
          Unified Testing Harness • Bypasses Twilio
        </p>
      )}
    </div>
  );
}
