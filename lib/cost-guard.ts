import { supabase } from '@/lib/supabase';
import { safeLog, logError } from '@/lib/logger';

/**
 * Per-tenant message-spend monitoring.
 *
 * **This never blocks a send.** It observes spend and alerts the operator.
 * Every path here is fire-and-forget and swallows its own errors — a failure to
 * check spend must never stop a salon's customer getting a reply.
 *
 * Spend is measured against the RATE-CARD estimate (`twilio_fee_usd` +
 * `meta_fee_usd`), which `upsertSmsMessage` computes synchronously. Twilio's
 * reported `price` is unusable for this: it lands on a later status callback,
 * only ~81% of messages have one, and the reconciliation cron that fills the
 * rest has no schedule behind it.
 *
 * Note the rate card runs ~1.64x Twilio's actual billed price on this account,
 * so thresholds fire early. That is the safe direction for an alert, but set
 * limits knowing the estimate is conservative.
 */

/** Fallback cap when business_profiles.monthly_cost_limit_usd is null. */
const DEFAULT_LIMIT_USD = Number(process.env.TENANT_MONTHLY_COST_LIMIT_USD || 50);

/** Percentages of the cap that trigger an alert. */
const THRESHOLDS: number[] = (process.env.COST_ALERT_THRESHOLDS || '80,100')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0)
  .sort((a, b) => a - b);

const ALERT_EVENT = 'tenant_cost_threshold_crossed';

interface AlertEvaluation {
  should_alert: boolean;
  reason: string;
  threshold_pct?: number;
  spend_usd?: number;
  limit_usd?: number;
  pct_used?: number;
  salon_name?: string;
}

async function alertOperator(params: {
  salonId: string;
  salonName: string;
  thresholdPct: number;
  spendUsd: number;
  limitUsd: number;
}): Promise<boolean> {
  const to = process.env.OPERATOR_ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return false;

  const { salonName, salonId, thresholdPct, spendUsd, limitUsd } = params;
  const pct = ((spendUsd / limitUsd) * 100).toFixed(1);
  const subject = `[Resevia] ${salonName} at ${pct}% of monthly message spend`;
  const lines = [
    `Tenant:     ${salonName} (${salonId})`,
    `Spend MTD:  $${spendUsd.toFixed(4)} (rate-card estimate)`,
    `Limit:      $${limitUsd.toFixed(2)}`,
    `Threshold:  ${thresholdPct}%`,
    ``,
    `Service has NOT been stopped — this is an alert only.`,
    `The rate-card estimate runs ~1.64x Twilio's billed price, so actual spend is likely lower.`,
  ];

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Same sender the owner notification path uses.
      from: process.env.RESEVIA_NOTIFICATIONS_FROM || 'Resevia <hello@resevia.co.uk>',
      to: [to],
      subject,
      text: lines.join('\n'),
      html: `<pre style="font:14px/1.6 monospace">${lines.join('\n')}</pre>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend request failed (${response.status}): ${await response.text()}`);
  }
  return true;
}

/**
 * Checks a tenant's month-to-date spend and alerts on newly crossed thresholds.
 * Safe to call on every message write; returns silently on any failure.
 */
export async function checkTenantSpend(salonId: string | null | undefined): Promise<void> {
  if (!salonId) return;

  try {
    // One atomic call: computes spend, resolves the limit, picks the highest
    // crossed threshold and claims the alert via a primary-key insert. Only
    // the caller that actually created the row gets should_alert = true, so a
    // batch of concurrent writes still produces exactly one alert.
    const { data, error } = await supabase.rpc('evaluate_tenant_cost_alert', {
      p_salon_id: salonId,
      p_default_limit: DEFAULT_LIMIT_USD,
      p_thresholds: THRESHOLDS,
    });

    if (error) {
      logError('billing', 'tenant_spend_evaluation_failed', error, {
        source: 'lib.cost-guard',
        tenant_id: salonId,
      });
      return;
    }

    const result = (data || {}) as AlertEvaluation;
    if (!result.should_alert) return;

    const thresholdPct = result.threshold_pct ?? 0;
    const spendUsd = Number(result.spend_usd ?? 0);
    const limitUsd = Number(result.limit_usd ?? 0);
    const pctUsed = Number(result.pct_used ?? 0);
    const salonName = result.salon_name || salonId;

    let emailed = false;
    try {
      emailed = await alertOperator({ salonId, salonName, thresholdPct, spendUsd, limitUsd });
    } catch (err) {
      logError('billing', 'tenant_cost_alert_email_failed', err, {
        source: 'lib.cost-guard',
        tenant_id: salonId,
        threshold_pct: thresholdPct,
      });
    }

    safeLog({
      type: 'audit',
      level: thresholdPct >= 100 ? 'error' : 'warning',
      category: 'billing',
      event: ALERT_EVENT,
      source: 'lib.cost-guard',
      tenant_id: salonId,
      message: `${salonName} reached ${pctUsed.toFixed(1)}% of the $${limitUsd.toFixed(2)} monthly message-spend limit`,
      threshold_pct: thresholdPct,
      spend_usd: spendUsd,
      limit_usd: limitUsd,
      pct_used: pctUsed,
      operator_emailed: emailed,
      blocked: false,
    });
  } catch (err) {
    logError('billing', 'tenant_spend_check_failed', err, {
      source: 'lib.cost-guard',
      tenant_id: salonId,
    });
  }
}
