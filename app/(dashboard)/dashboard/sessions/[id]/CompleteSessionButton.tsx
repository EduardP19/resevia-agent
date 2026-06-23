'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

export default function CompleteSessionButton({ sessionId, isArchived }: { sessionId: string; isArchived?: boolean }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleComplete = async () => {
    const firstConfirm = window.confirm('End this chat? This will remove it from active conversations.');
    if (!firstConfirm) return;

    const secondConfirm = window.confirm('Please confirm again: end this chat now?');
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
      alert(error?.message || 'Failed to end chat');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isArchived) {
    return (
      <button
        disabled
        className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest opacity-50 cursor-not-allowed"
        style={{
          background: '#f3f4f6',
          border: '1px solid #d1d5db',
          color: '#9ca3af',
        }}
      >
        Chat Ended
      </button>
    );
  }

  return (
    <button
      onClick={handleComplete}
      disabled={isSubmitting}
      className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-150 disabled:opacity-50 whitespace-nowrap"
      style={{
        background: 'white',
        border: '1px solid rgba(190,24,93,0.35)',
        color: '#be185d',
      }}
    >
      {isSubmitting ? 'Ending…' : 'End Chat'}
    </button>
  );
}
