import React from 'react';
import { getSalonSessions } from '@/lib/supabase';
import Link from 'next/link';

export const revalidate = 0; // Disable caching for the inbox

export default async function InboxPage() {
  const sessions = await getSalonSessions();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Live Feedback</h2>
          <p className="text-gray-500 mt-1">Real-time conversations across all your salon locations.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100 font-semibold text-gray-900 text-sm">
            <tr>
              <th className="px-6 py-4">Client</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Salon</th>
              <th className="px-6 py-4">Last Activity</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sessions.map((s: any) => (
              <tr key={s.id} className="hover:bg-gray-50/50 transition-colors group">
                <td className="px-6 py-4">
                  <div className="font-semibold text-gray-900">{s.client_identifier}</div>
                  <div className="text-xs text-gray-400 font-mono">{s.id.slice(0, 8)}...</div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    s.status === 'handed_over' 
                      ? 'bg-red-100 text-red-700 animate-pulse' 
                      : s.status === 'active' 
                        ? 'bg-indigo-100 text-indigo-700' 
                        : 'bg-gray-100 text-gray-600'
                  }`}>
                    {s.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {s.business_profiles?.name || 'Unknown'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(s.updated_at).toLocaleString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: 'short'
                  })}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link 
                    href={`/dashboard/sessions/${s.id}`}
                    className="inline-flex items-center text-sm font-bold text-brand-purple hover:underline"
                  >
                    View Transcript
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 && (
          <div className="p-12 text-center text-gray-400">
            No active sessions found.
          </div>
        )}
      </div>
    </div>
  );
}
