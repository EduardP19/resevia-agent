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
    <div className="max-w-4xl mx-auto relative">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:justify-between md:items-end">
        <div>
          <Link href="/dashboard/inbox" className="text-sm font-bold text-brand-purple hover:underline flex items-center mb-2">
            ← Back to Inbox
          </Link>
          <div className="flex items-center space-x-2 mb-1">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-200"></div>
             <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live Updating</span>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">Conversation Details</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
            <span className="text-sm text-gray-500 font-mono">{session.client_identifier}</span>
            <span className="text-gray-300">•</span>
            <span className="text-sm text-gray-500">{session.business_profiles?.name}</span>
            {isReview && (
              <>
                <span className="text-gray-300">•</span>
                <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest rounded-full animate-pulse">
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
