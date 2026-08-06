'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { trackClientEvent } from '@/lib/client-events';

type NotificationItem = {
  id: string;
  client_identifier: string;
  status: string;
  channel: string;
  updated_at: string;
  preview: string | null;
};

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function statusConfig(status: string) {
  if (status === 'escalated') {
    return { label: 'Escalated', badge: 'bg-rose-50 text-rose-600 border border-rose-200', dot: 'bg-rose-500' };
  }
  return { label: 'Needs Approval', badge: 'bg-amber-50 text-amber-700 border border-amber-200', dot: 'bg-amber-500' };
}

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/notifications');
      const data = await res.json();
      setCount(data.count || 0);
      setItems(data.items || []);
    } catch {/* silent */}
    finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') check();
    }, 60000);
    return () => clearInterval(interval);
  }, [check]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    trackClientEvent({ event: 'bell_clicked', category: 'dashboard', unread_count: count, action: next ? 'open' : 'close' });
    if (next) check();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={count > 0 ? `Notifications, ${count} waiting` : 'Notifications'}
        className={`relative p-2 rounded-lg transition-colors hover:text-[#6D28D9] hover:bg-[#6D28D9]/[0.08] ${
          isOpen ? 'text-[#6D28D9] bg-[#6D28D9]/[0.08]' : 'text-gray-400'
        }`}
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
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-50 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(109,40,217,0.12)', boxShadow: '0 12px 40px rgba(109,40,217,0.18)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0ebfa]">
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#271549' }}>
              Notifications
            </span>
            {count > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-[#6D28D9]/10 text-[#6D28D9]">
                {count}
              </span>
            )}
          </div>

          <div className="max-h-[22rem] overflow-y-auto scrollbar-thin">
            {isLoading && items.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-gray-400">Loading…</p>
            )}

            {!isLoading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="font-bold text-gray-400 text-[10px] uppercase tracking-widest mb-1">All caught up</p>
                <p className="text-sm text-gray-400">Nothing needs your attention.</p>
              </div>
            )}

            {items.map((item) => {
              const status = statusConfig(item.status);
              return (
                <Link
                  key={item.id}
                  href={`/dashboard/sessions/${item.id}?from=home`}
                  onClick={() => {
                    trackClientEvent({
                      event: 'notification_clicked',
                      category: 'dashboard',
                      session_id: item.id,
                      status: item.status,
                    });
                    setIsOpen(false);
                  }}
                  className="block px-4 py-3 border-b border-[#f5f1fb] last:border-b-0 transition-colors hover:bg-[#6D28D9]/[0.04]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-900 font-mono tracking-tight truncate">
                      {item.client_identifier}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 flex-shrink-0 ${status.badge}`}>
                      <span className={`w-1 h-1 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <span className="ml-auto text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex-shrink-0">
                      {formatRelative(item.updated_at)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 italic line-clamp-2 leading-relaxed">
                    {item.preview ? `“${item.preview}”` : 'No messages yet'}
                  </p>
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#6D28D9]/50">
                    {item.channel === 'whatsapp' ? 'WhatsApp' : item.channel === 'webchat' ? 'Web chat' : 'SMS'}
                  </span>
                </Link>
              );
            })}
          </div>

          <Link
            href="/dashboard/home?filter=needs_approval"
            onClick={() => {
              trackClientEvent({ event: 'notification_view_all_clicked', category: 'dashboard', unread_count: count });
              setIsOpen(false);
            }}
            className="block px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-[#6D28D9] border-t border-[#f0ebfa] transition-colors hover:bg-[#6D28D9]/[0.06]"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
