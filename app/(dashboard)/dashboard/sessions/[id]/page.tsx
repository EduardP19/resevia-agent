import AutoRefresh from '../../inbox/AutoRefresh';
import { getSessionTranscript, supabase } from '@/lib/supabase';
import Link from 'next/link';
import ChatInterface from './ChatInterface';

export const revalidate = 0;

export default async function SessionTranscriptPage({ params }: { params: { id: string } }) {
  const { data: session } = await supabase
    .from('sessions')
    .select('*, business_profiles(name)')
    .eq('id', params.id)
    .single();

  const transcript = await getSessionTranscript(params.id);

  if (!session) return <div>Session not found.</div>;

  return (
    <div className="max-w-4xl mx-auto relative">
      <AutoRefresh />
      <div className="mb-8 flex justify-between items-end">
        <div>
          <Link href="/dashboard/inbox" className="text-sm font-bold text-brand-purple hover:underline flex items-center mb-2">
            ← Back to Inbox
          </Link>
          <div className="flex items-center space-x-2 mb-1">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-200"></div>
             <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live Updating</span>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">Conversation Details</h2>
          <div className="flex items-center space-x-3 mt-2">
            <span className="text-sm text-gray-500 font-mono">{session.client_identifier}</span>
            <span className="text-gray-300">•</span>
            <span className="text-sm text-gray-500">{session.business_profiles?.name}</span>
          </div>
        </div>
        
        <div className="flex space-x-3">
             <button className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors">
                Escalate to Human
             </button>
             <button className="bg-brand-purple text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Send Manual Message
             </button>
        </div>
      </div>

      <ChatInterface sessionId={params.id} initialTranscript={transcript} />
    </div>
  );
}
