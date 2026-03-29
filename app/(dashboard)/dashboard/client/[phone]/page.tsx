import React from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export const revalidate = 0;

export default async function ClientHistoryPage({ params }: { params: { phone: string } }) {
  const decodedPhone = decodeURIComponent(params.phone);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*, business_profiles(name)')
    .eq('client_identifier', decodedPhone)
    .order('created_at', { ascending: false });

  if (!sessions || sessions.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-20 text-center">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
           <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
           </svg>
        </div>
        <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">No history found</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="mb-12">
        <Link href="/dashboard/inbox" className="inline-flex items-center text-xs font-black uppercase tracking-widest text-brand-purple hover:translate-x-[-4px] transition-transform mb-6">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Inbox
        </Link>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Conversation History</h2>
            <p className="text-lg text-gray-400 font-mono mt-2 tracking-tight">{decodedPhone}</p>
          </div>
          <div className="bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest">
            {sessions.length} total sessions
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {sessions.map((session) => {
          const isLive = session.status === 'active' || session.status === 'review';
          return (
            <Link 
              key={session.id} 
              href={`/dashboard/sessions/${session.id}`}
              className="block group"
            >
              <div className={`bg-white rounded-[2rem] border transition-all duration-300 overflow-hidden relative ${
                isLive 
                  ? 'border-indigo-100 shadow-xl shadow-indigo-50/50 hover:shadow-indigo-100/50' 
                  : 'border-gray-100 shadow-sm hover:shadow-md'
              }`}>
                {isLive && (
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-purple" />
                )}
                
                <div className="p-8">
                  <div className="flex justify-between items-start mb-6">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                          {session.business_profiles?.name}
                        </span>
                        <span className="text-gray-200">/</span>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                          {new Date(session.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} • {new Date(session.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <h3 className="text-xl font-extrabold text-gray-900 tracking-tight group-hover:text-brand-purple transition-colors">
                        {isLive ? 'Active Session' : 'Archived Chat'}
                      </h3>
                    </div>
                    <div className="flex items-center space-x-2">
                       {isLive && (
                         <span className="px-2 py-1 bg-brand-purple text-white text-[9px] font-black uppercase tracking-widest rounded-md animate-pulse">
                           Live
                         </span>
                       )}
                       <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                         session.status === 'review' 
                           ? 'bg-rose-100 text-rose-600' 
                           : session.status === 'active' 
                             ? 'bg-indigo-100 text-indigo-700' 
                             : 'bg-gray-100 text-gray-500'
                       }`}>
                         {session.status}
                       </span>
                    </div>
                  </div>

                  <div className={`rounded-2xl p-5 border italic text-sm leading-relaxed transition-colors ${
                    isLive 
                      ? 'bg-indigo-50/30 border-indigo-50 text-indigo-900' 
                      : 'bg-gray-50/50 border-gray-50 text-gray-600'
                  }`}>
                    {session.summary || "Conversation pending summary..."}
                  </div>

                  <div className="mt-6 flex items-center text-xs font-bold text-indigo-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    View full transcript
                    <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
