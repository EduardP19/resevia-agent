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
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const statusColor: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    review: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <h2 className="text-3xl font-bold tracking-tight mb-1" style={{ color: '#271549' }}>Search</h2>
        <p className="text-sm text-gray-400">Find any conversation across all salons by phone number.</p>
      </div>

      {/* Search bar */}
      <form
        onSubmit={handleSearch}
        className="mb-10 flex gap-3 bg-white p-2 rounded-2xl"
        style={{ boxShadow: '0 2px 24px rgba(109,40,217,0.1)', border: '1px solid rgba(109,40,217,0.1)' }}
      >
        <div className="flex-1 flex items-center gap-3 px-4">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="+447700000000"
            className="flex-1 bg-transparent py-3 text-sm font-medium text-gray-900 placeholder-gray-300 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {results.map(session => (
            <Link
              key={session.id}
              href={`/dashboard/sessions/${session.id}`}
              className="group block bg-white rounded-2xl p-5 transition-all duration-200 shadow-card hover:shadow-card-hover"
              style={{ border: '1px solid rgba(109,40,217,0.08)' }}
            >
              <div className="flex items-start justify-between mb-3">
                <span
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
                >
                  {session.business_profiles?.name || 'Unknown Salon'}
                </span>
                <span className="text-[10px] text-gray-400 font-medium">
                  {new Date(session.created_at).toLocaleDateString('en-GB')}
                </span>
              </div>

              <div className="mb-4">
                <p className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-1">Context</p>
                <p className="text-sm text-gray-700 line-clamp-2 leading-relaxed italic">
                  &ldquo;{session.context}&rdquo;
                </p>
              </div>

              {session.outcome && (
                <div className="mb-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Outcome: </span>
                  <span className="text-xs font-bold" style={{ color: '#6D28D9' }}>{session.outcome}</span>
                </div>
              )}

              <div
                className="flex items-center justify-between pt-3"
                style={{ borderTop: '1px solid rgba(109,40,217,0.07)' }}
              >
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${statusColor[session.status] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                  {session.status}
                </span>
                <span
                  className="text-xs font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1"
                  style={{ color: '#6D28D9' }}
                >
                  View →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div
          className="text-center py-20 bg-white rounded-2xl"
          style={{ border: '2px dashed rgba(109,40,217,0.15)' }}
        >
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'rgba(109,40,217,0.08)' }}
          >
            <svg className="w-6 h-6" style={{ color: '#6D28D9' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-400 font-semibold text-sm">No conversations found for this number.</p>
        </div>
      )}
    </div>
  );
}
