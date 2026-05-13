import { getHistorySessions } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';
import PageViewTracker from '@/app/(dashboard)/PageViewTracker';
import HistoryClient from './HistoryClient';

export const revalidate = 0;

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
          <p className="text-sm text-gray-400 mt-1">Filter by date, status, or search.</p>
        </div>
      </div>

      <HistoryClient phoneCards={phoneCards} />
    </div>
  );
}
