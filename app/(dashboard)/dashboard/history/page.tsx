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
  if (session.is_expired) {
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

  if (session.status === 'handed_over') {
    return {
      label: 'Escalated',
      badge: 'bg-amber-50 text-amber-700 border border-amber-200',
      dot: 'bg-amber-500',
    };
  }

  return {
    label: String(session.status || 'Closed').replace('_', ' '),
    badge: 'bg-gray-50 text-gray-600 border border-gray-200',
    dot: 'bg-gray-400',
  };
}

export default async function HistoryPage() {
  const auth = requireDashboardSession();
  const sessions = await getHistorySessions(auth.tenantId);

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
      <PageViewTracker page="dashboard/history" extra={{ results_count: sessions.length }} />
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
            Closed and expired sessions, shown separately for every conversation.
          </p>
        </div>

        <div
          className="bg-white px-4 py-3 rounded-2xl"
          style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.08)', border: '1px solid rgba(109,40,217,0.1)' }}
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total</span>
          <span className="ml-2 text-sm font-bold" style={{ color: '#271549' }}>{sessions.length}</span>
        </div>
      </div>

      <div className="space-y-3">
        {sessions.map((session: any) => {
          const status = getStatusConfig(session);

          return (
            <TrackableLink key={session.id} href={`/dashboard/sessions/${session.id}`} className="block group" trackEvent="session_card_clicked" trackProps={{ page: 'dashboard/history', session_id: session.id, status: session.status }}>
              <div
                className="bg-white rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between transition-all duration-200 relative overflow-hidden shadow-card hover:shadow-card-hover"
                style={{ border: '1px solid rgba(109,40,217,0.08)' }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'linear-gradient(180deg, #6D28D9 0%, #C9A96E 100%)' }}
                />

                <div className="flex items-center gap-4 mb-3 md:mb-0 pl-1 min-w-0 md:w-64">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
                    style={{ background: 'linear-gradient(135deg, #475569 0%, #6D28D9 100%)' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">
                      {session.client_identifier || 'Unknown number'}
                    </h3>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest truncate">
                      {session.business_profiles?.name || 'Local Salon'}
                    </p>
                  </div>
                </div>

                <div className="flex-1 px-0 md:px-8 mb-3 md:mb-0 min-w-0">
                  <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">
                    {session.outcome}
                  </p>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 md:min-w-64">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${status.badge}`}>
                    <span className={`w-1 h-1 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>

                  <div className="text-right">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Date</div>
                    <div className="text-sm font-semibold text-gray-700">
                      {formatHistoryDate(session.occurred_at)}
                    </div>
                  </div>

                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 group-hover:text-white transition-all duration-200 flex-shrink-0"
                    style={{ background: 'rgba(109,40,217,0.06)' }}
                  >
                    <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </TrackableLink>
          );
        })}
      </div>

      {sessions.length === 0 && (
        <div
          className="p-20 text-center flex flex-col items-center bg-white rounded-2xl"
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
