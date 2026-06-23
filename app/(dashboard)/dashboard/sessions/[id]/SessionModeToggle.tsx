'use client';

import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

type Override = 'auto' | 'manual' | null;
type ExplicitMode = Exclude<Override, null>;

/**
 * Per-chat Manual/Auto control.
 *
 * The visible selection reflects the effective mode, including salon defaults.
 * Choosing Auto or Manual stores an explicit override for this chat only.
 */
export default function SessionModeToggle({
  sessionId,
  initialOverride,
  salonApprovalMode,
  children,
}: {
  sessionId: string;
  initialOverride: Override;
  salonApprovalMode: boolean;
  children?: ReactNode;
}) {
  const [override, setOverride] = useState<Override>(initialOverride ?? null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // What the chat actually does right now.
  const effectiveManual = override === 'manual' || (override === null && salonApprovalMode);
  const effectiveMode: ExplicitMode = effectiveManual ? 'manual' : 'auto';

  const options: { value: ExplicitMode; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'manual', label: 'Manual' },
  ];

  const apply = async (next: ExplicitMode) => {
    if (saving || next === effectiveMode) return;
    const previous = override;
    setOverride(next);
    setSaving(true);
    trackClientEvent({
      event: 'button_clicked',
      category: 'dashboard',
      action: 'session_mode_override',
      session_id: sessionId,
      override: next,
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
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center rounded-xl p-0.5"
          style={{ background: 'rgba(109,40,217,0.06)', border: '1px solid rgba(109,40,217,0.12)' }}
        >
          {options.map(opt => {
            const active = opt.value === effectiveMode;
            return (
              <button
                key={opt.value}
                onClick={() => apply(opt.value)}
                disabled={saving}
                aria-pressed={active}
                className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 whitespace-nowrap"
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
        {children}
      </div>
    </div>
  );
}
