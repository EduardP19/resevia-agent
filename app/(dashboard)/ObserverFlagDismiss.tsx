'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

/**
 * "Addressed" control for one observer finding.
 *
 * Hides the row locally the moment the server confirms, rather than waiting for
 * router.refresh() to repaint — the list is short, and a row that lingers after
 * a click reads as a failed click.
 */
export default function ObserverFlagDismiss({ flagId }: { flagId: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const router = useRouter();

  if (state === 'done') return null;

  const dismiss = async () => {
    setState('saving');
    const res = await fetch('/api/dashboard/observer/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: flagId }),
    });

    if (!res.ok) {
      setState('error');
      return;
    }

    trackClientEvent({ event: 'observer_flag_resolved', category: 'observer', flag_id: flagId });
    setState('done');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={state === 'saving'}
      title="Mark as addressed — removes it from this list"
      className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all duration-150 disabled:opacity-50"
    >
      {state === 'error' ? 'Retry' : state === 'saving' ? '…' : 'Addressed'}
    </button>
  );
}
