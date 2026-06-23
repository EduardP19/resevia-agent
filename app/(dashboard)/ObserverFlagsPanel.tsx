import Link from 'next/link';
import type { ObserverFlagRow } from '@/lib/observer';

const SEVERITY_STYLE: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  critical: { dot: '#E11D48', text: '#9F1239', bg: 'rgba(225,29,72,0.06)', border: 'rgba(225,29,72,0.25)' },
  warning: { dot: '#F59E0B', text: '#B45309', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)' },
  info: { dot: '#6D28D9', text: '#6D28D9', bg: 'rgba(109,40,217,0.05)', border: 'rgba(109,40,217,0.18)' },
};

const TYPE_LABEL: Record<string, string> = {
  loop: 'Loop',
  off_topic: 'Off-topic drift',
  tool_failure: 'Tool failure',
  tool_thrash: 'Tool thrash',
  confusion: 'Confusion',
  limit: 'Usage limit',
  hallucination: 'Possible hallucination',
};

function FlagRow({ flag, href }: { flag: ObserverFlagRow; href?: string }) {
  const s = SEVERITY_STYLE[flag.severity] || SEVERITY_STYLE.info;
  const body = (
    <div
      className="rounded-xl px-3.5 py-2.5 flex items-start gap-3"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: s.dot }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: s.text }}>
            {TYPE_LABEL[flag.flag_type] || flag.flag_type}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{flag.source}</span>
          {flag.resolved && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">resolved</span>
          )}
        </div>
        {flag.detail && <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{flag.detail}</p>}
      </div>
      <span className="text-[10px] text-gray-400 font-mono flex-shrink-0 whitespace-nowrap">
        {new Date(flag.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/**
 * Display-only observer findings panel (Server Component).
 *
 * `variant="session"` renders nothing when there are no flags (keeps the
 * conversation view clean). `variant="home"` always renders, with an empty state.
 */
export default function ObserverFlagsPanel({
  flags,
  variant = 'session',
}: {
  flags: ObserverFlagRow[];
  variant?: 'session' | 'home';
}) {
  if (variant === 'session' && flags.length === 0) return null;

  return (
    <div
      className="bg-white rounded-2xl p-4 mb-4"
      style={{ border: '1px solid rgba(109,40,217,0.1)', boxShadow: '0 2px 16px rgba(109,40,217,0.05)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4" fill="none" stroke="#6D28D9" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span className="text-xs font-black uppercase tracking-widest text-[#6D28D9]">
          {variant === 'home' ? 'Observer — needs review' : 'Observer flags'}
        </span>
        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-[#6D28D9]/10 text-[#6D28D9]">
          {flags.length}
        </span>
      </div>

      {flags.length === 0 ? (
        <p className="text-sm text-gray-400 px-1 py-2">No anomalies flagged. Conversations look healthy.</p>
      ) : (
        <div className="space-y-2">
          {flags.map(f => (
            <FlagRow
              key={f.id}
              flag={f}
              href={variant === 'home' && f.session_id ? `/dashboard/sessions/${f.session_id}?from=home` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
