import { supabase } from './supabase';
import { safeLog } from '@/lib/logger';

export type UsageChannel = 'sms' | 'voice' | 'web' | 'test' | 'sandbox';

export interface TokenTotals {
  prompt: number;
  completion: number;
  total: number;
}

export interface RecordTokenUsageInput {
  salonId: string;
  sessionId?: string | null;
  model?: string | null;
  channel: UsageChannel;
  interaction?: string;
  tokens: TokenTotals;
  toolCalls?: number;
  metadata?: Record<string, any>;
}

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

/**
 * Append one row to the AI usage ledger and bump the per-session rollup.
 * Best-effort: API spend tracking must never break a customer reply, so all
 * failures are swallowed (and logged).
 */
export async function recordTokenUsage(input: RecordTokenUsageInput): Promise<void> {
  const tokens = input.tokens || emptyTokens();
  // Nothing meaningful to record (e.g. a deduped/ignored inbound message).
  if (!input.salonId || (tokens.total === 0 && tokens.prompt === 0 && tokens.completion === 0)) {
    return;
  }

  try {
    // Primary path: atomic ledger insert + session rollup via the SQL function.
    const { error: rpcError } = await supabase.rpc('record_token_usage', {
      p_salon_id: input.salonId,
      p_session_id: input.sessionId || null,
      p_model: input.model || null,
      p_channel: input.channel,
      p_interaction: input.interaction || 'inbound_message',
      p_tokens_prompt: tokens.prompt || 0,
      p_tokens_completion: tokens.completion || 0,
      p_tokens_total: tokens.total || 0,
      p_tool_calls: input.toolCalls || 0,
      p_metadata: input.metadata || null,
    });

    if (!rpcError) return;

    // Fallback (e.g. function not deployed yet): plain insert into the ledger.
    await supabase.from('token_usage').insert({
      salon_id: input.salonId,
      session_id: input.sessionId || null,
      model: input.model || null,
      channel: input.channel,
      interaction: input.interaction || 'inbound_message',
      tokens_prompt: tokens.prompt || 0,
      tokens_completion: tokens.completion || 0,
      tokens_total: tokens.total || 0,
      tool_calls: input.toolCalls || 0,
      metadata: input.metadata || null,
    });
  } catch (error: any) {
    safeLog({
      level: 'warning',
      category: 'billing',
      event: 'token_usage_record_failed',
      tenant_id: input.salonId,
      session_id: input.sessionId || undefined,
      error: error?.message || String(error),
    });
  }
}

export type CurrencyTotals = Record<string, number>;

export interface TenantApiSpend {
  salonId: string;
  monthStart: string;
  ai: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
    interactions: number;
    toolCalls: number;
    unpricedInteractions: number;
  };
  twilio: {
    inboundMessages: number;
    outboundMessages: number;
    totalMessages: number;
    inboundCostByCurrency: CurrencyTotals;
    outboundCostByCurrency: CurrencyTotals;
    totalCostByCurrency: CurrencyTotals;
    unpricedMessages: number;
  };
}

type AiModelRate = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const CUSTOMER_CHANNELS: UsageChannel[] = ['sms', 'voice', 'web'];

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function emptyCurrencyTotals(): CurrencyTotals {
  return {};
}

function addCurrencyTotal(totals: CurrencyTotals, currency: string | null | undefined, amount: number | null | undefined) {
  if (!currency || amount == null || !Number.isFinite(amount)) return;
  const key = currency.toUpperCase();
  totals[key] = (totals[key] || 0) + amount;
}

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
 * Current calendar-month API spend for a tenant.
 *
 * AI cost is estimated from recorded input/output tokens and Gemini pricing.
 * Twilio cost comes from Twilio's message price fields once callbacks or the
 * pricing reconciliation job have populated the SMS ledger.
 */
export async function getTenantApiSpend(salonId: string): Promise<TenantApiSpend | null> {
  const monthStart = monthStartIso();

  try {
    const [{ data: aiRows, error: aiError }, { data: smsRows, error: smsError }] = await Promise.all([
      supabase
        .from('token_usage')
        .select('model, channel, tokens_prompt, tokens_completion, tokens_total, tool_calls')
        .eq('salon_id', salonId)
        .gte('created_at', monthStart)
        .in('channel', CUSTOMER_CHANNELS)
        .range(0, 9999),
      supabase
        .from('sms_messages')
        .select('direction, price, price_unit')
        .eq('salon_id', salonId)
        .gte('created_at', monthStart)
        .range(0, 9999),
    ]);

    if (aiError || smsError) return null;

    const spend: TenantApiSpend = {
      salonId,
      monthStart,
      ai: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: 0,
        interactions: 0,
        toolCalls: 0,
        unpricedInteractions: 0,
      },
      twilio: {
        inboundMessages: 0,
        outboundMessages: 0,
        totalMessages: 0,
        inboundCostByCurrency: emptyCurrencyTotals(),
        outboundCostByCurrency: emptyCurrencyTotals(),
        totalCostByCurrency: emptyCurrencyTotals(),
        unpricedMessages: 0,
      },
    };

    for (const row of aiRows || []) {
      const inputTokens = Number(row.tokens_prompt || 0);
      const outputTokens = Number(row.tokens_completion || 0);
      const totalTokens = Number(row.tokens_total || inputTokens + outputTokens);
      const rate = getAiModelRate(row.model);

      spend.ai.inputTokens += inputTokens;
      spend.ai.outputTokens += outputTokens;
      spend.ai.totalTokens += totalTokens;
      spend.ai.interactions += 1;
      spend.ai.toolCalls += Number(row.tool_calls || 0);

      if (!rate) {
        spend.ai.unpricedInteractions += 1;
        continue;
      }

      spend.ai.inputCostUsd += aiCostUsd(inputTokens, rate.inputUsdPerMillion);
      spend.ai.outputCostUsd += aiCostUsd(outputTokens, rate.outputUsdPerMillion);
    }

    spend.ai.totalCostUsd = spend.ai.inputCostUsd + spend.ai.outputCostUsd;

    for (const row of smsRows || []) {
      const direction = row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null;
      const price = row.price == null ? null : Number(row.price);
      const currency = row.price_unit || null;

      spend.twilio.totalMessages += 1;
      if (direction === 'inbound') spend.twilio.inboundMessages += 1;
      if (direction === 'outbound') spend.twilio.outboundMessages += 1;

      if (price == null || !Number.isFinite(price) || !currency) {
        spend.twilio.unpricedMessages += 1;
        continue;
      }

      if (direction === 'inbound') addCurrencyTotal(spend.twilio.inboundCostByCurrency, currency, price);
      if (direction === 'outbound') addCurrencyTotal(spend.twilio.outboundCostByCurrency, currency, price);
      addCurrencyTotal(spend.twilio.totalCostByCurrency, currency, price);
    }
    return spend;
  } catch {
    return null;
  }
}
