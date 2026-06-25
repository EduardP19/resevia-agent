'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

type Channel = 'whatsapp' | 'sms';

const TEMPLATE_PREVIEW =
  process.env.NEXT_PUBLIC_WHATSAPP_TEMPLATE_PREVIEW ||
  'Hi! This is a message from your salon. Reply here and we can help you book an appointment. 💬';

export default function InitiateConversation({ whatsappEnabled }: { whatsappEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientPhone, setClientPhone] = useState('');
  const [channel, setChannel] = useState<Channel>(whatsappEnabled ? 'whatsapp' : 'sms');
  const [smsMessage, setSmsMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setClientPhone('');
    setChannel(whatsappEnabled ? 'whatsapp' : 'sms');
    setSmsMessage('');
    setError(null);
  };

  const close = () => {
    if (isSending) return;
    setOpen(false);
    reset();
  };

  const handleSubmit = async () => {
    const phone = clientPhone.trim();
    if (!phone) {
      setError('Enter the client phone number (e.g. +447…).');
      return;
    }
    // A direct SMS send always needs a free-form body. (For WhatsApp the
    // fallback body is optional — the template carries the initial message.)
    if (channel === 'sms' && !smsMessage.trim()) {
      setError('Enter the SMS message to send.');
      return;
    }

    setIsSending(true);
    setError(null);
    trackClientEvent({
      event: 'button_clicked',
      category: 'dashboard',
      action: 'initiate_conversation',
      channel,
    });

    try {
      const res = await fetch('/api/dashboard/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientPhone: phone,
          channel,
          message: smsMessage.trim(),
          templatePreview: channel === 'whatsapp' ? TEMPLATE_PREVIEW : undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        trackClientEvent({
          event: 'conversation_initiated',
          category: 'dashboard',
          session_id: data.sessionId,
          channel: data.channel,
          fell_back_to_sms: !!data.fellBackToSms,
        });
        setOpen(false);
        reset();
        router.push(`/dashboard/sessions/${data.sessionId}?from=home`);
        router.refresh();
        return;
      }

      // WhatsApp failed and no fallback text was supplied — guide the owner.
      if (data?.fallbackRequired) {
        setChannel('sms');
        setError('WhatsApp could not deliver. Add an SMS fallback message and send again.');
      } else {
        setError(data?.error || 'Failed to start the conversation. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const channelButton = (value: Channel, label: string, disabled = false) => {
    const active = channel === value;
    return (
      <button
        type="button"
        disabled={disabled || isSending}
        onClick={() => setChannel(value)}
        className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
          active ? 'text-white shadow-brand' : 'text-[#6D28D9]/60 hover:text-[#6D28D9] hover:bg-[#6D28D9]/8'
        }`}
        style={active ? { background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)' } : undefined}
      >
        {label}
      </button>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'open_initiate_modal' }); }}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition-all duration-150 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
        </svg>
        Start Conversation
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(39,21,73,0.45)' }}
          onClick={close}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md overflow-hidden"
            style={{ boxShadow: '0 20px 60px rgba(39,21,73,0.3)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(109,40,217,0.08)' }}>
              <h3 className="text-lg font-bold tracking-tight" style={{ color: '#271549' }}>Start a conversation</h3>
              <p className="text-xs text-gray-400 mt-1">
                Reach out first. The client&apos;s reply continues here — booking included.
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Client phone</label>
                <input
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  placeholder="+447…"
                  inputMode="tel"
                  className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none text-gray-900"
                  style={{ background: '#faf8fd', border: '1px solid rgba(109,40,217,0.12)' }}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Channel</label>
                <div className="flex gap-1.5 bg-white p-1.5 rounded-2xl" style={{ border: '1px solid rgba(109,40,217,0.1)' }}>
                  {channelButton('whatsapp', 'WhatsApp', !whatsappEnabled)}
                  {channelButton('sms', 'SMS')}
                </div>
                {!whatsappEnabled && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    WhatsApp sender not configured for this salon — add a WhatsApp number in settings to enable it.
                  </p>
                )}
              </div>

              {channel === 'whatsapp' ? (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    WhatsApp template (pre-approved)
                  </label>
                  <div
                    className="rounded-xl px-4 py-3 text-sm leading-relaxed text-gray-600"
                    style={{ background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.25)' }}
                  >
                    {TEMPLATE_PREVIEW}
                  </div>
                  <div className="mt-3">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                      SMS fallback message <span className="text-gray-300 normal-case font-semibold">(used if WhatsApp can&apos;t deliver)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={smsMessage}
                      onChange={e => setSmsMessage(e.target.value)}
                      placeholder="Optional — recommended so outreach still lands as SMS."
                      className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none text-gray-900"
                      style={{ background: '#faf8fd', border: '1px solid rgba(109,40,217,0.12)' }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Message</label>
                  <textarea
                    rows={3}
                    value={smsMessage}
                    onChange={e => setSmsMessage(e.target.value)}
                    placeholder="Type the SMS to send the client…"
                    className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none text-gray-900"
                    style={{ background: '#faf8fd', border: '1px solid rgba(109,40,217,0.12)' }}
                  />
                </div>
              )}

              {error && (
                <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: '1px solid rgba(109,40,217,0.08)', background: '#faf8fd' }}>
              <button
                type="button"
                onClick={close}
                disabled={isSending}
                className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition-all duration-150 active:scale-95 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
              >
                {isSending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>Send {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
