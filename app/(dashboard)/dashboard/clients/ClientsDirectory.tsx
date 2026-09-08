'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus, Search, ArrowUpRight } from 'lucide-react';
import { clientDisplayName, type ClientProfile } from '@/lib/client-profile';
import ClientForm from './ClientForm';

export default function ClientsDirectory({ clients, total, query, page }: {
  clients: ClientProfile[]; total: number; query: string; page: number;
}) {
  const [adding, setAdding] = useState(false);
  const pageHref = (next: number) => `/dashboard/clients?q=${encodeURIComponent(query)}&page=${next}`;
  return <div className="max-w-6xl mx-auto text-gray-900">
    <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div><h1 className="text-2xl font-bold">Clients</h1><p className="text-sm text-gray-500 mt-1">{total} {total === 1 ? 'client' : 'clients'}</p></div>
      <button onClick={() => setAdding(!adding)} aria-expanded={adding} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><UserPlus size={17} />Add client</button>
    </header>
    {adding && <section className="border-y border-gray-200 py-5 mb-6"><h2 className="text-lg font-semibold mb-4">New client</h2><ClientForm onCancel={() => setAdding(false)} /></section>}
    <form action="/dashboard/clients" className="flex gap-2 mb-5 max-w-md">
      <input name="q" defaultValue={query} aria-label="Search clients" placeholder="Name, email or phone" className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
      <button aria-label="Search clients" title="Search clients" className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md border border-gray-300 bg-white"><Search size={18} /></button>
    </form>
    <div className="overflow-x-auto border-y border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500"><tr>{['Client', 'Email', 'Phone', 'Bookings', ''].map((label, i) => <th key={i} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-100">
          {clients.map(client => <tr key={client.id} className="hover:bg-gray-50">
            <td className="px-4 py-4 min-w-[160px]"><Link className="font-semibold text-gray-900 hover:underline break-words" href={`/dashboard/client/${encodeURIComponent(client.phone)}`}>{clientDisplayName(client) || 'Unnamed client'}</Link></td>
            <td className="px-4 py-4 max-w-[250px] break-words text-gray-600">{client.email || '-'}</td>
            <td className="px-4 py-4 whitespace-nowrap text-gray-600">{client.phone}</td>
            <td className="px-4 py-4 tabular-nums">{client.booking_history.filter(b => b.status === 'confirmed').length}</td>
            <td className="px-4 py-4"><Link href={`/dashboard/client/${encodeURIComponent(client.phone)}`} aria-label={`Open ${clientDisplayName(client) || client.phone}`} title="Open client" className="inline-flex h-8 w-8 items-center justify-center text-gray-500"><ArrowUpRight size={18} /></Link></td>
          </tr>)}
          {!clients.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500">{query ? 'No matching clients.' : 'No clients yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
    {(page > 1 || page * 50 < total) && <nav aria-label="Client pages" className="flex justify-between items-center mt-4 text-sm">
      {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span />}
      <span className="text-gray-500">Page {page}</span>
      {page * 50 < total ? <Link href={pageHref(page + 1)}>Next</Link> : <span />}
    </nav>}
  </div>;
}
