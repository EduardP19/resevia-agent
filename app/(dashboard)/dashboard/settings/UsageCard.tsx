import type { PlatformSpend, TenantChannelUsage, UsagePreset } from '@/lib/costs';
import { getAgentName } from '@/lib/agent-name';

function formatCount(value: number) {
  return Math.round(value).toLocaleString('en-GB');
}

function formatCurrency(amount: number, currency = 'USD') {
  const digits = Math.abs(amount) < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

function formatCurrencyTotals(totals: Record<string, number> | undefined, fallbackCurrency = 'USD') {
  const entries = Object.entries(totals || {});
  if (entries.length === 0) return formatCurrency(0, fallbackCurrency);

  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
}

function presetLabel(preset: UsagePreset) {
  if (preset === 'last_month') return 'Last month';
  if (preset === 'last_3_months') return 'Last 3 months';
  if (preset === 'last_6_months') return 'Last 6 months';
  if (preset === 'all') return 'All';
  if (preset === 'custom') return 'Custom';
  return 'Last 30 days';
}

function UsageMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(109,40,217,0.05)' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: '#271549' }}>{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-0.5">{detail}</p>}
    </div>
  );
}

export function AdminApiSpendCard({ spend }: { spend: PlatformSpend | null }) {
  const monthLabel = spend?.range.label || 'This month';
  const rows = spend?.bySalon || [];

  return (
    <div
      className="bg-white rounded-2xl p-5 mb-6"
      style={{ border: '1px solid rgba(109,40,217,0.1)', boxShadow: '0 2px 16px rgba(109,40,217,0.06)' }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-bold text-gray-800">API spend this month</p>
          <p className="text-xs text-gray-500 mt-0.5">Admin-only platform spend across AI, SMS, WhatsApp and voice.</p>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
          style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
        >
          {monthLabel}
        </span>
      </div>

      <div className="mb-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total spend</p>
        <p className="text-3xl font-bold tracking-tight mt-1" style={{ color: '#271549' }}>
          {formatCurrencyTotals(spend?.totalByCurrency)}
        </p>
        {!spend && <p className="text-xs text-gray-500 mt-1">Spend data is not available yet.</p>}
      </div>

      <div className="rounded-xl border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 py-2.5 bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
          <span>Salon</span>
          <span>Events</span>
          <span className="text-right">Spend</span>
        </div>
        {rows.length > 0 ? (
          rows.map((salon: any) => (
            <div key={salon.salonId} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 py-3 border-t border-gray-100 text-sm">
              <span className="font-semibold text-gray-800">{salon.salonName}</span>
              <span className="text-gray-500">{formatCount(salon.events)}</span>
              <span className="font-semibold text-gray-800 text-right">{formatCurrencyTotals(salon.totalByCurrency)}</span>
            </div>
          ))
        ) : (
          <div className="px-3.5 py-4 border-t border-gray-100 text-sm text-gray-500">No spend recorded for this month.</div>
        )}
      </div>
    </div>
  );
}

export default function UsageCard({
  usage,
  agentName: rawAgentName,
  from,
  to,
}: {
  usage: TenantChannelUsage | null;
  agentName?: string | null;
  from?: string | null;
  to?: string | null;
}) {
  const agentName = getAgentName({ agent_name: rawAgentName });
  const activePreset = usage?.range.preset || 'last_30_days';
  const rangeLabel = usage?.range.label || 'Last 30 days';
  const presets: UsagePreset[] = ['last_30_days', 'last_month', 'last_3_months', 'last_6_months', 'all'];
  const smsMessages = usage?.smsMessages || 0;
  const smsSegments = usage?.smsSegments || 0;
  const whatsAppMessages = usage?.whatsAppMessages || 0;
  const calls = usage?.calls || 0;
  const callMinutes = Math.ceil((usage?.callSeconds || 0) / 60);

  return (
    <div
      className="bg-white rounded-2xl p-5 mb-6"
      style={{ border: '1px solid rgba(109,40,217,0.1)', boxShadow: '0 2px 16px rgba(109,40,217,0.06)' }}
    >
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-800">Usage</p>
            <p className="text-xs text-gray-500 mt-0.5">
              SMS, WhatsApp and call activity handled by {agentName}.
            </p>
          </div>
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
            style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
          >
            {rangeLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {presets.map(preset => (
            <form key={preset} action="/dashboard/settings">
              <button
                type="submit"
                name="usagePreset"
                value={preset}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                  activePreset === preset
                    ? 'text-white'
                    : 'text-[#6D28D9] bg-[#6D28D9]/8 hover:bg-[#6D28D9]/12'
                }`}
                style={activePreset === preset ? { background: '#6D28D9' } : undefined}
              >
                {presetLabel(preset)}
              </button>
            </form>
          ))}
        </div>

        <form className="flex flex-wrap items-end gap-2" action="/dashboard/settings">
          <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
            From
            <input
              type="date"
              name="usageFrom"
              defaultValue={from || ''}
              className="h-9 rounded-xl border border-gray-200 px-2 text-sm font-semibold normal-case tracking-normal text-gray-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
            To
            <input
              type="date"
              name="usageTo"
              defaultValue={to || ''}
              className="h-9 rounded-xl border border-gray-200 px-2 text-sm font-semibold normal-case tracking-normal text-gray-800"
            />
          </label>
          <button type="submit" name="usagePreset" value="custom" className="h-9 px-3 rounded-xl text-xs font-bold text-white" style={{ background: '#271549' }}>
            Custom
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <UsageMetric label="SMS" value={formatCount(smsMessages)} detail={`${formatCount(smsSegments)} segments`} />
        <UsageMetric label="WhatsApp" value={formatCount(whatsAppMessages)} detail="messages" />
        <UsageMetric label="Calls" value={formatCount(calls)} detail="completed calls" />
        <UsageMetric label="Call minutes" value={formatCount(callMinutes)} detail="total minutes" />
      </div>

      {!usage && <p className="text-xs text-gray-500 mt-3">Usage data is not available yet.</p>}
    </div>
  );
}
