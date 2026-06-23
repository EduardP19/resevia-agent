'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';
import { getAgentName, getAgentPossessiveName } from '@/lib/agent-name';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

function formatMessageTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Time unavailable';
  }

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatInterface({
  sessionId,
  initialTranscript,
  clientPhone,
  sessionStatus,
  agentName: rawAgentName,
}: {
  sessionId: string;
  initialTranscript: Message[];
  clientPhone: string;
  sessionStatus: string;
  agentName?: string | null;
}) {
  const agentName = getAgentName({ agent_name: rawAgentName });
  const agentPossessiveName = getAgentPossessiveName(agentName);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
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
  const lastApprovedDraftIdRef = useRef<string | null>(null);

  useEffect(() => { isSendingRef.current = isSending; }, [isSending]);
  const hasDraftRef = useRef(initialTranscript.some(m => m.role === 'draft'));

  const latestDraft = [...transcript].reverse().find(m => m.role === 'draft');
  hasDraftRef.current = !!latestDraft;
  const isArchived = currentStatus !== 'active' && currentStatus !== 'needs_approval';
  const isReview = !isArchived && (currentStatus === 'needs_approval' || !!latestDraft);
  const visibleTranscript = useMemo(
    () =>
      transcript
        .filter(msg => msg.role !== 'system')
        .filter(msg => !(isArchived && msg.role === 'draft'))
        .filter((msg, index, messages) => {
          const previous = messages[index - 1];
          if (!previous || previous.role !== msg.role || previous.content.trim() !== msg.content.trim()) {
            return true;
          }

          const previousTime = new Date(previous.created_at).getTime();
          const currentTime = new Date(msg.created_at).getTime();
          return Number.isNaN(previousTime) || Number.isNaN(currentTime) || currentTime - previousTime > 30_000;
        }),
    [transcript]
  );
  const latestVisibleMessage = visibleTranscript[visibleTranscript.length - 1];
  const showAgentPending = !isArchived && !isReview && !isSending && latestVisibleMessage?.role === 'user';

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
    const pid = setInterval(() => {
      if (document.visibilityState !== 'hidden') syncTranscript();
    }, 8000);
    return () => clearInterval(pid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    // Keep the composer empty after approving/sending a draft.
    // Only auto-fill when a genuinely new draft appears.
    if (!latestDraft) return;
    if (latestDraft.id === lastApprovedDraftIdRef.current) return;
    if (input.trim().length > 0) return;
    setInput(latestDraft.content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDraft?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleTranscript, showAgentPending]);

  useEffect(() => {
    (window as any).__focusApprovalInput = () => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const messageMode = latestDraft ? 'approve' : 'manual';
    trackClientEvent({
      event: 'button_clicked',
      category: 'dashboard',
      action: 'send_message',
      session_id: sessionId,
      mode: messageMode,
      text_length: input.length,
    });
    const sentContent = input;
    if (latestDraft?.id) {
      lastApprovedDraftIdRef.current = latestDraft.id;
    }
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
    setIsSending(true);
    try {
      const res = await fetch('/api/dashboard/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: sentContent, mode: messageMode }),
      });
      if (res.ok) {
        trackClientEvent({ event: 'message_sent_from_dashboard', category: 'dashboard', session_id: sessionId, mode: messageMode });
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        const details = data?.code ? `Twilio error ${data.code}: ${data.error}` : data?.error;
        setTranscript(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setInput(sentContent);
        trackClientEvent({
          event: 'message_send_failed',
          category: 'dashboard',
          level: 'warn',
          session_id: sessionId,
          mode: messageMode,
          error: details || 'Failed to send message',
        });
        alert(details || 'Failed to send message');
      }
    } catch (error: any) {
      setTranscript(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setInput(sentContent);
      trackClientEvent({
        event: 'message_send_failed',
        category: 'dashboard',
        level: 'error',
        session_id: sessionId,
        mode: messageMode,
        error: error?.message || 'Error sending message',
      });
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
    assistant: agentName,
    draft: `${agentPossessiveName} Draft`,
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
          className="px-4 py-3 flex items-center gap-2 flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}
        >
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest text-amber-700">
            Awaiting Approval — {agentName} has NOT sent this yet
          </span>
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin" style={{ background: '#faf8fd' }}>
        {visibleTranscript.map((msg) => {
          const isUser = msg.role === 'user';
          const isDraft = msg.role === 'draft';
          const isSystem = msg.role === 'system';
          const timestamp = formatMessageTimestamp(msg.created_at);

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
                  <span>{roleLabel[msg.role] || msg.role}</span>
                  <span suppressHydrationWarning className="font-mono font-semibold normal-case tracking-normal text-gray-300">
                    {' '}· {timestamp}
                  </span>
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
                </div>
              </div>
            </div>
          );
        })}
        {showAgentPending && (
          <div className="flex justify-start">
            <div className="max-w-[78%]">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-left text-gray-400">
                {agentName}
              </div>
              <div
                className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={{
                  background: 'white',
                  border: '1px solid rgba(109,40,217,0.08)',
                  color: '#6B7280',
                  borderTopLeftRadius: '4px',
                  boxShadow: '0 2px 8px rgba(109,40,217,0.06)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">Thinking</span>
                  <span className="flex items-center gap-1" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#6D28D9] animate-bounce [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#6D28D9] animate-bounce [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#6D28D9] animate-bounce" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
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
            This session has been ended.
          </p>
        </div>
      ) : (
        <div
          className="p-4 space-y-3 flex-shrink-0"
          style={{ background: 'white', borderTop: '1px solid rgba(109,40,217,0.07)' }}
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {isReview && latestDraft ? `${agentPossessiveName} Draft` : 'Send Message'}
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
                latestDraft
                  ? `Edit ${agentPossessiveName} draft, or send as-is…`
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
                  <span>{latestDraft ? 'Approve & Send' : 'Send'}</span>
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
