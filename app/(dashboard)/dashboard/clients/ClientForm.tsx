'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, X, UserPlus } from 'lucide-react';
import { clientNotes } from '@/lib/client-profile';
import type { ClientProfile } from '@/lib/client-profile';

export default function ClientForm({ client, onCancel }: { client?: ClientProfile; onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputClass = 'mt-1 block w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600';
  const notes = clientNotes(client);

  async function submitForm(form: HTMLFormElement, deleteNoteId?: string) {
    if (saving) return;
    const formData = new FormData(form);
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/dashboard/clients', {
        method: client ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(formData),
          ...(client ? { id: client.id } : {}),
          ...(deleteNoteId ? { delete_note_id: deleteNoteId, note: '' } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the client.');
      setSaved(true);
      form.reset();
      if (!client || result.client.phone !== client.phone) router.push(`/dashboard/client/${encodeURIComponent(result.client.phone)}`);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the client.'); }
    finally { setSaving(false); }
  }

  return <form onChange={() => setSaved(false)} onSubmit={async event => {
    event.preventDefault();
    await submitForm(event.currentTarget);
  }} className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="text-sm font-medium text-gray-700">First name<input name="first_name" autoComplete="given-name" defaultValue={client?.first_name || ''} maxLength={100} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Last name<input name="last_name" autoComplete="family-name" defaultValue={client?.last_name || ''} maxLength={100} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Email<input name="email" type="email" autoComplete="email" defaultValue={client?.email || ''} maxLength={254} className={inputClass} /></label>
      <label className="text-sm font-medium text-gray-700">Phone number<input name="phone" type="tel" autoComplete="tel" required defaultValue={client?.phone || ''} maxLength={50} className={inputClass} /></label>
    </div>
    <label className="block text-sm font-medium text-gray-700">Add note<textarea name="note" rows={3} maxLength={4000} className={inputClass} /></label>
    {notes.length > 0 && <div className="space-y-2">
      {notes.map(note => <div key={note.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <div className="flex items-start justify-between gap-3">
          <time className="text-xs font-medium text-gray-500" dateTime={note.created_at}>{new Date(note.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
          <button type="button" disabled={saving} aria-label="Remove note" title="Remove note" onClick={async event => {
            const form = event.currentTarget.form;
            if (!form || !confirm('Remove this note?')) return;
            await submitForm(form, note.id);
          }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-red-700 disabled:opacity-50">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words">{note.text}</p>
      </div>)}
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{client ? <Save size={16} /> : <UserPlus size={16} />}{saving ? 'Saving...' : client ? 'Save changes' : 'Add client'}</button>
      {onCancel && <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600"><X size={16} />Cancel</button>}
      {saved && <span role="status" className="text-sm text-emerald-700">Saved</span>}
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </div>
  </form>;
}
