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
 * Append one row to the token_usage ledger and bump the per-session rollup.
 * Best-effort: token accounting must never break a customer reply, so all
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

export interface SalonUsage {
  salonId: string;
  plan: string | null;
  monthlyTokenLimit: number | null;
  tokensUsedThisMonth: number;
  /** null when there is no limit (unlimited / enterprise). */
  usageRatio: number | null;
  overLimit: boolean;
}

/**
 * Current calendar-month usage for a salon, read from the
 * salon_token_usage_current_month view.
 */
export async function getSalonUsage(salonId: string): Promise<SalonUsage | null> {
  try {
    const { data, error } = await supabase
      .from('salon_token_usage_current_month')
      .select('salon_id, plan, monthly_token_limit, tokens_used_this_month')
      .eq('salon_id', salonId)
      .maybeSingle();

    if (error || !data) return null;

    const limit = data.monthly_token_limit != null ? Number(data.monthly_token_limit) : null;
    const used = Number(data.tokens_used_this_month || 0);
    const usageRatio = limit && limit > 0 ? used / limit : null;

    return {
      salonId: data.salon_id,
      plan: data.plan ?? null,
      monthlyTokenLimit: limit,
      tokensUsedThisMonth: used,
      usageRatio,
      overLimit: usageRatio != null && usageRatio >= 1,
    };
  } catch {
    return null;
  }
}
