'use client';

import { useState, useEffect, useRef } from 'react';

export default function TestPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [phone] = useState('+447700216011'); // Default test phone
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: input, 
          from: phone,
          id: sessionId 
        })
      });
      const data = await res.json();
      
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
      }

      if (data.draft) {
        // Approval mode — the real SMS customer sees nothing yet.
        // Show neutral waiting dots. Internal draft stays in the dashboard only.
        setMessages(prev => [...prev, { role: 'waiting', sessionId: data.sessionId }]);
      } else if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Find the last waiting message to show the dashboard tip
  const lastWaiting = [...messages].reverse().find(m => m.role === 'waiting');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col h-[700px]">
        <div className="p-6 bg-brand-purple text-white">
          <h1 className="text-xl font-bold italic tracking-tight">Resevia Agent Test</h1>
          <p className="text-[10px] uppercase font-black tracking-widest opacity-80 mt-1">Simulated Client: {phone}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-gray-400 italic text-sm">
              Start chatting with Sophia...
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'waiting' ? (
                // Neutral dots — what the real customer would see (no reply yet)
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
      
      {/* Owner-only tip — below the widget, not visible to the simulated client */}
      {lastWaiting ? (
        <a
          href={`/dashboard/sessions/${lastWaiting.sessionId || sessionId}`}
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
