import AutoRefresh from './AutoRefresh';
import { getGroupedSessions } from '@/lib/supabase';
import Link from 'next/link';

export const revalidate = 0; // Disable caching for the inbox

export default async function InboxPage({ searchParams }: { searchParams: { filter?: string } }) {
  const allClients = await getGroupedSessions();
  const filter = searchParams.filter || 'all';
  
  // Stats across all returned sessions (already filtered to active/review/handed_over in the query)
  const stats = {
    all: allClients.length,
    needs_approval: allClients.filter((c: any) => c.has_review).length,
    escalated: allClients.filter((c: any) => c.has_escalation).length,
  };

  const filteredClients = allClients.filter((c: any) => {
    if (filter === 'approval') return c.has_review;
    if (filter === 'escalated') return c.has_escalation;
    return true; // 'all' — show every active/review/escalated session
  });

  const Tab = ({ id, label, count, active }: { id: string; label: string; count: number; active: boolean }) => (
    <Link
      href={`/dashboard/inbox${id === 'all' ? '' : `?filter=${id}`}`}
      className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center ${
        active
          ? 'bg-brand-purple text-white shadow-lg shadow-indigo-100'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
      <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
    </Link>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative">
      <AutoRefresh />
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
        <div>
          <div className="flex items-center space-x-2 mb-1">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-200"></div>
             <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live Updating</span>
          </div>
          <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            {filter === 'approval' ? 'Needs Approval' : filter === 'escalated' ? 'Escalated to Human' : 'Active Conversations'}
          </h2>
          <p className="text-lg text-gray-400 mt-2">
            {filter === 'approval' ? 'Drafts waiting for your final word.' : filter === 'escalated' ? 'Clients waiting for a team member.' : 'Sophia is currently assisting these clients.'}
          </p>
        </div>

        <div className="bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap gap-1">
          <Tab id="all" label="Active" count={stats.all} active={filter === 'all'} />
          <Tab id="approval" label="Needs Approval" count={stats.needs_approval} active={filter === 'approval'} />
          <Tab id="escalated" label="Escalated" count={stats.escalated} active={filter === 'escalated'} />
        </div>
      </div>

      <div className="space-y-4">
        {filteredClients.map((c: any) => (
          <Link
            key={c.id}
            href={`/dashboard/sessions/${c.id}`}
            className="block group"
          >
            <div className="bg-white rounded-3xl border border-gray-100 p-6 flex flex-col md:flex-row md:items-center justify-between shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all duration-300 relative overflow-hidden">
               {/* Left: Client Info */}
               <div className="flex items-center space-x-6 mb-4 md:mb-0">
                  <div>
                    <div className="flex items-center space-x-3 mb-1">
                      <h3 className="text-lg font-bold text-gray-900 font-mono tracking-tight">{c.client_identifier}</h3>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        c.has_review
                          ? 'bg-rose-100 text-rose-600 animate-pulse'
                          : c.has_escalation
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-600'
                      }`}>
                        {c.has_review ? 'Needs Approval' : c.has_escalation ? 'Escalated' : c.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                       {c.business_profiles?.name || 'Local Salon'}
                    </p>
                  </div>
               </div>

               {/* Center: Message Preview */}
               <div className="flex-1 px-0 md:px-12 max-w-lg mb-4 md:mb-0">
                  {c.last_question ? (
                    <p className="text-sm text-gray-600 italic line-clamp-1 leading-relaxed">
                       &ldquo;{c.last_question}&rdquo;
                    </p>
                  ) : (
                    <p className="text-sm text-gray-300 italic">No messages yet</p>
                  )}
               </div>

               {/* Right: Meta & Link */}
               <div className="flex items-center justify-between md:justify-end space-x-8">
                  <div className="text-right">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Last Active</div>
                    <div className="text-sm font-semibold text-gray-700">
                      {new Date(c.updated_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-brand-purple group-hover:text-white transition-all transform group-hover:translate-x-1 shadow-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
               </div>
            </div>
          </Link>
        ))}
      </div>

      {filteredClients.length === 0 && (
        <div className="p-20 text-center flex flex-col items-center bg-white rounded-3xl border border-dashed border-gray-200">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-300">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-gray-400 font-bold mb-2 uppercase tracking-widest text-xs">No active sessions</p>
          <p className="text-gray-400 text-sm">Sophia is currently standing by.</p>
        </div>
      )}
    </div>
  );
}
