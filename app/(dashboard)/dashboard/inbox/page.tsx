import AutoRefresh from './AutoRefresh';
import { getGroupedSessions } from '@/lib/supabase';
import Link from 'next/link';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';
import TrackableLink from '@/app/(dashboard)/TrackableLink';

export const revalidate = 0;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const auth = requireDashboardSession();
  const { filter: filterParam } = await searchParams;
  const allClients = await getGroupedSessions(auth.tenantId);
  const filter = filterParam || 'all';
  safeLog({
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: auth.tenantId,
    page: 'dashboard/inbox',
    filter,
  });

  const stats = {
    all: allClients.length,
    needs_approval: allClients.filter((c: any) => c.has_review).length,
    escalated: allClients.filter((c: any) => c.has_escalation).length,
  };

  const filteredClients = allClients.filter((c: any) => {
    if (filter === 'approval') return c.has_review;
    if (filter === 'escalated') return c.has_escalation;
    return true;
  });

  const Tab = ({ id, label, count, active }: { id: string; label: string; count: number; active: boolean }) => (
    <TrackableLink
      href={`/dashboard/inbox${id === 'all' ? '' : `?filter=${id}`}`}
      trackEvent="tab_clicked"
      trackProps={{ page: 'dashboard/inbox', tab: id }}
      className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-200 flex items-center gap-2 ${
        active
          ? 'text-white shadow-brand'
          : 'text-[#6D28D9]/60 hover:text-[#6D28D9] hover:bg-[#6D28D9]/8'
      }`}
      style={active ? { background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)' } : undefined}
    >
      {label}
      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
        active ? 'bg-white/20 text-white' : 'bg-[#6D28D9]/10 text-[#6D28D9]'
      }`}>
        {count}
      </span>
    </TrackableLink>
  );

  const getStatusConfig = (c: any) => {
    if (c.has_review) return { label: 'Needs Approval', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border border-amber-200', pulse: true };
    if (c.has_escalation) return { label: 'Escalated', dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-600 border border-rose-200', pulse: false };
    return { label: 'Active', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200', pulse: false };
  };

  return (
    <div className="max-w-5xl mx-auto">
      <AutoRefresh />

      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight" style={{ color: '#271549' }}>
            {filter === 'approval' ? 'Needs Approval' : filter === 'escalated' ? 'Escalated' : 'Active Conversations'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {filter === 'approval'
              ? 'Drafts waiting for your final word.'
              : filter === 'escalated'
              ? 'Clients waiting for a team member.'
              : 'Sophia is currently assisting these clients.'}
          </p>
        </div>

        {/* Tabs */}
        <div
          className="bg-white p-1.5 rounded-2xl flex flex-wrap gap-1"
          style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.08)', border: '1px solid rgba(109,40,217,0.1)' }}
        >
          <Tab id="all" label="Active" count={stats.all} active={filter === 'all'} />
          <Tab id="approval" label="Approval" count={stats.needs_approval} active={filter === 'approval'} />
          <Tab id="escalated" label="Escalated" count={stats.escalated} active={filter === 'escalated'} />
        </div>
      </div>

      {/* Client list */}
      <div className="space-y-3">
        {filteredClients.map((c: any) => {
          const status = getStatusConfig(c);
          return (
            <TrackableLink key={c.id} href={`/dashboard/sessions/${c.id}?from=home`} className="block group" trackEvent="session_card_clicked" trackProps={{ page: 'dashboard/inbox', session_id: c.id, client_identifier: c.client_identifier, status: c.has_review ? 'needs_approval' : c.has_escalation ? 'escalated' : 'active' }}>
              <div
                className="bg-white rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between transition-all duration-200 relative overflow-hidden shadow-card hover:shadow-card-hover"
                style={{ border: '1px solid rgba(109,40,217,0.08)' }}
              >
                {/* Gradient left accent bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'linear-gradient(180deg, #6D28D9 0%, #C9A96E 100%)' }}
                />

                {/* Left: identity */}
                <div className="flex items-center gap-4 mb-3 md:mb-0 pl-1">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
                    style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <h3 className="text-sm font-bold text-gray-900 font-mono tracking-tight">{c.client_identifier}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${status.badge} ${status.pulse ? 'animate-pulse' : ''}`}>
                        <span className={`w-1 h-1 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      {c.business_profiles?.name || 'Local Salon'}
                    </p>
                  </div>
                </div>

                {/* Centre: message preview */}
                <div className="flex-1 px-0 md:px-10 max-w-md mb-3 md:mb-0">
                  {c.last_question ? (
                    <p className="text-sm text-gray-500 italic line-clamp-1 leading-relaxed">
                      &ldquo;{c.last_question}&rdquo;
                    </p>
                  ) : (
                    <p className="text-sm text-gray-300 italic">No messages yet</p>
                  )}
                </div>

                {/* Right: meta */}
                <div className="flex items-center justify-between md:justify-end gap-6">
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Last active</div>
                    <div className="text-sm font-semibold text-gray-700">
                      {new Date(c.updated_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 group-hover:text-white transition-all duration-200 flex-shrink-0"
                    style={{
                      background: 'rgba(109,40,217,0.06)',
                    }}
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

      {filteredClients.length === 0 && (
        <div
          className="p-20 text-center flex flex-col items-center bg-white rounded-2xl"
          style={{ border: '2px dashed rgba(109,40,217,0.15)', boxShadow: '0 2px 16px rgba(109,40,217,0.04)' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(109,40,217,0.1) 0%, rgba(201,169,110,0.1) 100%)' }}
          >
            <svg className="w-7 h-7 text-[#6D28D9]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="font-bold text-gray-400 text-xs uppercase tracking-widest mb-1">All quiet</p>
          <p className="text-gray-400 text-sm">Sophia is standing by.</p>
        </div>
      )}
    </div>
  );
}
