'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import ApprovalToggle from '@/app/(dashboard)/ApprovalToggle';
import { trackClientEvent } from '@/lib/client-events';

const inputClass = "w-full bg-[#faf8fd] border border-[#e8e0f0] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all";

export default function ProfileEditor({ salon }: { salon: any }) {
  const [formData, setFormData] = useState({
    name: salon.name || '',
    tone_of_voice: salon.tone_of_voice || '',
    opening_hours: salon.opening_hours || '',
    twilio_number: salon.twilio_number || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const router = useRouter();

  const handleSave = async () => {
    trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'settings_save' });
    setIsSaving(true);
    setSaveState('idle');
    const res = await fetch('/api/dashboard/salon', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: salon.id, ...formData }),
    });
    setIsSaving(false);
    if (res.ok) {
      trackClientEvent({ event: 'settings_updated', category: 'dashboard', tenant_id: salon.id, fields_changed: Object.keys(formData) });
      setSaveState('saved');
      router.refresh();
      setTimeout(() => setSaveState('idle'), 3000);
    } else {
      trackClientEvent({ event: 'settings_update_failed', category: 'dashboard', level: 'warn', tenant_id: salon.id, fields_changed: Object.keys(formData) });
      setSaveState('error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Identity card */}
      <div
        className="bg-white rounded-2xl p-6"
        style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.07)', border: '1px solid rgba(109,40,217,0.08)' }}
      >
        <div className="flex items-center gap-2 mb-5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-widest">Identity</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Salon Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className={inputClass}
              placeholder="My Salon"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Twilio Number</label>
            <input
              type="text"
              value={formData.twilio_number}
              onChange={e => setFormData({ ...formData, twilio_number: e.target.value })}
              className={`${inputClass} font-mono`}
              placeholder="+44..."
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Opening Hours</label>
            <textarea
              rows={4}
              value={formData.opening_hours}
              onChange={e => setFormData({ ...formData, opening_hours: e.target.value })}
              className={inputClass}
              placeholder={'Mon: 9am-6pm\nTue: 9am-6pm\n...'}
            />
          </div>
        </div>
      </div>

      {/* Sophia configuration card */}
      <div
        className="bg-white rounded-2xl p-6"
        style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.07)', border: '1px solid rgba(109,40,217,0.08)' }}
      >
        <div className="flex items-center gap-2 mb-5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-widest">Sophia Configuration</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">AI Tone of Voice</label>
            <textarea
              rows={3}
              value={formData.tone_of_voice}
              onChange={e => setFormData({ ...formData, tone_of_voice: e.target.value })}
              className={inputClass}
              placeholder="e.g. friendly and warm but professional — like a trusted local salon. Never pushy, always helpful."
            />
            <p className="text-[11px] text-gray-400 mt-1.5">Describe how Sophia should sound. This shapes every message she writes.</p>
          </div>

          <ApprovalToggle withDescription />
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-4">
        {saveState === 'saved' && (
          <span className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </span>
        )}
        {saveState === 'error' && (
          <span className="text-sm font-semibold text-rose-600">Failed — please try again</span>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
        >
          {isSaving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
