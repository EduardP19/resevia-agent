'use client';

import { useMemo, useState } from 'react';
import TrackableLink from '@/app/(dashboard)/TrackableLink';

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  
  const dateString = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  
  const timeString = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  
  return `${dateString} · ${timeString}`;
}

type Card = {
  phone: string;
  conversationCount: number;
  latest: any;
  latestStatus: { label: string; badge: string; dot: string };
};

export default function HistoryClient({ phoneCards }: { phoneCards: Card[] }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'expired' | 'completed' | 'escalated'>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return phoneCards.filter((card) => {
      const latestStatus = String(card.latest?.status || '');
      if (statusFilter !== 'all' && latestStatus !== statusFilter) return false;

      if (dateFilter) {
        const occurred = new Date(card.latest?.occurred_at || card.latest?.updated_at || card.latest?.created_at);
        const yyyy = occurred.getFullYear();
        const mm = String(occurred.getMonth() + 1).padStart(2, '0');
        const dd = String(occurred.getDate()).padStart(2, '0');
        const normalized = `${yyyy}-${mm}-${dd}`;
        if (normalized !== dateFilter) return false;
      }

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const haystack = `${card.phone} ${card.latest?.outcome || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [phoneCards, statusFilter, dateFilter, query]);

  return (
    <>
      <div className="mb-5 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m21 21-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number or outcome"
            className="w-full bg-white border border-[#e8e0f0] rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#6D28D9]/20"
          />
        </div>

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="bg-white border border-[#e8e0f0] rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#6D28D9]/20"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="bg-white border border-[#e8e0f0] rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#6D28D9]/20"
        >
          <option value="all">All statuses</option>
          <option value="expired">Expired</option>
          <option value="completed">Completed</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((card: any) => (
          <TrackableLink
            key={card.phone}
            href={`/dashboard/client/${encodeURIComponent(card.phone)}`}
            className="block group"
            trackEvent="history_phone_card_clicked"
            trackProps={{
              page: 'dashboard/history',
              client_identifier: card.phone,
              conversation_count: card.conversationCount,
              latest_status: card.latest?.status,
            }}
          >
            <div
              className="bg-white rounded-2xl p-5 transition-all duration-200 relative overflow-hidden shadow-card hover:shadow-card-hover h-full min-h-[220px] flex flex-col"
              style={{ border: '1px solid rgba(109,40,217,0.08)' }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(180deg, #6D28D9 0%, #C9A96E 100%)' }}
              />

              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Number</p>
                  <h3 className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">{card.phone}</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${card.latestStatus.badge}`}>
                    <span className={`w-1 h-1 rounded-full ${card.latestStatus.dot}`} />
                    {card.latestStatus.label}
                  </span>
                  {card.latest?.channel === 'whatsapp' ? (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest"
                      style={{ background: 'rgba(37,211,102,0.1)', color: '#128C7E', border: '1px solid rgba(37,211,102,0.3)' }}
                    >
                      WhatsApp
                    </span>
                  ) : (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest"
                      style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9', border: '1px solid rgba(109,40,217,0.2)' }}
                    >
                      SMS
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Date</p>
                  <p suppressHydrationWarning className="text-sm font-semibold text-gray-700">{formatHistoryDate(card.latest.occurred_at)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Convos</p>
                  <p className="text-sm font-semibold text-gray-700">{card.conversationCount}</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-3 flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Last outcome</p>
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-4">{card.latest.outcome}</p>
              </div>
            </div>
          </TrackableLink>
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          className="p-20 text-center flex flex-col items-center bg-white rounded-2xl mt-4"
          style={{ border: '2px dashed rgba(109,40,217,0.15)', boxShadow: '0 2px 16px rgba(109,40,217,0.04)' }}
        >
          <p className="font-bold text-gray-400 text-xs uppercase tracking-widest mb-1">No matches</p>
          <p className="text-gray-400 text-sm">Try another filter or search term.</p>
        </div>
      )}
    </>
  );
}
