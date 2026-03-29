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

  const liveSessions = sessions.filter((s: any) => {
    const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000);
    const isRecentlyActive = new Date(s.updated_at) > threeMinsAgo;
    return (s.status === 'active' || s.status === 'review') && isRecentlyActive;
  });
  const archivedSessions = sessions.filter((s: any) => {
    const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000);
    const isRecentlyActive = new Date(s.updated_at) > threeMinsAgo;
    return !(( s.status === 'active' || s.status === 'review') && isRecentlyActive);
  });

  const statusConfig: Record<string, { label: string; classes: string }> = {
    active:      { label: 'Active',       classes: 'bg-emerald-100 text-emerald-700' },
    review:      { label: 'Needs Approval', classes: 'bg-amber-100 text-amber-700 animate-pulse' },
    completed:   { label: 'Completed',    classes: 'bg-gray-100 text-gray-500' },
    handed_over: { label: 'Escalated',    classes: 'bg-rose-100 text-rose-600' },
  };

  const SessionCard = ({ session }: { session: any }) => {
    const isLive = session.status === 'active' || session.status === 'review';
    const cfg = statusConfig[session.status] || { label: session.status, classes: 'bg-gray-100 text-gray-500' };
    const date = new Date(session.created_at);

    return (
      <Link href={`/dashboard/sessions/${session.id}`} className="block group">
        <div className={`relative bg-white rounded-2xl border overflow-hidden flex flex-col transition-all duration-300 hover:shadow-xl h-full ${
          isLive ? 'border-emerald-400 shadow-lg shadow-emerald-50/50' : 'border-gray-100 shadow-sm hover:border-indigo-100'
        }`}>
          {/* Live top band */}
          {isLive && (
            <div className="h-1 w-full bg-emerald-500" />
          )}

          <div className="p-6 flex flex-col flex-1">
            {/* Header row */}
            <div className="flex items-start justify-between mb-4">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {session.business_profiles?.name || 'Salon'}
                </p>
                <p className="text-sm font-semibold text-gray-700">
                  {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <p className="text-xs text-gray-400">
                  {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex flex-col items-end space-y-1.5">
                {isLive && (
                  <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-widest rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    <span>Live</span>
                  </span>
                )}
                {/* Only show status badge for non-active statuses — avoid duplicate Live tag */}
                {session.status !== 'active' && (
                  <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${cfg.classes}`}>
                    {cfg.label}
                  </span>
                )}
              </div>
            </div>

            {/* Summary / body */}
            <div className={`flex-1 rounded-xl px-4 py-3 text-sm leading-relaxed mb-5 ${
              isLive ? 'bg-emerald-50/50 border border-emerald-100 text-emerald-900' : 'bg-gray-50/60 border border-gray-100 text-gray-600'
            }`}>
              <p className="italic line-clamp-3">
                {session.summary || 'Conversation summary pending...'}
              </p>
            </div>

            {/* Permanent CTA */}
            <div className={`flex items-center justify-between text-xs font-black uppercase tracking-widest ${
              isLive ? 'text-emerald-600' : 'text-brand-purple'
            }`}>
              <span>View Full Transcript</span>
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-10">
        <Link href="/dashboard/inbox" className="inline-flex items-center text-xs font-black uppercase tracking-widest text-brand-purple hover:translate-x-[-4px] transition-transform mb-6">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Inbox
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Conversation History</h2>
            <p className="text-lg text-gray-400 font-mono mt-2 tracking-tight">{decodedPhone}</p>
          </div>
          <div className="flex space-x-3">
            {liveSessions.length > 0 && (
              <div className="bg-emerald-50 px-4 py-2 rounded-2xl border border-emerald-100 text-xs font-bold text-emerald-700 uppercase tracking-widest flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{liveSessions.length} Live</span>
              </div>
            )}
            <div className="bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest">
              {sessions.length} total sessions
            </div>
          </div>
        </div>
      </div>

      {/* Live Sessions */}
      {liveSessions.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-xs font-black uppercase tracking-widest text-emerald-600">Active Now</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveSessions.map(s => <SessionCard key={s.id} session={s} />)}
          </div>
        </div>
      )}

      {/* Archived Sessions */}
      {archivedSessions.length > 0 && (
        <div>
          {liveSessions.length > 0 && (
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Past Conversations</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archivedSessions.map(s => <SessionCard key={s.id} session={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}
