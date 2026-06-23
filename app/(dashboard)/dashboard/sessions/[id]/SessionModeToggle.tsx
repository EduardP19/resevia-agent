'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

type Override = 'auto' | 'manual' | null;

/**
 * Per-chat Manual/Auto control.
 *
 * Every chat follows the salon's global setting by default ("Salon default").
 * Setting Auto or Manual here overrides the global setting for THIS chat only.
 */
export default function SessionModeToggle({
  sessionId,
  initialOverride,
  salonApprovalMode,
}: {
  sessionId: string;
  initialOverride: Override;
  salonApprovalMode: boolean;
}) {
  const [override, setOverride] = useState<Override>(initialOverride ?? null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // What the chat actually does right now.
  const effectiveManual = override === 'manual' || (override === null && salonApprovalMode);
  const defaultLabel = salonApprovalMode ? 'Manual' : 'Auto';

  const options: { value: Override; label: string }[] = [
    { value: null, label: `Salon default · ${defaultLabel}` },
    { value: 'auto', label: 'Auto' },
    { value: 'manual', label: 'Manual' },
  ];

  const apply = async (next: Override) => {
    if (saving || next === override) return;
    const previous = override;
    setOverride(next);
    setSaving(true);
    trackClientEvent({
      event: 'button_clicked',
      category: 'dashboard',
      action: 'session_mode_override',
      session_id: sessionId,
      override: next ?? 'inherit',
    });
    try {
      const res = await fetch('/api/dashboard/session/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, override: next }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch {
      setOverride(previous);
      trackClientEvent({
        event: 'settings_update_failed',
        category: 'dashboard',
        level: 'warn',
        session_id: sessionId,
        fields_changed: ['response_mode_override'],
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
        This chat — {effectiveManual ? 'Manual approval' : 'Automatic reply'}
      </span>
      <div
        className="inline-flex items-center rounded-xl p-0.5"
        style={{ background: 'rgba(109,40,217,0.06)', border: '1px solid rgba(109,40,217,0.12)' }}
      >
        {options.map(opt => {
          const active = opt.value === override;
          return (
            <button
              key={String(opt.value)}
              onClick={() => apply(opt.value)}
              disabled={saving}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap"
              style={
                active
                  ? { background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', color: 'white' }
                  : { background: 'transparent', color: '#6D28D9' }
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
