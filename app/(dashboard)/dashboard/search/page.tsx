'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/dashboard/search?phone=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-20">
      <div className="mb-12 text-center">
        <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Global Search</h2>
        <p className="text-gray-500 mt-2">Find any conversation across all salons by phone number.</p>
        
        <form onSubmit={handleSearch} className="mt-8 max-w-xl mx-auto flex gap-3">
          <input 
            type="text" 
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="+447700000000"
            className="flex-1 bg-white border-2 border-gray-100 rounded-2xl px-6 py-4 shadow-sm focus:border-brand-purple focus:ring-4 focus:ring-brand-purple/5 transition-all outline-none text-lg text-black font-medium"
          />
          <button 
            type="submit"
            disabled={loading}
            className="bg-brand-purple text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {results.map(session => (
          <Link 
            key={session.id} 
            href={`/dashboard/sessions/${session.id}`}
            className="group block bg-white border border-gray-200 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:border-brand-purple/30 transition-all active:scale-[0.98]"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="bg-indigo-50 text-brand-purple px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {session.business_profiles?.name || 'Unknown Salon'}
              </div>
              <div className="text-xs font-medium text-gray-400">
                {new Date(session.created_at).toLocaleDateString()}
              </div>
            </div>
            
            <div className="mb-6">
              <div className="text-xs font-bold text-gray-300 uppercase mb-2 tracking-widest">Chat Context</div>
              <p className="text-gray-700 font-medium line-clamp-2 text-sm leading-relaxed italic mb-3">
                "{session.context}"
              </p>
              <div className="flex items-center space-x-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Outcome:</div>
                <div className="text-sm font-extrabold text-indigo-600 uppercase tracking-tight">
                  {session.outcome}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-50">
               <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                 session.status === 'active' ? 'bg-green-100 text-green-700' :
                 session.status === 'review' ? 'bg-orange-100 text-orange-700' :
                 'bg-gray-100 text-gray-600'
               }`}>
                 {session.status}
               </span>
               <span className="text-brand-purple font-bold text-sm group-hover:translate-x-1 transition-transform">
                 View Transcript →
               </span>
            </div>
          </Link>
        ))}
      </div>

      {searched && !loading && results.length === 0 && (
        <div className="text-center py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
          <p className="text-gray-400 font-medium text-lg">No conversations found for this number.</p>
        </div>
      )}
    </div>
  );
}
