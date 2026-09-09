import { safeLog } from '@/lib/logger';
import { checkTenantSpend } from '@/lib/cost-guard';
import { normalizeSmsPrice } from '@/lib/sms-pricing';
import { supabase } from '@/lib/supabase';
import { rateSms, rateVoice, rateWhatsApp, type RatedCost, type ServiceWindow } from '@/lib/rate-card';

/**
 * Every cost the platform incurs, in one table.
 *
 * Record what the provider tells you: tokens for Gemini, money for Twilio, Meta
 * and Deepgram. `amount` is the single summable column — it starts as the rate
 * card's estimate and is overwritten in place by the provider's billed figure
 * when that arrives, with `estimated` marking which you are looking at. There is
 * no second cost view to keep apart from this one.
 *
 * A message's delivery state (SID, status, error) rides on the same row: one
 * message is one charge is one row, so splitting them across two tables only
 * created a join and a chance to double-count.
 */

export type CostSource = 'sms' | 'whatsapp' | 'voice' | 'ai';
export type CostDirection = 'inbound' | 'outbound';

/** The conversation a cost was incurred on. `test`/`sandbox` never count against a tenant's cap. */
export type UsageChannel = 'sms' | 'whatsapp' | 'voice' | 'web' | 'test' | 'sandbox';

/** How an outbound message came to be sent, so spend breaks down by intent. */
export type MessageKind =
  | 'whatsapp_template' // business-initiated Content template (outside 24h window)
  | 'auto_reply' // agent free-form reply to an inbound customer message
  | 'initiation' // owner-triggered outreach from the dashboard
  | 'missed_call_followup' // voice webhook fallback after a missed call
  | 'booking_confirmation'; // written confirmation of a booking taken over the phone

export type MessageMetadata = {
  direction?: CostDirection | null;
  status?: string | null;
  price?: number | null;
  priceUnit?: string | null;
  numSegments?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
};

export type MessageCostInput = MessageMetadata & {
  twilioMessageSid: string;
  sessionId?: string | null;
  transcriptId?: string | null;
  salonId?: string | null;
  channel?: 'sms' | 'whatsapp' | null;
  messageType?: MessageKind | null;
  rawPayload?: Record<string, any> | null;
  pricedAt?: string | null;
  lastPriceLookupAt?: string | null;
  priceLookupAttempts?: number | null;
};

const STATUS_RANK: Record<string, number> = {
  accepted: 1,
  queued: 1,
  receiving: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  received: 4,
  undelivered: 4,
  failed: 4,
  canceled: 4,
  read: 5,
};

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactRecord(record: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
  );
}

