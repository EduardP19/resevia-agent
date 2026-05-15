'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { trackClientEvent } from '@/lib/client-events';

export default function NotificationBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/dashboard/inbox/count');
        const { count } = await res.json();
        setCount(count);
      } catch {/* silent */}
    };
    check();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') check();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link
      href="/dashboard/inbox"
      onClick={() => trackClientEvent({ event: 'bell_clicked', category: 'dashboard', unread_count: count })}
      className="relative p-2 rounded-lg transition-colors text-gray-400 hover:text-[#6D28D9] hover:bg-[#6D28D9]/08"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-black text-white rounded-full"
          style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
