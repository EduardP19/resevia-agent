import type { SalonUsage } from '@/lib/token-usage';

/**
 * Token / credit usage for the current calendar month, shown vs the plan limit.
 * Display-only (Server Component). Enterprise / no-limit plans show "Unlimited".
 */
export default function UsageCard({ usage }: { usage: SalonUsage | null }) {
  const used = usage?.tokensUsedThisMonth ?? 0;
  const limit = usage?.monthlyTokenLimit ?? null;
  const plan = usage?.plan || 'free';
  const ratio = usage?.usageRatio ?? null;
  const pct = ratio != null ? Math.min(100, Math.round(ratio * 100)) : null;

  const barColor =
    pct == null ? '#10B981' : pct >= 100 ? '#E11D48' : pct >= 90 ? '#F59E0B' : '#6D28D9';

  return (
    <div
      className="bg-white rounded-2xl p-5 mb-6"
      style={{ border: '1px solid rgba(109,40,217,0.1)', boxShadow: '0 2px 16px rgba(109,40,217,0.06)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-gray-800">Usage this month</p>
          <p className="text-xs text-gray-500 mt-0.5">Tokens consumed by Sophia across customer conversations.</p>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
          style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
        >
          {plan} plan
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-2xl font-bold tracking-tight" style={{ color: '#271549' }}>
          {used.toLocaleString('en-GB')}
        </span>
        <span className="text-sm text-gray-400">
          {limit != null ? `/ ${limit.toLocaleString('en-GB')} tokens` : 'tokens · unlimited'}
        </span>
      </div>

      {limit != null && (
        <>
          <div className="h-2.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(109,40,217,0.08)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: barColor }}
            />
          </div>
          <p className="text-[11px] mt-2 font-semibold" style={{ color: barColor }}>
            {pct}% used
            {pct != null && pct >= 100
              ? ' — over limit. Sophia keeps replying; consider upgrading the plan.'
              : pct != null && pct >= 90
              ? ' — approaching the monthly limit.'
              : ''}
          </p>
        </>
      )}
    </div>
  );
}
