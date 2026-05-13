'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

export default function CompleteSessionButton({ sessionId }: { sessionId: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleComplete = async () => {
    const firstConfirm = window.confirm('Mark this session as completed? This will remove it from active conversations.');
    if (!firstConfirm) return;

    const secondConfirm = window.confirm('Please confirm again: complete this session now?');
    if (!secondConfirm) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/dashboard/session/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed with status ${res.status}`);
      }

      trackClientEvent({
        event: 'button_clicked',
        category: 'dashboard',
        action: 'session_completed_manually',
        session_id: sessionId,
      });
      router.refresh();
    } catch (error: any) {
      alert(error?.message || 'Failed to complete session');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleComplete}
      disabled={isSubmitting}
      className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-150 disabled:opacity-50"
      style={{
        background: 'white',
        border: '1px solid rgba(190,24,93,0.35)',
        color: '#be185d',
      }}
    >
      {isSubmitting ? 'Completing…' : 'Complete Session'}
    </button>
  );
}
