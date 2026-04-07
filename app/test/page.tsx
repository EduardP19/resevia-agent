'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

interface TestMessage {
  role: 'user' | 'assistant' | 'waiting';
  content?: string;
  sessionId?: string;
  id?: string;
}

const SESSION_WARNING_MS = 2 * 60 * 1000;
const SESSION_EXPIRY_MS = 3 * 60 * 1000;
const SESSION_WARNING_SECONDS = Math.ceil((SESSION_EXPIRY_MS - SESSION_WARNING_MS) / 1000);

export default function TestPage() {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('+447700216011');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [autoResumeEnabled, setAutoResumeEnabled] = useState(true);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const [secondsUntilExpiry, setSecondsUntilExpiry] = useState(SESSION_WARNING_SECONDS);
  const [sessionExpired, setSessionExpired] = useState(false);

  const isSyncingRef = useRef(false);
  const isExpiringRef = useRef(false);
  const lastSyncedAt = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const hadDraftRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const phoneRef = useRef(phone);
  const warningTimeoutRef = useRef<number | null>(null);
  const expiryTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  const clearExpiryTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      window.clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }

    if (expiryTimeoutRef.current) {
      window.clearTimeout(expiryTimeoutRef.current);
      expiryTimeoutRef.current = null;
    }

    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const closeSessionOnServer = useCallback(async (sid: string, from: string) => {
    try {
      const response = await fetch('/api/test/expire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          from,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to expire the test session.');
      }
    } catch (error) {
      console.error('[Test Session Expire Error]', error);
    }
  }, []);

  const resetLocalSession = useCallback(() => {
    const currentPhone = phoneRef.current;

    sessionStorage.removeItem(`resevia_session_${currentPhone}`);
    setSessionId(null);
    setMessages([]);
    setInput('');
    setLoading(false);
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(SESSION_WARNING_SECONDS);
    setSessionExpired(false);
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    hadDraftRef.current = false;
    isExpiringRef.current = false;
    clearExpiryTimers();
  }, [clearExpiryTimers]);

  const expireSessionLocally = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    const activePhone = phoneRef.current;

    if (!activeSessionId || isExpiringRef.current) {
      return;
    }

    isExpiringRef.current = true;
    clearExpiryTimers();
    setLoading(false);
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(0);
    setSessionExpired(true);
    setAutoResumeEnabled(false);
    setSessionId(null);
    sessionStorage.removeItem(`resevia_session_${activePhone}`);
    setMessages((currentMessages) => currentMessages.filter((message) => message.role !== 'waiting'));
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    hadDraftRef.current = false;

    await closeSessionOnServer(activeSessionId, activePhone);
    isExpiringRef.current = false;
  }, [clearExpiryTimers, closeSessionOnServer]);

  const noteSessionActivity = useCallback(() => {
    if (!sessionIdRef.current || sessionExpired) {
      return;
    }

    clearExpiryTimers();
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(SESSION_WARNING_SECONDS);

    warningTimeoutRef.current = window.setTimeout(() => {
      setShowExpiryWarning(true);
      setSecondsUntilExpiry(SESSION_WARNING_SECONDS);

      countdownIntervalRef.current = window.setInterval(() => {
        setSecondsUntilExpiry((current) => (current > 0 ? current - 1 : 0));
      }, 1000);
    }, SESSION_WARNING_MS);

    expiryTimeoutRef.current = window.setTimeout(() => {
      void expireSessionLocally();
    }, SESSION_EXPIRY_MS);
  }, [clearExpiryTimers, expireSessionLocally, sessionExpired]);

  const resetSession = useCallback(() => {
    const activeSessionId = sessionIdRef.current;
    const activePhone = phoneRef.current;

    if (activeSessionId) {
      void closeSessionOnServer(activeSessionId, activePhone);
    }

    setAutoResumeEnabled(false);
    resetLocalSession();
  }, [closeSessionOnServer, resetLocalSession]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    phoneRef.current = phone;
  }, [phone]);

  useEffect(() => {
    const savedPhone = localStorage.getItem('resevia_test_phone');
    const restoredPhone = savedPhone || '+447700216011';
    const savedSessionId = sessionStorage.getItem(`resevia_session_${restoredPhone}`);

    setPhone(restoredPhone);

    if (savedSessionId) {
      setSessionId(savedSessionId);
      setAutoResumeEnabled(false);
    }
  }, []);

  const findActiveSession = useCallback(async (currentPhone: string) => {
    if (!autoResumeEnabled || sessionIdRef.current) {
      return;
    }

    try {
      const response = await fetch(
        `/api/test/session?phone=${encodeURIComponent(currentPhone)}`,
        { cache: 'no-store' }
      );
      const data = (await response.json()) as { sessionId?: string | null };

      if (data.sessionId) {
        setSessionId(data.sessionId);
        sessionStorage.setItem(`resevia_session_${currentPhone}`, data.sessionId);
        setSessionExpired(false);
      }
    } catch (error) {
      console.error('[Test Session Resume Error]', error);
    }
  }, [autoResumeEnabled]);

  useEffect(() => {
    if (!phone) {
      return;
    }

    localStorage.setItem('resevia_test_phone', phone);
    void findActiveSession(phone);
  }, [findActiveSession, phone]);

  const handlePhoneChange = useCallback((nextPhone: string) => {
    const activeSessionId = sessionIdRef.current;
    const currentPhone = phoneRef.current;

    if (activeSessionId) {
      void closeSessionOnServer(activeSessionId, currentPhone);
    }

    resetLocalSession();
    setPhone(nextPhone);
    setAutoResumeEnabled(true);
  }, [closeSessionOnServer, resetLocalSession]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const syncTranscript = useCallback(async (sid: string) => {
    if (isSyncingRef.current || sessionExpired) {
      return;
    }

    isSyncingRef.current = true;

    try {
      const query = new URLSearchParams({
        sessionId: sid,
        t: String(Date.now()),
      });

      if (lastSyncedAt.current) {
        query.set('since', lastSyncedAt.current);
      }

      const response = await fetch(`/api/test/poll?${query.toString()}`, { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to sync transcript.');
      }

      const hadDraftBefore = hadDraftRef.current;
      const hasDraftNow = Boolean(data.hasDraft);

      if (hadDraftBefore && !hasDraftNow && lastSyncedAt.current) {
        lastSyncedAt.current = new Date(
          new Date(lastSyncedAt.current).getTime() - 5000
        ).toISOString();
      }

      hadDraftRef.current = hasDraftNow;

      const newPollMessages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        created_at: string;
      }> = data.messages || [];
      const unprocessed = newPollMessages.filter((message) => !seenIds.current.has(message.id));

      unprocessed.forEach((message) => seenIds.current.add(message.id));

      if (newPollMessages.length > 0) {
        lastSyncedAt.current = newPollMessages[newPollMessages.length - 1].created_at;
      }

      const sawServerActivity = unprocessed.length > 0 || hasDraftNow !== hadDraftBefore;
      if (sawServerActivity) {
        noteSessionActivity();
      }

      setMessages((currentMessages) => {
        let nextMessages = [...currentMessages];
        let changed = false;

        for (const message of unprocessed) {
          changed = true;

          if (message.role === 'assistant') {
            const waitingIndex = nextMessages.findIndex((entry) => entry.role === 'waiting');
            const localAssistantIndex = nextMessages.findIndex(
              (entry) =>
                entry.role === 'assistant' &&
                entry.content === message.content &&
                (!entry.id || entry.id.startsWith('local-assistant-'))
            );

            if (waitingIndex !== -1) {
              nextMessages[waitingIndex] = {
                role: 'assistant',
                content: message.content,
                id: message.id,
              };
            } else if (localAssistantIndex !== -1) {
              nextMessages[localAssistantIndex] = {
                role: 'assistant',
                content: message.content,
                id: message.id,
              };
            } else {
              nextMessages.push({
                role: 'assistant',
                content: message.content,
                id: message.id,
              });
            }
          }

          if (message.role === 'user') {
            const localMatchIndex = nextMessages.findIndex(
              (entry) =>
                entry.role === 'user' &&
                entry.content === message.content &&
                (!entry.id || entry.id.startsWith('local-user-'))
            );

            if (localMatchIndex !== -1) {
              nextMessages[localMatchIndex] = {
                role: 'user',
                content: message.content,
                id: message.id,
              };
            } else {
              nextMessages.push({
                role: 'user',
                content: message.content,
                id: message.id,
              });
            }
          }
        }

        const justGotAssistant = unprocessed.some((message) => message.role === 'assistant');
        const currentlyHasWaiting = nextMessages.some((message) => message.role === 'waiting');

        if (data.hasDraft && !currentlyHasWaiting && !justGotAssistant) {
          nextMessages.push({ role: 'waiting', sessionId: sid });
          changed = true;
        } else if (!data.hasDraft && currentlyHasWaiting) {
          nextMessages = nextMessages.filter((message) => message.role !== 'waiting');
          changed = true;
        }

        return changed ? nextMessages : currentMessages;
      });
    } catch (error) {
      console.error('[Test Poll Error]', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [noteSessionActivity, sessionExpired]);

  const hasWaiting = messages.some((message) => message.role === 'waiting');

  useEffect(() => {
    if (!sessionId || sessionExpired) {
      clearExpiryTimers();
      return;
    }

    noteSessionActivity();
    void syncTranscript(sessionId);

    const interval = window.setInterval(() => {
      void syncTranscript(sessionId);
    }, hasWaiting ? 1500 : 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [clearExpiryTimers, hasWaiting, noteSessionActivity, sessionExpired, sessionId, syncTranscript]);

  useEffect(() => () => clearExpiryTimers(), [clearExpiryTimers]);

  const sendMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!input.trim() || loading || sessionExpired) {
      return;
    }

    const text = input.trim();
    const localUserId = `local-user-${Date.now()}`;

    setMessages((currentMessages) => [
      ...currentMessages,
      { role: 'user', content: text, id: localUserId },
    ]);
    setInput('');
    setLoading(true);
    setSessionExpired(false);
    noteSessionActivity();

    try {
      const response = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          from: phoneRef.current,
          id: sessionIdRef.current,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to send the message.');
      }

      const resolvedSessionId = data.sessionId || sessionIdRef.current || null;

      if (resolvedSessionId && resolvedSessionId !== sessionIdRef.current) {
        setSessionId(resolvedSessionId);
        sessionStorage.setItem(`resevia_session_${phoneRef.current}`, resolvedSessionId);
        lastSyncedAt.current = null;
        seenIds.current = new Set();
        hadDraftRef.current = false;
        setAutoResumeEnabled(false);
      }

      if (resolvedSessionId) {
        noteSessionActivity();
      }

      if (data.draft) {
        setMessages((currentMessages) => {
          if (currentMessages.some((message) => message.role === 'waiting')) {
            return currentMessages;
          }

          return [
            ...currentMessages,
            { role: 'waiting', sessionId: resolvedSessionId || undefined },
          ];
        });
      } else if (data.reply) {
        const localAssistantId = `local-assistant-${Date.now()}`;

        setMessages((currentMessages) => {
          const waitingIndex = currentMessages.findIndex((message) => message.role === 'waiting');

          if (waitingIndex !== -1) {
            const nextMessages = [...currentMessages];
            nextMessages[waitingIndex] = {
              role: 'assistant',
              content: data.reply,
              id: localAssistantId,
            };
            return nextMessages;
          }

          return [
            ...currentMessages,
            { role: 'assistant', content: data.reply, id: localAssistantId },
          ];
        });
      }
    } catch (error) {
      console.error('[Test Send Error]', error);
    } finally {
      setLoading(false);
    }
  }, [input, loading, noteSessionActivity, sessionExpired]);

  const bannerTone = sessionExpired
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : showExpiryWarning
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : '';
  const inputDisabled = loading || sessionExpired;

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col h-[calc(100dvh-6.5rem)] min-h-[560px] sm:h-[750px]">
        <div className="p-6 bg-brand-purple text-white">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-xl font-bold italic tracking-tight">Resevia Agent Test</h1>
              <p className="text-[10px] uppercase font-black tracking-widest opacity-80 mt-1">
                Customer Simulation
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => sessionId && void syncTranscript(sessionId)}
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
            <label className="text-[10px] uppercase font-black tracking-widest opacity-60">
              Simulated Client Phone
            </label>
            <input
              type="text"
              value={phone}
              onChange={(event) => handlePhoneChange(event.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm outline-none focus:bg-white/20 transition-all font-mono"
              placeholder="+44..."
            />
          </div>

          {sessionId ? (
            <p className="text-[9px] opacity-40 font-mono tracking-tight flex items-center gap-1.5 mt-3">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Session: {sessionId.substring(0, 8)}...
            </p>
          ) : null}
        </div>

        {showExpiryWarning || sessionExpired ? (
          <div className={`border-b px-4 py-3 text-sm ${bannerTone}`}>
            {sessionExpired
              ? 'This test session expired after 3 minutes of inactivity. Reset to start a new one.'
              : `This session will expire in ${secondsUntilExpiry}s unless there is new activity.`}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-gray-400 italic text-sm text-center px-8">
              Send a message to start, or enter a phone number to resume a session.
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={message.id || index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'waiting' ? (
                  <div className="flex items-center space-x-1.5 px-4 py-3 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : (
                  <div
                    className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'bg-brand-purple text-white rounded-tr-none shadow-indigo-100 shadow-lg'
                        : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-md'
                    }`}
                  >
                    {message.content}
                  </div>
                )}
              </div>
            ))
          )}

          {loading ? (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 px-4 py-2 rounded-2xl animate-pulse text-xs text-gray-400 italic">
                Thinking...
              </div>
            </div>
          ) : null}

          <div ref={scrollRef} />
        </div>

        <form onSubmit={sendMessage} className="p-4 border-t border-gray-100 bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                sessionExpired
                  ? 'Reset the session to continue testing.'
                  : 'Type your message...'
              }
              disabled={inputDisabled}
              className="flex-1 bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-brand-purple/20 outline-none text-black disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={inputDisabled || !input.trim()}
              className="bg-brand-purple text-white px-6 rounded-2xl font-bold disabled:opacity-50 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              Send
            </button>
          </div>
        </form>
      </div>

      <p className="mt-6 text-[10px] text-gray-400 uppercase font-black tracking-widest text-center">
        Customer Simulation • Bypasses Twilio
      </p>
    </div>
  );
}
