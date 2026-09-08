'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, X, UserPlus } from 'lucide-react';
import type { ClientProfile } from '@/lib/client-profile';

export default function ClientForm({ client, onCancel }: { client?: ClientProfile; onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputClass = 'mt-1 block w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600';

  return <form onChange={() => setSaved(false)} onSubmit={async event => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/dashboard/clients', {
        method: client ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(form), ...(client ? { id: client.id } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the client.');
      setSaved(true);
      if (!client) router.push(`/dashboard/client/${encodeURIComponent(result.client.phone)}`);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the client.'); }
    finally { setSaving(false); }
  }} className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="text-sm font-medium text-gray-700">First name<input name="first_name" autoComplete="given-name" defaultValue={client?.first_name || ''} maxLength={100} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Last name<input name="last_name" autoComplete="family-name" defaultValue={client?.last_name || ''} maxLength={100} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Email<input name="email" type="email" autoComplete="email" defaultValue={client?.email || ''} maxLength={254} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Phone number<input name="phone" type="tel" autoComplete="tel" required readOnly={!!client} defaultValue={client?.phone || ''} maxLength={50} className={`${inputClass} read-only:bg-gray-50 read-only:text-gray-500`} /></label>
    </div>
    <label className="block text-sm font-medium text-gray-700">Notes<textarea name="notes" defaultValue={client?.metadata?.notes || ''} rows={3} maxLength={4000} className={inputClass} /></label>
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{client ? <Save size={16} /> : <UserPlus size={16} />}{saving ? 'Saving...' : client ? 'Save changes' : 'Add client'}</button>
      {onCancel && <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600"><X size={16} />Cancel</button>}
      {saved && <span role="status" className="text-sm text-emerald-700">Saved</span>}
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </div>
  </form>;
}
