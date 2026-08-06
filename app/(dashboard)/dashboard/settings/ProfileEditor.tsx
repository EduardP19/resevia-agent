'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import ApprovalToggle from '@/app/(dashboard)/ApprovalToggle';
import { trackClientEvent } from '@/lib/client-events';
import { getAgentName } from '@/lib/agent-name';

const inputBase =
  'w-full bg-white border border-[#e4daf5] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all duration-150';

function SectionIcon({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <label className="block text-[11px] font-bold text-[#6D28D9]/70 uppercase tracking-widest">
        {children}
      </label>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

export default function ProfileEditor({ salon }: { salon: any }) {
  // Business identity (name, sender number, opening hours) is provisioned by Resevia and
  // isn't shown or editable here — `/api/dashboard/salon` rejects those fields too.
  const [formData, setFormData] = useState({
    agent_name: salon.agent_name || '',
    tone_of_voice: salon.tone_of_voice || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const router = useRouter();
  const agentName = getAgentName({ agent_name: formData.agent_name });

  const handleSave = async () => {
    trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'settings_save' });
    setIsSaving(true);
    setSaveState('idle');
    const res = await fetch('/api/dashboard/salon', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: salon.id, ...formData }),
    });
    const data = await res.json().catch(() => null);
    setIsSaving(false);
    if (res.ok) {
      trackClientEvent({ event: 'settings_updated', category: 'dashboard', tenant_id: salon.id, fields_changed: Object.keys(formData) });
      window.dispatchEvent(new CustomEvent('agent-name-updated', { detail: { agentName: data?.agent_name ?? formData.agent_name } }));
      setSaveState('saved');
      router.refresh();
      setTimeout(() => setSaveState('idle'), 3000);
    } else {
      trackClientEvent({ event: 'settings_update_failed', category: 'dashboard', level: 'warn', tenant_id: salon.id, fields_changed: Object.keys(formData) });
      setSaveState('error');
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Agent AI ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={
            <SectionIcon>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </SectionIcon>
          }
          title={`${agentName} AI`}
          subtitle="Personality and response behaviour"
        />

        <div className="space-y-5">
          <div>
            <FieldLabel hint="Leave blank to use Sophia">Agent Name</FieldLabel>
            <input
              type="text"
              value={formData.agent_name}
              onChange={e => setFormData({ ...formData, agent_name: e.target.value })}
              className={inputBase}
              placeholder="Sophia"
            />
          </div>

          <div>
            <FieldLabel hint={`Every message ${agentName} sends reflects this tone — be as descriptive as you like`}>Tone of Voice</FieldLabel>
            <textarea
              rows={4}
              value={formData.tone_of_voice}
              onChange={e => setFormData({ ...formData, tone_of_voice: e.target.value })}
              className={`${inputBase} resize-none leading-relaxed`}
              placeholder="e.g. Warm and welcoming, like a trusted friend at a luxury salon. Professional but never stiff. Uses light humour occasionally. Never pushy or salesy."
            />
          </div>

          {/* Approval mode row */}
          <div>
            <FieldLabel>Reply Mode</FieldLabel>
            <ApprovalToggle withDescription />
          </div>
        </div>
      </Card>

      {/* ── Save bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-4 pt-1">
        {saveState === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Changes saved
          </span>
        )}
        {saveState === 'error' && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-rose-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Save failed — please try again
          </span>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="relative inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-60 active:scale-[0.97] select-none"
          style={{
            background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)',
            boxShadow: isSaving ? 'none' : '0 4px 18px rgba(109,40,217,0.35)',
          }}
        >
          {isSaving ? (
            <>
              <svg className="w-4 h-4 animate-spin opacity-70" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Saving…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Shared card primitives ───────────────────────────────────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-white rounded-2xl p-6 md:p-7"
      style={{
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 24px rgba(109,40,217,0.07)',
        border: '1px solid rgba(109,40,217,0.09)',
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-6 pb-5 border-b border-[#f0eafa]">
      {icon}
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-gray-900 tracking-tight leading-none">{title}</h3>
        <p className="text-[12px] text-gray-400 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}
