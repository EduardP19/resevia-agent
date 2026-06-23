import type { CurrencyTotals, TenantApiSpend } from '@/lib/token-usage';
import { getAgentName } from '@/lib/agent-name';

function formatTokenCount(value: number) {
  return value.toLocaleString('en-GB');
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

function formatCurrencyTotals(totals: CurrencyTotals, fallbackCurrency = 'USD') {
  const entries = Object.entries(totals);
  if (entries.length === 0) return formatCurrency(0, fallbackCurrency);

  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
}

function withAiUsd(twilioTotals: CurrencyTotals, aiUsd: number) {
  const totals = { ...twilioTotals };
  if (aiUsd !== 0 || Object.keys(totals).length === 0) {
    totals.USD = (totals.USD || 0) + aiUsd;
  }
  return totals;
}

function SpendMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(109,40,217,0.05)' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-lg font-bold mt-1" style={{ color: '#271549' }}>{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-0.5">{detail}</p>}
    </div>
  );
}

/**
 * Current-month API spend monitor.
 *
 * AI spend is estimated from recorded input/output tokens. Twilio spend uses
 * Twilio's own message prices once callbacks or reconciliation populate them.
 */
export default function UsageCard({ spend, agentName: rawAgentName }: { spend: TenantApiSpend | null; agentName?: string | null }) {
  const agentName = getAgentName({ agent_name: rawAgentName });
  const ai = spend?.ai;
  const twilio = spend?.twilio;
  const totalSpend = formatCurrencyTotals(withAiUsd(twilio?.totalCostByCurrency || {}, ai?.totalCostUsd || 0));
  const monthLabel = spend?.monthStart
    ? new Date(spend.monthStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : 'this month';

  return (
    <div
      className="bg-white rounded-2xl p-5 mb-6"
      style={{ border: '1px solid rgba(109,40,217,0.1)', boxShadow: '0 2px 16px rgba(109,40,217,0.06)' }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-bold text-gray-800">API spend this month</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Estimated tenant spend for {agentName}: AI input/output and Twilio SMS in/out.
          </p>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
          style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
        >
          {monthLabel}
        </span>
      </div>

      <div className="mb-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Known API spend</p>
        <p className="text-3xl font-bold tracking-tight mt-1" style={{ color: '#271549' }}>{totalSpend}</p>
        {!spend && <p className="text-xs text-gray-500 mt-1">Spend data is not available yet.</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <SpendMetric
          label="AI API"
          value={formatCurrency(ai?.totalCostUsd || 0, 'USD')}
          detail={`${formatTokenCount(ai?.totalTokens || 0)} total tokens`}
        />
        <SpendMetric
          label="Twilio inbound"
          value={formatCurrencyTotals(twilio?.inboundCostByCurrency || {})}
          detail={`${formatTokenCount(twilio?.inboundMessages || 0)} messages`}
        />
        <SpendMetric
          label="Twilio outbound"
          value={formatCurrencyTotals(twilio?.outboundCostByCurrency || {})}
          detail={`${formatTokenCount(twilio?.outboundMessages || 0)} messages`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-gray-100 p-3">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">AI input/output</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500">Input</span>
            <span className="font-semibold text-gray-800">
              {formatTokenCount(ai?.inputTokens || 0)} - {formatCurrency(ai?.inputCostUsd || 0, 'USD')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-1.5">
            <span className="text-gray-500">Output</span>
            <span className="font-semibold text-gray-800">
              {formatTokenCount(ai?.outputTokens || 0)} - {formatCurrency(ai?.outputCostUsd || 0, 'USD')}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 p-3">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Twilio pricing status</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500">Total SMS</span>
            <span className="font-semibold text-gray-800">{formatTokenCount(twilio?.totalMessages || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-1.5">
            <span className="text-gray-500">Awaiting price</span>
            <span className="font-semibold text-gray-800">{formatTokenCount(twilio?.unpricedMessages || 0)}</span>
          </div>
        </div>
      </div>

      {ai && ai.unpricedInteractions > 0 && (
        <p className="text-[11px] mt-3 text-amber-700 font-semibold">
          {ai.unpricedInteractions} AI interactions used a model without a configured rate.
        </p>
      )}
    </div>
  );
}
