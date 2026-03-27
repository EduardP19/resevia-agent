'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function NotificationBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const checkEscalations = async () => {
      try {
        const res = await fetch('/api/dashboard/inbox/count');
        const { count } = await res.json();
        setCount(count);
      } catch (err) {
        console.error('Failed to fetch escalation count');
      }
    };

    checkEscalations();
    const interval = setInterval(checkEscalations, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <Link href="/dashboard/inbox" className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {count > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-[10px] font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
          {count}
        </span>
      )}
    </Link>
  );
}
