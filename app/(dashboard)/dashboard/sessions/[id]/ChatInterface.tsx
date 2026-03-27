'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export default function ChatInterface({ 
  sessionId, 
  initialTranscript 
}: { 
  sessionId: string; 
  initialTranscript: Message[] 
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const router = useRouter();

  // Find the latest draft if any
  const latestDraft = [...transcript].reverse().find(m => m.role === 'draft');

  useEffect(() => {
    if (latestDraft) {
      setInput(latestDraft.content);
    }
  }, [latestDraft]);

  const handleApprove = async () => {
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
        router.refresh(); // Refresh RSC data
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

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
      {/* Scrollable Transcript */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
        {transcript.map((msg) => {
          const isSystem = msg.role === 'system';
          const isAssistant = msg.role === 'assistant';
          const isUser = msg.role === 'user';
          const isDraft = msg.role === 'draft';

          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${
                isUser 
                  ? 'bg-brand-purple text-white rounded-tr-none' 
                  : isAssistant 
                    ? 'bg-white border border-gray-100 text-gray-800 rounded-tl-none' 
                    : isDraft
                      ? 'bg-purple-50 border-2 border-brand-purple border-dashed text-brand-purple rounded-tl-none'
                      : 'bg-orange-50 border border-orange-100 text-orange-800 text-xs font-mono rounded-lg italic'
              }`}>
                {isSystem && <div className="text-[10px] font-bold uppercase mb-1 opacity-60">System Log</div>}
                {isDraft && <div className="text-[10px] font-bold uppercase mb-1">Sophia's Draft (Awaiting Approval)</div>}
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className={`text-[10px] mt-2 opacity-50 ${isUser ? 'text-right' : 'text-left'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Bar */}
      <div className="p-4 bg-white border-t border-gray-100 flex flex-col space-y-3">
        {latestDraft && (
            <div className="px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 font-medium">
                💡 Sophia is waiting for you to approve or edit the response below.
            </div>
        )}
        <div className="flex items-center space-x-4">
          <textarea 
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={latestDraft ? "Edit Sophia's draft..." : "Type a manual response to override Sophia..."}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all text-black resize-none"
          />
          <button 
            onClick={handleApprove}
            disabled={isSending || !input.trim()}
            className={`bg-brand-purple text-white p-4 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-100`}
          >
             {isSending ? (
                 <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
             ) : (
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
             )}
          </button>
        </div>
      </div>
    </div>
  );
}
