'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function TestSMSPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [from, setFrom] = useState('+447700000001');
  const [loading, setLoading] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, from })
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, { role: 'system', content: `Error: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        if (data.handoff) setHandoff(true);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system', content: 'Request failed.' }]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    setHandoff(false);
    setFrom('+44770000' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'));
  }

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'monospace', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, color: '#111' }}>SMS Test Console</h2>
        <button onClick={reset} style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer', background: '#eee', border: '1px solid #ccc', color: '#333', borderRadius: 4 }}>
          New conversation
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
        Simulating: <strong>{from}</strong>
      </div>

      {handoff && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          Handoff triggered — conversation flagged for human review
        </div>
      )}

      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        height: 420,
        overflowY: 'auto',
        padding: 12,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}>
        {messages.length === 0 && (
          <div style={{ color: '#999', fontSize: 13, textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
            Send a message to start
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : m.role === 'system' ? 'center' : 'flex-start',
            background: m.role === 'user' ? '#0078d4' : m.role === 'system' ? '#f0f0f0' : '#fff',
            color: m.role === 'user' ? '#fff' : '#222',
            border: m.role === 'system' ? 'none' : '1px solid #e0e0e0',
            borderRadius: 12,
            padding: '8px 12px',
            maxWidth: '80%',
            fontSize: 14,
            lineHeight: 1.4
          }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: '#999', fontSize: 13 }}>typing...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message..."
          disabled={loading || handoff}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, background: '#fff', color: '#000' }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim() || handoff}
          style={{ padding: '8px 16px', borderRadius: 6, background: '#0078d4', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
