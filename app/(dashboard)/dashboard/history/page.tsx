import Link from 'next/link';
import { getHistorySessions } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';
import PageViewTracker from '@/app/(dashboard)/PageViewTracker';
import TrackableLink from '@/app/(dashboard)/TrackableLink';

export const revalidate = 0;

function formatHistoryDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date unavailable';
  }

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getStatusConfig(session: any) {
  if (session.status === 'expired') {
    return {
      label: 'Expired',
      badge: 'bg-slate-50 text-slate-600 border border-slate-200',
      dot: 'bg-slate-400',
    };
  }

  if (session.status === 'completed') {
    return {
      label: 'Completed',
      badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      dot: 'bg-emerald-500',
    };
  }

  if (session.status === 'escalated') {
    return {
      label: 'Escalated',
      badge: 'bg-rose-50 text-rose-600 border border-rose-200',
      dot: 'bg-rose-500',
    };
  }

  return {
    label: String(session.status || 'Closed').replace('_', ' '),
    badge: 'bg-gray-50 text-gray-600 border border-gray-200',
    dot: 'bg-gray-400',
  };
}

function buildPhoneCards(sessions: any[]) {
  const grouped = new Map<string, any[]>();

  for (const session of sessions) {
    const phone = session.client_identifier || 'Unknown number';
    if (!grouped.has(phone)) grouped.set(phone, []);
    grouped.get(phone)!.push(session);
  }

  return Array.from(grouped.entries()).map(([phone, items]) => {
    const sorted = [...items].sort((a, b) => {
      const aTime = new Date(a.occurred_at || a.updated_at || a.created_at).getTime();
      const bTime = new Date(b.occurred_at || b.updated_at || b.created_at).getTime();
      return bTime - aTime;
    });
    const latest = sorted[0];

    return {
      phone,
      sessions: sorted,
      latest,
      latestStatus: getStatusConfig(latest),
      conversationCount: sorted.length,
    };
  }).sort((a, b) => {
    const aTime = new Date(a.latest?.occurred_at || a.latest?.updated_at || a.latest?.created_at).getTime();
    const bTime = new Date(b.latest?.occurred_at || b.latest?.updated_at || b.latest?.created_at).getTime();
    return bTime - aTime;
  });
}

export default async function HistoryPage() {
  const auth = requireDashboardSession();
  const sessions = await getHistorySessions(auth.tenantId);
  const phoneCards = buildPhoneCards(sessions);

  safeLog({
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: auth.tenantId,
    page: 'dashboard/history',
    results_count: sessions.length,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PageViewTracker page="dashboard/history" extra={{ results_count: sessions.length, phone_count: phoneCards.length }} />
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-slate-400 shadow-[0_0_6px_rgba(148,163,184,0.55)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Archive</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight" style={{ color: '#271549' }}>
            History
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            One card per phone number. Open a card to view every conversation for that client.
          </p>
        </div>

        <div
          className="bg-white px-4 py-3 rounded-2xl"
          style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.08)', border: '1px solid rgba(109,40,217,0.1)' }}
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Numbers</span>
          <span className="ml-2 text-sm font-bold" style={{ color: '#271549' }}>{phoneCards.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {phoneCards.map((card: any) => (
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
                  <h3 className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">
                    {card.phone}
                  </h3>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${card.latestStatus.badge}`}>
                  <span className={`w-1 h-1 rounded-full ${card.latestStatus.dot}`} />
                  {card.latestStatus.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Date</p>
                  <p className="text-sm font-semibold text-gray-700">{formatHistoryDate(card.latest.occurred_at)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Convos</p>
                  <p className="text-sm font-semibold text-gray-700">{card.conversationCount}</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-3 flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Last outcome</p>
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-4">
                  {card.latest.outcome}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-widest text-brand-purple">
                <span>View all conversations</span>
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </TrackableLink>
        ))}
      </div>

      {phoneCards.length === 0 && (
        <div
          className="p-20 text-center flex flex-col items-center bg-white rounded-2xl mt-4"
          style={{ border: '2px dashed rgba(109,40,217,0.15)', boxShadow: '0 2px 16px rgba(109,40,217,0.04)' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(109,40,217,0.1) 0%, rgba(71,85,105,0.1) 100%)' }}
          >
            <svg className="w-7 h-7 text-[#6D28D9]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="font-bold text-gray-400 text-xs uppercase tracking-widest mb-1">No history yet</p>
          <p className="text-gray-400 text-sm">Closed sessions will appear here.</p>
        </div>
      )}
    </div>
  );
}
