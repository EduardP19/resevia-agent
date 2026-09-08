'use client';

import React, { useState } from 'react';
import { trackClientEvent } from '@/lib/client-events';

type VoiceMode = 'reject' | 'forward' | 'agent';

const inputBase =
  'w-full bg-white border border-[#e4daf5] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all duration-150';

/**
 * Saves on change rather than on the page's Save button, matching ApprovalToggle:
 * this is a live routing switch — what happens to the next call that comes in —
 * not a profile field, so leaving it staged behind an unsaved form would be a
 * misleading way to present it.
 */
export default function VoiceModeToggle({
  salonId,
  initialMode,
  initialForwardNumber,
  agentName,
}: {
  salonId: string;
  initialMode: VoiceMode;
  initialForwardNumber: string;
  agentName: string;
}) {
  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [forwardNumber, setForwardNumber] = useState(initialForwardNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { value: VoiceMode; label: string; description: string }[] = [
    {
      value: 'reject',
      label: 'Text back',
      description: `Calls are declined and ${agentName} follows up straight away by WhatsApp or text.`,
    },
    {
      value: 'forward',
      label: 'Forward',
      description: 'Calls ring through to another number of yours. Nothing is answered by the agent.',
    },
    {
      value: 'agent',
      label: `${agentName} answers`,
      description: `${agentName} picks up and books over the phone, using the same services, prices and FAQs as your text conversations.`,
    },
  ];

  const save = async (next: VoiceMode, nextNumber = forwardNumber) => {
    const previousMode = mode;
    setMode(next);
    setSaving(true);
    setError(null);

    const res = await fetch('/api/dashboard/salon', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: salonId,
        voice_mode: next,
        voice_forward_number: nextNumber.trim(),
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // Roll back so the control never shows a mode calls aren't actually using.
      setMode(previousMode);
      setError(data?.error || 'Could not change call handling — please try again.');
      trackClientEvent({
        event: 'voice_mode_update_failed',
        category: 'dashboard',
        level: 'warn',
        tenant_id: salonId,
      });
      return;
    }

    trackClientEvent({
      event: 'voice_mode_updated',
      category: 'dashboard',
      tenant_id: salonId,
      voice_mode: next,
    });
  };

  const active = options.find((o) => o.value === mode);

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-3 gap-1 p-1 rounded-2xl"
        style={{ background: '#faf8fd', border: '1px solid rgba(109,40,217,0.08)' }}
      >
        {options.map((option) => {
          const isActive = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              // Switching to forwarding without a number is rejected server-side;
              // disabling it here explains why before the round trip.
              disabled={saving || (option.value === 'forward' && !forwardNumber.trim())}
              onClick={() => save(option.value)}
              className="px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all duration-200 disabled:opacity-40"
              style={
                isActive
                  ? { background: '#6D28D9', color: '#fff', boxShadow: '0 4px 14px rgba(109,40,217,0.28)' }
                  : { background: 'transparent', color: '#6D28D9' }
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">{active?.description}</p>

      <div>
        <label className="block text-[11px] font-bold text-[#6D28D9]/70 uppercase tracking-widest mb-2">
          Forwarding Number
        </label>
        <input
          type="tel"
          value={forwardNumber}
          onChange={(e) => setForwardNumber(e.target.value)}
          onBlur={() => {
            if (forwardNumber.trim() !== initialForwardNumber) save(mode, forwardNumber);
          }}
          className={inputBase}
          placeholder="+447700900123"
        />
        <p className="text-[11px] text-gray-400 mt-1.5">
          Include the country code. Only used when calls are set to forward.
        </p>
      </div>

      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
