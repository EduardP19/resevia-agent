'use client';

import { useState, useRef, useEffect } from 'react';
import { usePlayground } from '../../PlaygroundContext';

export default function PlaygroundPage() {
  const { 
    messages, phone, loading, handoff, 
    sendMessage, resetSession 
  } = usePlayground();
  
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;
    const val = input.trim();
    setInput('');
    await sendMessage(val);
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Playground</h2>
          <p className="text-sm text-gray-500 mt-1">
            Simulating client: <span className="font-mono font-bold text-indigo-600">{phone}</span>
          </p>
        </div>
        <button 
          onClick={resetSession}
          className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
        >
          Reset Session
        </button>
      </div>

      <div className="flex-1 bg-white border border-gray-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#fcfcfc]">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-2xl">💬</span>
              </div>
              <p className="text-gray-500 font-medium">Send a "Hi" to start training Sophia</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div 
              key={i} 
              className={`flex ${m.role === 'user' ? 'justify-end' : m.role === 'system' ? 'justify-center' : 'justify-start'}`}
            >
              <div className={`
                max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm
                ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 
                  m.role === 'system' ? 'bg-gray-100 text-gray-500 text-xs font-mono uppercase' : 
                  m.role === 'draft' ? 'bg-orange-50 text-orange-800 border-2 border-dashed border-orange-200 rounded-tl-none' :
                  'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}
              `}>
                {m.role === 'draft' && (
                  <div className="text-[10px] font-bold text-orange-600 uppercase mb-1 tracking-tighter">Draft (Approval Reqd)</div>
                )}
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-50 px-4 py-3 rounded-2xl animate-pulse text-gray-400 text-xs">
                Sophia is thinking...
              </div>
            </div>
          )}

          {handoff && (
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-red-100">
                ⚠️ Handoff Triggered
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="p-4 bg-white border-t border-gray-100">
          <form onSubmit={handleSend} className="flex gap-3">
            <input 
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={handoff ? "Session handed over..." : "Reply to Sophia..."}
              disabled={loading || handoff}
              className="flex-1 bg-gray-50 border-none rounded-2xl px-6 py-4 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none"
            />
            <button 
              type="submit"
              disabled={loading || !input.trim() || handoff}
              className="bg-indigo-600 text-white px-8 rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Send
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-3 text-center uppercase tracking-widest font-medium">
            This simulator bypasses Twilio and does not incur SMS costs
          </p>
        </div>
      </div>
    </div>
  );
}

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Playground</h2>
          <p className="text-sm text-gray-500 mt-1">
            Simulating client: <span className="font-mono font-bold text-indigo-600">{phone}</span>
          </p>
        </div>
        <button 
          onClick={resetSession}
          className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
        >
          Reset Session
        </button>
      </div>

      <div className="flex-1 bg-white border border-gray-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#fcfcfc]">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-2xl">💬</span>
              </div>
              <p className="text-gray-500 font-medium">Send a "Hi" to start training Sophia</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div 
              key={i} 
              className={`flex ${m.role === 'user' ? 'justify-end' : m.role === 'system' ? 'justify-center' : 'justify-start'}`}
            >
              <div className={`
                max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm
                ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 
                  m.role === 'system' ? 'bg-gray-100 text-gray-500 text-xs font-mono uppercase' : 
                  m.role === 'draft' ? 'bg-orange-50 text-orange-800 border-2 border-dashed border-orange-200 rounded-tl-none' :
                  'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}
              `}>
                {m.role === 'draft' && (
                  <div className="text-[10px] font-bold text-orange-600 uppercase mb-1 tracking-tighter">Draft (Approval Reqd)</div>
                )}
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-50 px-4 py-3 rounded-2xl animate-pulse text-gray-400 text-xs">
                Sophia is thinking...
              </div>
            </div>
          )}

          {handoff && (
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-red-100">
                ⚠️ Handoff Triggered
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="p-4 bg-white border-t border-gray-100">
          <form onSubmit={sendMessage} className="flex gap-3">
            <input 
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={handoff ? "Session handed over..." : "Reply to Sophia..."}
              disabled={loading || handoff}
              className="flex-1 bg-gray-50 border-none rounded-2xl px-6 py-4 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none"
            />
            <button 
              type="submit"
              disabled={loading || !input.trim() || handoff}
              className="bg-indigo-600 text-white px-8 rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Send
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-3 text-center uppercase tracking-widest font-medium">
            This simulator bypasses Twilio and does not incur SMS costs
          </p>
        </div>
      </div>
    </div>
  );
}
