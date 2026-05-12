'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export default function ChatInterface({
  sessionId,
  initialTranscript,
  clientPhone,
  sessionStatus,
}: {
  sessionId: string;
  initialTranscript: Message[];
  clientPhone: string;
  sessionStatus: string;
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendMode, setSendMode] = useState<'approve' | 'manual'>('approve');
  const [currentStatus, setCurrentStatus] = useState(sessionStatus);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const autoGrow = (el: HTMLTextAreaElement) => {
    const maxHeight = 160;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  const isSyncingRef = useRef(false);
  const lastSyncedAt = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set(initialTranscript.map(m => m.id)));
  const isSendingRef = useRef(false);

  useEffect(() => { isSendingRef.current = isSending; }, [isSending]);
  const hasDraftRef = useRef(initialTranscript.some(m => m.role === 'draft'));

  const latestDraft = [...transcript].reverse().find(m => m.role === 'draft');
  hasDraftRef.current = !!latestDraft;
  const isArchived = currentStatus !== 'active' && currentStatus !== 'review';
  const isReview = !isArchived && (currentStatus === 'review' || !!latestDraft);

  useEffect(() => {
    setTranscript(initialTranscript);
    setCurrentStatus(sessionStatus);
    seenIds.current = new Set(initialTranscript.map(m => m.id));
    lastSyncedAt.current = initialTranscript.length > 0
      ? initialTranscript[initialTranscript.length - 1].created_at
      : null;
    hasDraftRef.current = initialTranscript.some(m => m.role === 'draft');
  }, [initialTranscript, sessionStatus]);

  const syncTranscript = useCallback(async () => {
    if (isSyncingRef.current || isSendingRef.current) return;
    isSyncingRef.current = true;
    try {
      const since = lastSyncedAt.current;
      const url = `/api/test/poll?sessionId=${sessionId}${since ? `&since=${encodeURIComponent(since)}` : ''}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();

      if (data.status) setCurrentStatus(data.status);

      const newMsgs: Message[] = data.messages || [];
      const unprocessed = newMsgs.filter(m => !seenIds.current.has(m.id));
      unprocessed.forEach(m => seenIds.current.add(m.id));

      if (newMsgs.length > 0) {
        lastSyncedAt.current = newMsgs[newMsgs.length - 1].created_at;
      }

      if (unprocessed.length > 0) {
        setTranscript(prev => {
          const updated = [...prev];
          for (const m of unprocessed) {
            const optimisticIdx = updated.findIndex(
              x => x.id.startsWith('optimistic-') && x.role === m.role && x.content === m.content
            );
            if (optimisticIdx !== -1) {
              updated[optimisticIdx] = m;
            } else {
              updated.push(m);
            }
          }
          return updated;
        });
      }

      if (data.hasDraft && !hasDraftRef.current) {
        router.refresh();
      }
      if (!data.hasDraft && hasDraftRef.current) {
        setTranscript(prev => prev.filter(m => m.role !== 'draft'));
        hasDraftRef.current = false;
      }
    } catch {/* silent */} finally {
      isSyncingRef.current = false;
    }
  }, [sessionId, router]);

  useEffect(() => {
    if (initialTranscript.length > 0) {
      lastSyncedAt.current = initialTranscript[initialTranscript.length - 1].created_at;
    }
    void syncTranscript();
    const pid = setInterval(syncTranscript, 3000);
    return () => clearInterval(pid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (latestDraft && sendMode === 'approve') {
      setInput(latestDraft.content);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDraft?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  useEffect(() => {
    (window as any).__focusApprovalInput = () => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }, []);

  const switchToManual = () => { setSendMode('manual'); setInput(''); setTimeout(() => textareaRef.current?.focus(), 50); };
  const switchToApprove = () => { setSendMode('approve'); setInput(latestDraft?.content || ''); setTimeout(() => textareaRef.current?.focus(), 50); };

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const sentContent = input;
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      role: 'assistant',
      content: sentContent,
      created_at: new Date().toISOString(),
    };
    seenIds.current.add(optimisticMsg.id);
    setTranscript(prev => [...prev.filter(m => m.role !== 'draft'), optimisticMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSendMode('approve');
    setIsSending(true);
    try {
      const res = await fetch('/api/dashboard/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: sentContent, mode: sendMode }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        const details = data?.code ? `Twilio error ${data.code}: ${data.error}` : data?.error;
        setTranscript(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setInput(sentContent);
        alert(details || 'Failed to send message');
      }
    } catch (error: any) {
      setTranscript(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setInput(sentContent);
      alert(error?.message || 'Error sending message');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
  };

  const roleLabel: Record<string, string> = {
    user: 'Client',
    assistant: 'Sophia',
    draft: "Sophia's Draft",
    system: 'System',
  };

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden flex flex-col scrollbar-thin"
      style={{
        boxShadow: '0 4px 32px rgba(109,40,217,0.1)',
        border: '1px solid rgba(109,40,217,0.1)',
        height: 'calc(100dvh - 200px)',
        minHeight: '400px',
      }}
    >
      {/* Approval banner */}
      {isReview && !isArchived && (
        <div
          className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-amber-700">
              Awaiting Approval — Sophia has NOT sent this yet
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={switchToApprove}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={sendMode === 'approve'
                ? { background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', color: 'white' }
                : { background: 'white', border: '1px solid #e5e7eb', color: '#4B5563' }
              }
            >
              Use Sophia's Draft
            </button>
            <button
              onClick={switchToManual}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={sendMode === 'manual'
                ? { background: '#1F2937', color: 'white' }
                : { background: 'white', border: '1px solid #e5e7eb', color: '#4B5563' }
              }
            >
              Write My Own
            </button>
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin" style={{ background: '#faf8fd' }}>
        {transcript.filter(msg => msg.role !== 'system').map((msg) => {
          const isUser = msg.role === 'user';
          const isDraft = msg.role === 'draft';
          const isSystem = msg.role === 'system';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div
                  className="text-[10px] font-mono px-3 py-1.5 rounded-lg italic max-w-[90%] text-center"
                  style={{ background: 'rgba(201,169,110,0.1)', color: '#92400E', border: '1px solid rgba(201,169,110,0.2)' }}
                >
                  {msg.content.replace(/^Tool \([^)]+\): /, '[Tool] ')}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] ${isDraft ? 'w-full max-w-[92%]' : ''}`}>
                <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${isUser ? 'text-right' : 'text-left'} text-gray-400`}>
                  {roleLabel[msg.role] || msg.role}
                </div>
                <div
                  className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={
                    isUser
                      ? {
                          background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)',
                          color: 'white',
                          borderTopRightRadius: '4px',
                          boxShadow: '0 4px 16px rgba(109,40,217,0.25)',
                        }
                      : isDraft
                      ? {
                          background: 'rgba(245,158,11,0.07)',
                          border: '2px dashed rgba(245,158,11,0.4)',
                          color: '#92400E',
                          borderTopLeftRadius: '4px',
                        }
                      : {
                          background: 'white',
                          border: '1px solid rgba(109,40,217,0.08)',
                          color: '#374151',
                          borderTopLeftRadius: '4px',
                          boxShadow: '0 2px 8px rgba(109,40,217,0.06)',
                        }
                  }
                >
                  {isDraft && (
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1">
                      <span>⏳</span>
                      <span>Awaiting approval before sending</span>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <div className={`text-[10px] mt-2 opacity-40 ${isUser ? 'text-right' : 'text-left'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Action bar */}
      {isArchived ? (
        <div
          className="p-4 flex items-center gap-3 flex-shrink-0"
          style={{ background: '#faf8fd', borderTop: '1px solid rgba(109,40,217,0.07)' }}
        >
          <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Session archived — no further messages can be sent
          </p>
        </div>
      ) : (
        <div
          className="p-4 space-y-3 flex-shrink-0"
          style={{ background: 'white', borderTop: '1px solid rgba(109,40,217,0.07)' }}
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {sendMode === 'manual' ? 'Manual Override' : isReview ? "Sophia's Draft" : 'Send Message'}
            </span>
            <span className="text-[10px] text-gray-300 font-mono hidden sm:block">⌘+Enter to send</span>
          </div>
          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder={
                sendMode === 'manual'
                  ? 'Type your own message…'
                  : latestDraft
                  ? "Edit Sophia's draft, or send as-is…"
                  : 'Type a message to the client…'
              }
              className="flex-1 rounded-xl px-4 py-3 text-sm resize-none transition-all outline-none text-gray-900 scrollbar-thin"
              style={{
                background: '#faf8fd',
                border: '1px solid rgba(109,40,217,0.12)',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#6D28D9'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(109,40,217,0.08)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(109,40,217,0.12)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <button
              onClick={handleSend}
              disabled={isSending || !input.trim()}
              className="flex items-center gap-2 px-4 py-3 sm:px-5 rounded-xl text-sm font-bold text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 flex-shrink-0 min-h-[48px]"
              style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
            >
              {isSending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>{sendMode === 'approve' && latestDraft ? 'Approve & Send' : 'Send'}</span>
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
