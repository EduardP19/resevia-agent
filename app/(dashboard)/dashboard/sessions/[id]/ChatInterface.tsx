'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Find the latest draft
  const latestDraft = [...transcript].reverse().find(m => m.role === 'draft');
  const isArchived = sessionStatus !== 'active' && sessionStatus !== 'review';
  const isReview = !isArchived && (sessionStatus === 'review' || !!latestDraft);

  // Pre-fill textarea with draft on load
  useEffect(() => {
    if (latestDraft && sendMode === 'approve') {
      setInput(latestDraft.content);
    }
  }, [latestDraft?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Expose focus method for parent
  useEffect(() => {
    (window as any).__focusApprovalInput = () => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }, []);

  const switchToManual = () => {
    setSendMode('manual');
    setInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const switchToApprove = () => {
    setSendMode('approve');
    setInput(latestDraft?.content || '');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    setIsSending(true);

    try {
      const res = await fetch('/api/dashboard/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: input }),
      });

      if (res.ok) {
        setInput('');
        setSendMode('approve');
        router.refresh();
      } else {
        alert('Failed to send message');
      }
    } catch (err) {
      console.error(err);
      alert('Error sending message');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  const roleLabel: Record<string, string> = {
    user: 'Client',
    assistant: 'Sophia',
    draft: "Sophia's Draft",
    system: 'System',
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col" style={{ height: '620px' }}>
      
      {/* Approval Banner — only for live sessions with a pending draft */}
      {isReview && !isArchived && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-amber-700">
              Awaiting Your Approval — Sophia has NOT sent this yet
            </span>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={switchToApprove}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${sendMode === 'approve' ? 'bg-brand-purple text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-purple hover:text-brand-purple'}`}
            >
              Use Sophia's Draft
            </button>
            <button
              onClick={switchToManual}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${sendMode === 'manual' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-900 hover:text-gray-900'}`}
            >
              Write My Own
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Transcript */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/30">
        {transcript.map((msg) => {
          const isUser = msg.role === 'user';
          const isDraft = msg.role === 'draft';
          const isSystem = msg.role === 'system';
          const isAssistant = msg.role === 'assistant';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="bg-orange-50 border border-orange-100 text-orange-700 text-[10px] font-mono px-3 py-1.5 rounded-lg italic max-w-[90%] text-center">
                  {msg.content.replace(/^Tool \([^)]+\): /, '[Tool] ')}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] ${isDraft ? 'w-full max-w-[90%]' : ''}`}>
                <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${isUser ? 'text-right text-gray-400' : 'text-left text-gray-400'}`}>
                  {roleLabel[msg.role] || msg.role}
                </div>
                <div className={`rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed ${
                  isUser
                    ? 'bg-brand-purple text-white rounded-tr-none'
                    : isDraft
                      ? 'bg-amber-50 border-2 border-amber-300 border-dashed text-amber-900 rounded-tl-none'
                      : isAssistant
                        ? 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
                        : 'bg-gray-100 text-gray-500 text-xs font-mono'
                }`}>
                  {isDraft && (
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center space-x-1">
                      <span>⏳</span>
                      <span>Awaiting your approval before sending</span>
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

      {/* Action Bar */}
      {isArchived ? (
        /* Read-only notice for archived/completed sessions */
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center space-x-3">
          <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            This session is archived — no further messages can be sent
          </p>
        </div>
      ) : (
        <div className="p-4 bg-white border-t border-gray-100 space-y-3">
          {/* Mode label */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {sendMode === 'manual' ? '✏️ Manual Override' : isReview ? "✅ Sophia's Draft (edit to override)" : '✏️ Send manual message'}
            </span>
            <span className="text-[10px] text-gray-300 font-mono">⌘+Enter to send</span>
          </div>

          <div className="flex items-end space-x-3">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                sendMode === 'manual'
                  ? 'Type your own message to the client...'
                  : latestDraft
                    ? "Edit Sophia's draft, or send as-is..."
                    : 'Type a message to send directly to the client...'
              }
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30 transition-all text-gray-900 resize-none bg-gray-50 focus:bg-white"
            />
            <button
              onClick={handleSend}
              disabled={isSending || !input.trim()}
              className="bg-brand-purple text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-100 whitespace-nowrap flex items-center space-x-2"
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
