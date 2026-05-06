'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfileEditor({ salon }: { salon: any }) {
  const [formData, setFormData] = useState({
    name: salon.name || '',
    tone_of_voice: salon.tone_of_voice || '',
    approval_mode: salon.approval_mode || false,
    opening_hours: salon.opening_hours || '',
    twilio_number: salon.twilio_number || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const router = useRouter();

  const handleSave = async () => {
    setIsSaving(true);
    setSaveState('idle');
    const res = await fetch('/api/dashboard/salon', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: salon.id, ...formData }),
    });
    setIsSaving(false);
    if (res.ok) {
      setSaveState('saved');
      router.refresh();
      setTimeout(() => setSaveState('idle'), 3000);
    } else {
      setSaveState('error');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-900">Identity</h3>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Salon Name</label>
            <input 
              type="text" 
              value={formData.name} 
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-black"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Twilio Number</label>
            <input 
              type="text" 
              value={formData.twilio_number} 
              onChange={e => setFormData({...formData, twilio_number: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-black font-mono bg-gray-50"
              placeholder="+44..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Opening Hours</label>
            <textarea 
              rows={4}
              value={formData.opening_hours} 
              onChange={e => setFormData({...formData, opening_hours: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-black"
              placeholder="Mon: 9am-6pm&#10;Tue: 9am-6pm..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">AI Tone of Voice</label>
            <textarea
              rows={3}
              value={formData.tone_of_voice}
              onChange={e => setFormData({...formData, tone_of_voice: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-black"
              placeholder="e.g. friendly and warm but professional — like a trusted local salon. Never pushy, always helpful."
            />
            <p className="text-xs text-gray-400 mt-1">Describe how Sophia should sound. This shapes every message she writes.</p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-900">Agent Configuration</h3>
          <div className="flex items-start space-x-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
             <div className="flex items-center h-5">
                <input 
                  type="checkbox" 
                  checked={formData.approval_mode}
                  onChange={e => setFormData({...formData, approval_mode: e.target.checked})}
                  className="w-5 h-5 text-brand-purple border-gray-300 rounded focus:ring-brand-purple"
                />
             </div>
             <div>
                <label className="font-bold text-indigo-900">Human Approval Mode</label>
                <p className="text-sm text-indigo-700 mt-1">
                  When enabled, Sophia won't send messages directly. You'll need to approve or edit them in the Inbox first.
                </p>
             </div>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-100 flex items-center justify-end gap-4">
        {saveState === 'saved' && (
          <span className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Settings saved
          </span>
        )}
        {saveState === 'error' && (
          <span className="text-sm font-semibold text-rose-600">Failed to save — please try again</span>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-brand-purple text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
