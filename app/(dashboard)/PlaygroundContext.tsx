'use client';

import React, { createContext, useContext, useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'draft';
  content: string;
}

interface PlaygroundContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  phone: string;
  setPhone: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handoff: boolean;
  setHandoff: React.Dispatch<React.SetStateAction<boolean>>;
  resetSession: () => void;
  sendMessage: (input: string) => Promise<void>;
}

const PlaygroundContext = createContext<PlaygroundContextType | undefined>(undefined);

export function PlaygroundProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [phone, setPhone] = useState(`+447700${Math.floor(Math.random() * 900000 + 100000)}`);
  const [loading, setLoading] = useState(false);
  const [handoff, setHandoff] = useState(false);

  const sendMessage = async (input: string) => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/test/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, from: phone })
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, { role: 'system', content: `Error: ${data.error}` }]);
      } else {
        if (data.draft) {
          setMessages(prev => [...prev, { role: 'draft', content: data.reply }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
          if (data.handoff) setHandoff(true);
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system', content: 'Connection failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    setMessages([]);
    setHandoff(false);
    const newPhone = `+447700${Math.floor(Math.random() * 900000 + 100000)}`;
    setPhone(newPhone);
  };

  return (
    <PlaygroundContext.Provider value={{
      messages, setMessages,
      phone, setPhone,
      loading, setLoading,
      handoff, setHandoff,
      resetSession,
      sendMessage
    }}>
      {children}
    </PlaygroundContext.Provider>
  );
}

export function usePlayground() {
  const context = useContext(PlaygroundContext);
  if (context === undefined) {
    throw new Error('usePlayground must be used within a PlaygroundProvider');
  }
  return context;
}