function jsonRecordOrEmpty(value: Record<string, any> | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function shouldKeepExistingStatus(existing?: string | null, incoming?: string | null) {
  if (!existing || !incoming) return false;
  return (STATUS_RANK[existing] || 0) > (STATUS_RANK[incoming] || 0);
}

export function formDataToRecord(formData: FormData) {
  const payload: Record<string, string> = {};
  formData.forEach((value, key) => {
    payload[key] = typeof value === 'string' ? value : value.name;
  });
  return payload;
}

export function smsMetadataFromTwilioMessage(message: any): MessageMetadata {
  return {
    status: stringOrNull(message?.status),
    price: normalizeSmsPrice(message?.price),
    priceUnit: stringOrNull(message?.priceUnit ?? message?.price_unit),
    numSegments: numberOrNull(message?.numSegments ?? message?.num_segments),
    errorCode: stringOrNull(message?.errorCode ?? message?.error_code),
    errorMessage: stringOrNull(message?.errorMessage ?? message?.error_message),
    fromNumber: stringOrNull(message?.from),
    toNumber: stringOrNull(message?.to),
  };
}

/**
 * Look up a cost row by Twilio SID. The unique `reference` column is what makes
 * this table the dedupe index for Twilio webhook retries as well as the ledger.
 */
export async function findMessageCostBySid(twilioMessageSid: string) {
  const { data } = await supabase
    .from('costs')
    .select('id, session_id, transcript_id, direction')
    .eq('reference', twilioMessageSid)
    .maybeSingle();

  return data;
}

type ExistingCost = {
  source?: string | null;
  direction?: string | null;
  quantity?: number | null;
  service_window?: string | null;
  status?: string | null;
  estimated_amount?: number | null;
};

/**
 * Rate-card estimate for a message being written.
 *
 * SMS is re-rated on every write: the segment count and final status usually
 * arrive on a later status callback and both change the price. WhatsApp is rated
 * once, on the row's first write — the service window is only meaningful at send
 * time, so re-deriving it on each callback would re-query for no benefit.
 */
async function estimateMessageCost(
  input: MessageCostInput,
  existing: ExistingCost | null | undefined,
  effectiveStatus?: string | null
): Promise<RatedCost | null> {
  const source = input.channel ?? existing?.source ?? null;
  const direction = (input.direction ?? existing?.direction ?? null) as CostDirection | null;
  if (!direction) return null;

  if (source === 'whatsapp') {
    if (existing?.service_window) return null; // already rated
    return rateWhatsApp({
      direction,
      customerNumber: direction === 'inbound' ? input.fromNumber : input.toNumber,
      kind: input.messageType,
    });
  }

  if (source === 'sms') {
    return rateSms({
      direction,
      numSegments: input.numSegments ?? existing?.quantity,
      status: effectiveStatus,
    });
  }

  return null;
}

/**
 * Record (or update) the cost of one SMS/WhatsApp message.
 *
 * Called from every send and receive path. Twilio reports no price at send time,
 * so the row is written with the rate-card estimate and upgraded in place when
 * the status callback or the reconciliation cron supplies the billed figure.
 */
export async function recordMessageCost(input: MessageCostInput) {
  try {
    const { data: existing } = await supabase
      .from('costs')
      .select('id, status, source, direction, quantity, service_window, estimated_amount, estimated, amount')
      .eq('reference', input.twilioMessageSid)
      .maybeSingle();

    const status = shouldKeepExistingStatus(existing?.status, input.status)
      ? undefined
      : input.status;

    // `source` is NOT NULL, and Postgres checks that while forming the tuple —
    // before it can detect the conflict and turn the upsert into an update. So a
    // caller that knows only the SID (the status callback) must inherit the
    // source from the row it is updating, or the write fails outright.
    const source = input.channel ?? ((existing?.source as 'sms' | 'whatsapp' | undefined) || undefined);
    if (!source) {
      // No existing row and no channel: this SID isn't ours to price. Better to
      // skip than to insert an unclassifiable row or log a constraint violation.
      safeLog({
        type: 'integration',
        level: 'warning',
        category: 'sms',
        event: 'message_cost_unclassified',
        twilio_message_sid: input.twilioMessageSid,
      });
      return null;
    }

    const estimate = await estimateMessageCost(input, existing, status ?? existing?.status);
    const billedAmount = input.price;
    const hasBilledPrice = billedAmount !== null && billedAmount !== undefined;
    // Once a provider has told us what it actually charged, that figure stands.
    // Later callbacks routinely arrive with no Price at all, and re-running the
    // rate card on those would overwrite a confirmed amount with a guess — in
    // the wrong currency, and still flagged as confirmed.
    const alreadyBilled = existing?.estimated === false;

    // `estimated_amount` keeps the rate-card number either way, so drift between
    // the two stays measurable after the upgrade.
    const amount = hasBilledPrice ? billedAmount : alreadyBilled ? undefined : estimate?.amount;
    const currency = hasBilledPrice
      ? (input.priceUnit || 'USD').toUpperCase()
      : alreadyBilled
        ? undefined
        : estimate?.currency;

    const payload = compactRecord({
      reference: input.twilioMessageSid,
      session_id: input.sessionId,
      transcript_id: input.transcriptId,
      salon_id: input.salonId,
      source,
      channel: source,
      kind: input.messageType,
      direction: input.direction,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      status,
      quantity: input.numSegments,
      amount,
      currency,
      estimated: hasBilledPrice ? false : undefined,
      estimated_amount: estimate?.amount,
      service_window: estimate?.serviceWindow,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      raw_payload: jsonRecordOrEmpty(input.rawPayload),
      priced_at: input.pricedAt ?? (hasBilledPrice ? new Date().toISOString() : undefined),
      last_price_lookup_at: input.lastPriceLookupAt,
      price_lookup_attempts: input.priceLookupAttempts,
      updated_at: new Date().toISOString(),
    });

    const { data, error } = await supabase
      .from('costs')
      .upsert(payload, { onConflict: 'reference' })
      .select()
      .single();

    if (error) {
      safeLog({
        type: 'error',
        level: 'error',
        category: 'system',
        event: 'db_error',
        error: error?.message || String(error),
        stack: error?.stack,
        query_description: 'Record message cost',
        code: error?.code,
        twilio_message_sid: input.twilioMessageSid,
      });
      return null;
    }

    // Spend monitoring. Deliberately not awaited: this is an alert-only check
    // and must never add latency to, or fail, a message write.
    void checkTenantSpend(input.salonId);

    return data;
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Record message cost',
      twilio_message_sid: input.twilioMessageSid,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface TokenTotals {
  prompt: number;
  completion: number;
  total: number;
}

export interface RecordAiCostInput {
  salonId: string;
  sessionId?: string | null;
  model?: string | null;
  channel: UsageChannel;
  interaction?: string;
  tokens: TokenTotals;
  toolCalls?: number;
  metadata?: Record<string, any>;
}

type AiModelRate = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

/**
 * Accumulate token usage across the multiple AI calls that make up a single
 * customer interaction (the initial reply + any tool-call follow-ups).
 */
export function addTokens(a: TokenTotals, b?: { prompt?: number; completion?: number; total?: number } | null): TokenTotals {
  return {
    prompt: a.prompt + (b?.prompt || 0),
    completion: a.completion + (b?.completion || 0),
    total: a.total + (b?.total || 0),
  };
}

export const emptyTokens = (): TokenTotals => ({ prompt: 0, completion: 0, total: 0 });

export function getAiModelRate(model?: string | null): AiModelRate | null {
  const name = String(model || process.env.AI_MODEL_NAME || 'gemini-2.5-flash').toLowerCase();

  if (name.includes('gemini-3.5-flash')) {
    return { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 };
  }
  if (name.includes('gemini-2.5-flash-lite')) {
    return { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 };
  }
  if (name.includes('gemini-2.5-flash')) {
    return { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 };
  }

  const inputUsdPerMillion = Number(process.env.AI_INPUT_USD_PER_1M_TOKENS);
  const outputUsdPerMillion = Number(process.env.AI_OUTPUT_USD_PER_1M_TOKENS);
  if (Number.isFinite(inputUsdPerMillion) && Number.isFinite(outputUsdPerMillion)) {
    return { inputUsdPerMillion, outputUsdPerMillion };
  }

  return null;
}

function aiCostUsd(tokens: number, usdPerMillion: number) {
  return (tokens / 1_000_000) * usdPerMillion;
}

/**
 * Record one AI interaction.
 *
 * Gemini bills tokens, so tokens are what we store — but they are also priced
 * here rather than at read time, so `costs.amount` stays the one column that
 * sums to a tenant's real spend regardless of provider. An unrecognised model
 * leaves `amount` null and surfaces as an unpriced interaction on the dashboard.
 *
 * Best-effort: spend tracking must never break a customer reply, so all failures
 * are swallowed and logged.
 */
export async function recordAiCost(input: RecordAiCostInput): Promise<void> {
  const tokens = input.tokens || emptyTokens();
  // Nothing meaningful to record (e.g. a deduped/ignored inbound message).
  if (!input.salonId || (tokens.total === 0 && tokens.prompt === 0 && tokens.completion === 0)) {
    return;
  }

  try {
    const rate = getAiModelRate(input.model);
    const amount = rate
      ? aiCostUsd(tokens.prompt || 0, rate.inputUsdPerMillion) +
        aiCostUsd(tokens.completion || 0, rate.outputUsdPerMillion)
      : null;

    const { error } = await supabase.from('costs').insert({
      salon_id: input.salonId,
      session_id: input.sessionId || null,
      source: 'ai',
      kind: input.interaction || 'inbound_message',
      channel: input.channel,
      model: input.model || null,
      tokens_in: tokens.prompt || 0,
      tokens_out: tokens.completion || 0,
      quantity: 1,
      amount,
      currency: 'USD',
      estimated: true,
      metadata: {
        ...(input.metadata || {}),
        tool_calls: input.toolCalls || 0,
        tokens_total: tokens.total || 0,
      },
    });

    if (error) throw error;
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'warning',
      category: 'billing',
      event: 'ai_cost_record_failed',
      tenant_id: input.salonId,
      session_id: input.sessionId || undefined,
      error: error?.message || String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/** Guards against a delayed or replayed call_ended billing an implausible call. */
const MAX_BILLABLE_CALL_SECONDS = Number(process.env.MAX_BILLABLE_CALL_SECONDS || 7200);

export interface RecordVoiceCostInput {
  salonId: string;
  sessionId: string;
  seconds: number;
  /** false for a forwarded or rejected call, where Deepgram was never engaged. */
  agentHandled?: boolean;
  callSid?: string | null;
  reason?: string | null;
}

/**
 * Record the cost of one completed call.
 *
 * Voice bills two per-minute meters against the same duration — Twilio for the
 * carriage, Deepgram for the agent. Deepgram's usage API reports real spend but
 * only per project and in aggregate, so it cannot attribute a call to a tenant;
 * the rate card prices the row at hangup instead, leaving `estimated = true`.
 */
export async function recordVoiceCost(input: RecordVoiceCostInput): Promise<void> {
  if (!input.salonId || !(input.seconds > 0)) return;

  try {
    // The duration is derived from the session's age, so anything that delays or
    // replays a call_ended event would otherwise bill hours. Cap it rather than
    // trust the clock difference.
    const seconds = Math.min(input.seconds, MAX_BILLABLE_CALL_SECONDS);
    if (input.seconds > MAX_BILLABLE_CALL_SECONDS) {
      safeLog({
        type: 'integration',
        level: 'warning',
        category: 'billing',
        event: 'voice_call_duration_capped',
        tenant_id: input.salonId,
        session_id: input.sessionId,
        reported_seconds: Math.round(input.seconds),
        billed_seconds: seconds,
      });
    }

    const rated = rateVoice({ seconds, agentHandled: input.agentHandled });

    // One call is one session, so a deterministic reference makes call_ended
    // idempotent: a retried or duplicated event hits the unique index and is
    // ignored instead of billing the call twice.
    const reference = `voice:${input.callSid || input.sessionId}`;

    const { error } = await supabase.from('costs').upsert({
      salon_id: input.salonId,
      session_id: input.sessionId,
      source: 'voice',
      kind: input.agentHandled === false ? 'call_forwarded' : 'call_agent',
      channel: 'voice',
      direction: 'inbound',
      quantity: Math.round(seconds),
      amount: rated.amount,
      currency: rated.currency,
      estimated: true,
      estimated_amount: rated.amount,
      reference,
      metadata: { seconds: Math.round(seconds), reason: input.reason || null },
    }, { onConflict: 'reference', ignoreDuplicates: true });

    if (error) throw error;

    void checkTenantSpend(input.salonId);
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'warning',
      category: 'billing',
      event: 'voice_cost_record_failed',
      tenant_id: input.salonId,
      session_id: input.sessionId,
      error: error?.message || String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type CurrencyTotals = Record<string, number>;

export type UsagePreset =
  | 'this_month'
  | 'last_30_days'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'all'
  | 'custom';

export interface UsageDateRange {
  preset: UsagePreset;
  /** Inclusive start, ISO. */
  from: string;
  /** Exclusive end, ISO. */
  to: string;
  label: string;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateInput(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDay(date: Date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Resolve the date range a usage or spend view covers.
 *
 * An explicit from/to always wins and reports as a custom range; otherwise the
 * named preset applies. Ends are exclusive internally so the final day counts in
 * full, while the label shows the inclusive dates a person would expect.
 */
export function resolveUsageDateRange(input?: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}): UsageDateRange {
  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const explicitFrom = parseDateInput(input?.from);
  const explicitTo = parseDateInput(input?.to);

  if (explicitFrom || explicitTo) {
    const from = startOfUtcDay(explicitFrom || explicitTo!);
    // The date picker supplies an inclusive end date; make it exclusive.
    const to = explicitTo
      ? new Date(startOfUtcDay(explicitTo).getTime() + 24 * 60 * 60 * 1000)
      : tomorrow;
    return {
      preset: 'custom',
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${formatDay(from)} – ${formatDay(new Date(to.getTime() - 1))}`,
    };
  }

  const preset = (input?.preset || 'last_30_days') as UsagePreset;

  if (preset === 'last_month') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      preset,
      from: from.toISOString(),
      to: to.toISOString(),
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }

  if (preset === 'last_3_months' || preset === 'last_6_months') {
    const months = preset === 'last_3_months' ? 3 : 6;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
    return {
      preset,
      from: from.toISOString(),
      to: tomorrow.toISOString(),
      label: `Last ${months} months`,
    };
  }

  if (preset === 'all') {
    // Before any row could exist, so the range is genuinely unbounded.
    return { preset, from: new Date(0).toISOString(), to: tomorrow.toISOString(), label: 'All time' };
  }

  const from = new Date(tomorrow.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    preset: 'last_30_days',
    from: from.toISOString(),
    to: tomorrow.toISOString(),
    label: 'Last 30 days',
  };
}

function addCurrencyTotal(totals: CurrencyTotals, currency: string | null | undefined, amount: number | null | undefined) {
  if (!currency || amount == null || !Number.isFinite(amount)) return;
  const key = currency.toUpperCase();
  totals[key] = (totals[key] || 0) + amount;
}

/** Rows from internal harnesses are recorded but never counted as tenant activity. */
function isInternalChannel(channel?: string | null) {
  return channel === 'test' || channel === 'sandbox';
}

// --- Tenant-facing usage ---------------------------------------------------

export interface TenantChannelUsage {
  salonId: string;
  range: UsageDateRange;
  smsMessages: number;
  /** SMS segments — what SMS is actually billed per. */
  smsSegments: number;
  whatsAppMessages: number;
  calls: number;
  callSeconds: number;
  inbound: number;
  outbound: number;
  aiInteractions: number;
  tokens: number;
}

/**
 * What a salon actually used over a date range.
 *
 * Deliberately carries no money. A tenant is billed on their plan, not on our
 * provider rates, and showing them per-segment costs would expose the platform's
 * margin — spend lives in getPlatformSpend(), behind the admin check.
 */
export async function getTenantChannelUsage(
  salonId: string,
  range: UsageDateRange = resolveUsageDateRange()
): Promise<TenantChannelUsage | null> {
  try {
    const { data: rows, error } = await supabase
      .from('costs')
      .select('source, direction, channel, quantity, tokens_in, tokens_out')
      .eq('salon_id', salonId)
      .gte('created_at', range.from)
      .lt('created_at', range.to)
      .range(0, 9999);

    if (error) return null;

    const usage: TenantChannelUsage = {
      salonId,
      range,
      smsMessages: 0,
      smsSegments: 0,
      whatsAppMessages: 0,
      calls: 0,
      callSeconds: 0,
      inbound: 0,
      outbound: 0,
      aiInteractions: 0,
      tokens: 0,
    };

    for (const row of rows || []) {
      if (isInternalChannel(row.channel)) continue;

      if (row.source === 'ai') {
        usage.aiInteractions += 1;
        usage.tokens += numberOrZero(row.tokens_in) + numberOrZero(row.tokens_out);
        continue;
      }

      if (row.source === 'voice') {
        usage.calls += 1;
        usage.callSeconds += numberOrZero(row.quantity);
        continue;
      }

      if (row.source === 'whatsapp') {
        usage.whatsAppMessages += 1;
      } else {
        usage.smsMessages += 1;
        // Segment count arrives on a later callback; treat an unknown as one.
        usage.smsSegments += numberOrZero(row.quantity) || 1;
      }

      if (row.direction === 'inbound') usage.inbound += 1;
      if (row.direction === 'outbound') usage.outbound += 1;
    }

    return usage;
  } catch {
    return null;
  }
}

// --- Operator-facing spend -------------------------------------------------

export interface SourceSpend {
  events: number;
  inbound: number;
  outbound: number;
  /** Segments for SMS, seconds for voice, one per message or AI call otherwise. */
  quantity: number;
  byCurrency: CurrencyTotals;
}

export interface SalonSpend {
  salonId: string;
  salonName: string;
  events: number;
  totalByCurrency: CurrencyTotals;
}

export interface PlatformSpend {
  range: UsageDateRange;
  /** Start of the range, kept for headers that label the period. */
  monthStart: string;
  /** Every recorded cost, in the currency the provider reported it in. */
  totalByCurrency: CurrencyTotals;
  /** The part backed by a provider's billed figure rather than the rate card. */
  billedByCurrency: CurrencyTotals;
  estimatedByCurrency: CurrencyTotals;
  bySource: Record<CostSource, SourceSpend>;
  bySalon: SalonSpend[];
  ai: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    interactions: number;
    unpricedInteractions: number;
  };
  /** Messages still carrying only the rate-card estimate. */
  awaitingBilledPrice: number;
}

function emptySourceSpend(): SourceSpend {
  return { events: 0, inbound: 0, outbound: 0, quantity: 0, byCurrency: {} };
}

/**
 * Platform-wide spend across every tenant — the operator's view.
 *
 * One table means one query: AI, SMS, WhatsApp and voice all sum the same
 * column, in whatever currency each provider billed.
 */
export async function getPlatformSpend(
  range: UsageDateRange = resolveUsageDateRange()
): Promise<PlatformSpend | null> {
  try {
    const [{ data: rows, error }, { data: profiles }] = await Promise.all([
      supabase
        .from('costs')
        .select('salon_id, source, direction, channel, quantity, amount, currency, estimated, tokens_in, tokens_out')
        .gte('created_at', range.from)
        .lt('created_at', range.to)
        .range(0, 99999),
      supabase.from('business_profiles').select('id, name'),
    ]);

    if (error) return null;

    const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.name]));
    const salons = new Map<string, SalonSpend>();

    const spend: PlatformSpend = {
      range,
      monthStart: range.from,
      totalByCurrency: {},
      billedByCurrency: {},
      estimatedByCurrency: {},
      bySource: {
        sms: emptySourceSpend(),
        whatsapp: emptySourceSpend(),
        voice: emptySourceSpend(),
        ai: emptySourceSpend(),
      },
      bySalon: [],
      ai: { inputTokens: 0, outputTokens: 0, totalTokens: 0, interactions: 0, unpricedInteractions: 0 },
      awaitingBilledPrice: 0,
    };

    for (const row of rows || []) {
      if (isInternalChannel(row.channel)) continue;

      const source = (row.source as CostSource) || 'sms';
      const bucket = spend.bySource[source] || (spend.bySource[source] = emptySourceSpend());
      const amount = row.amount == null ? null : Number(row.amount);
      const currency = row.currency || 'USD';

      bucket.events += 1;
      if (row.direction === 'inbound') bucket.inbound += 1;
      if (row.direction === 'outbound') bucket.outbound += 1;
      bucket.quantity += numberOrZero(row.quantity) || (source === 'sms' ? 1 : 0);

      if (row.salon_id) {
        let salon = salons.get(row.salon_id);
        if (!salon) {
          salon = {
            salonId: row.salon_id,
            salonName: names.get(row.salon_id) || 'Unnamed salon',
            events: 0,
            totalByCurrency: {},
          };
          salons.set(row.salon_id, salon);
        }
        salon.events += 1;
        addCurrencyTotal(salon.totalByCurrency, currency, amount);
      }

      if (amount != null && Number.isFinite(amount)) {
        addCurrencyTotal(bucket.byCurrency, currency, amount);
        addCurrencyTotal(spend.totalByCurrency, currency, amount);
        addCurrencyTotal(
          row.estimated ? spend.estimatedByCurrency : spend.billedByCurrency,
          currency,
          amount
        );
      }

      if (source === 'ai') {
        const inputTokens = numberOrZero(row.tokens_in);
        const outputTokens = numberOrZero(row.tokens_out);
        spend.ai.inputTokens += inputTokens;
        spend.ai.outputTokens += outputTokens;
        spend.ai.totalTokens += inputTokens + outputTokens;
        spend.ai.interactions += 1;
        if (amount == null) spend.ai.unpricedInteractions += 1;
      } else if (row.estimated && (source === 'sms' || source === 'whatsapp')) {
        spend.awaitingBilledPrice += 1;
      }
    }

    // Rank by spend across every currency, not by USD alone: this account's
    // confirmed costs are GBP and only the unconfirmed estimates are USD, so a
    // USD-only sort would order salons by the least reliable half of their bill.
    // Summing currencies is invalid for display but fine as an ordering key.
    const sortKey = (salon: SalonSpend) =>
      Object.values(salon.totalByCurrency).reduce((total, amount) => total + amount, 0);

    spend.bySalon = [...salons.values()].sort(
      (a, b) => sortKey(b) - sortKey(a) || b.events - a.events
    );

    return spend;
  } catch {
    return null;
  }
}
