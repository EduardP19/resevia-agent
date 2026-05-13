import { getSessionTranscript, isTestUiSession, supabase } from '@/lib/supabase';
import Link from 'next/link';
import ChatInterface from './ChatInterface';
import HeaderActions from './HeaderActions';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';
import PageViewTracker from '@/app/(dashboard)/PageViewTracker';
import TrackableLink from '@/app/(dashboard)/TrackableLink';

export const revalidate = 0;

function resolveBackDestination(
  source: string | undefined,
  sessionClientIdentifier: string,
  phoneFromQuery: string | undefined
) {
  if (source === 'home') return '/dashboard/home';
  if (source === 'search') return '/dashboard/search';
  if (source === 'history') return '/dashboard/history';
  if (source === 'client') {
    return `/dashboard/client/${encodeURIComponent(phoneFromQuery || sessionClientIdentifier)}`;
  }

  return `/dashboard/client/${encodeURIComponent(sessionClientIdentifier)}`;
}

export default async function SessionTranscriptPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { from?: string; phone?: string };
}) {
  const auth = requireDashboardSession();
  const { data: session } = await supabase
    .from('sessions')
    .select('*, business_profiles(name)')
    .eq('id', params.id)
    .eq('salon_id', auth.tenantId)
    .single();

  if (!session || isTestUiSession(session)) return <div>Session not found.</div>;

  const source = typeof searchParams?.from === 'string' ? searchParams.from : undefined;
  const queryPhone = typeof searchParams?.phone === 'string' ? searchParams.phone : undefined;
  const backHref = resolveBackDestination(source, session.client_identifier, queryPhone);

  const transcript = await getSessionTranscript(params.id);
  const isReview = session.status === 'review' || transcript.some((m: any) => m.role === 'draft');
  safeLog({
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: session.salon_id,
    session_id: params.id,
    page: 'dashboard/session',
  });

  return (
    <div className="max-w-3xl mx-auto">
      <PageViewTracker page="dashboard/session" session_id={params.id} tenant_id={session.salon_id} />
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-between md:items-end">
        <div>
          <TrackableLink
            href={backHref}
            trackEvent="back_link_clicked"
            trackProps={{ page: 'dashboard/session', destination: backHref, session_id: params.id }}
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-3 transition-colors"
            style={{ color: '#6D28D9' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </TrackableLink>

          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#271549' }}>
            Conversation
          </h2>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5">
            <span className="text-sm font-mono font-semibold text-gray-600">{session.client_identifier}</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">{session.business_profiles?.name}</span>
            {isReview && (
              <>
                <span className="text-gray-300">·</span>
                <span
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#B45309', border: '1px solid rgba(245,158,11,0.3)' }}
                >
                  Needs Approval
                </span>
              </>
            )}
          </div>
        </div>
        <HeaderActions isReview={isReview} />
      </div>

      <ChatInterface
        sessionId={params.id}
        initialTranscript={transcript}
        clientPhone={session.client_identifier}
        sessionStatus={session.status}
      />
    </div>
  );
}
