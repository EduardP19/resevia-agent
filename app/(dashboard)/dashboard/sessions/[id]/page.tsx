import { getSessionTranscript, isTestUiSession, supabase } from '@/lib/supabase';
import Link from 'next/link';
import ChatInterface from './ChatInterface';
import HeaderActions from './HeaderActions';

export const revalidate = 0;

export default async function SessionTranscriptPage({ params }: { params: { id: string } }) {
  const { data: session } = await supabase
    .from('sessions')
    .select('*, business_profiles(name)')
    .eq('id', params.id)
    .single();

  if (!session || isTestUiSession(session)) return <div>Session not found.</div>;

  const transcript = await getSessionTranscript(params.id);
  const isReview = session.status === 'review' || transcript.some((m: any) => m.role === 'draft');

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-between md:items-end">
        <div>
          <Link
            href="/dashboard/inbox"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-3 transition-colors"
            style={{ color: '#6D28D9' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Inbox
          </Link>

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
