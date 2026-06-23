import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase, TEST_UI_TRANSCRIPTS_TABLE } from './supabase';
import { getSalonUsage } from './token-usage';
import { safeLog } from '@/lib/logger';
import { ERROR_FALLBACK_REPLY } from './reply-format';

/**
 * Lightweight observer / supervisor agent.
 *
 * Runs *after* the customer-facing reply has been dispatched, so it never adds
 * latency to the conversation. Every turn it applies cheap deterministic
 * heuristics (loops, repeated/failed tool calls, confusion, plan-limit). On a
 * periodic checkpoint it also asks a small LLM for a second opinion on harder
 * signals (off-topic drift, hallucination, confusion). Findings are written to
 * the observer_flags table for owner/admin review.
 */

export type ObserverFlagType =
  | 'loop'
  | 'off_topic'
  | 'tool_failure'
  | 'tool_thrash'
  | 'confusion'
  | 'limit'
  | 'hallucination';

export type ObserverSeverity = 'info' | 'warning' | 'critical';

export interface ObserverContext {
  salonId: string;
  sessionId: string;
  channel: 'sms' | 'voice' | 'web' | 'test' | 'sandbox';
  userMessage: string;
  reply: string;
  status: string;
  toolTrace?: Array<{ name: string; result: string }>;
  toolCallCount?: number;
}

interface PendingFlag {
  flagType: ObserverFlagType;
  severity: ObserverSeverity;
  source: 'heuristic' | 'llm';
  detail: string;
  metadata?: Record<string, any>;
}

const MAX_TOOL_CALLS = 5; // mirrors the agent loop cap
const LLM_CHECKPOINT_EVERY = 3; // run the LLM every Nth user turn when heuristics are quiet
const genAI = process.env.AI_MODEL_API_KEY
  ? new GoogleGenerativeAI(process.env.AI_MODEL_API_KEY)
  : null;

function normalize(text: string): string {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isToolFailure(result: string): boolean {
  const r = normalize(result);
  // Note: availability returning "None found." is a normal outcome, not a failure,
  // so it is deliberately NOT treated as an anomaly here.
  return (
    r.startsWith('failed') ||
    r.includes('failed:') ||
    r.includes('not found') ||
    r === 'unknown tool.'
  );
}

export interface ObserverFlagRow {
  id: string;
  created_at: string;
  salon_id: string | null;
  session_id: string | null;
  flag_type: string;
  severity: ObserverSeverity;
  source: string;
  detail: string | null;
  resolved: boolean;
}

/** Flags raised on a single conversation (newest first). */
export async function getSessionObserverFlags(sessionId: string, limit = 20): Promise<ObserverFlagRow[]> {
  try {
    const { data } = await supabase
      .from('observer_flags')
      .select('id, created_at, salon_id, session_id, flag_type, severity, source, detail, resolved')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []) as ObserverFlagRow[];
  } catch {
    return [];
  }
}

/**
 * Recent flags for a salon — used by the dashboard review panel.
 * Internal 'sandbox'/'test' channels are filtered out so they don't clutter
 * the owner's review of real customer conversations.
 */
export async function getRecentObserverFlags(
  salonId: string,
  opts: { limit?: number; onlyUnresolved?: boolean } = {}
): Promise<ObserverFlagRow[]> {
  const limit = opts.limit ?? 15;
  try {
    let query = supabase
      .from('observer_flags')
      .select('id, created_at, salon_id, session_id, flag_type, severity, source, detail, resolved, metadata')
      .eq('salon_id', salonId)
      .order('created_at', { ascending: false })
      .limit(limit * 3);
    if (opts.onlyUnresolved) query = query.eq('resolved', false);
    const { data } = await query;
    const internal = new Set(['sandbox', 'test']);
    return ((data || []) as Array<ObserverFlagRow & { metadata?: any }>)
      .filter(row => !internal.has(row?.metadata?.channel))
      .slice(0, limit) as ObserverFlagRow[];
  } catch {
    return [];
  }
}

export async function logObserverFlag(input: {
  salonId: string;
  sessionId: string;
  flagType: ObserverFlagType;
  severity: ObserverSeverity;
  source: 'heuristic' | 'llm';
  detail: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await supabase.from('observer_flags').insert({
      salon_id: input.salonId,
      session_id: input.sessionId,
      flag_type: input.flagType,
      severity: input.severity,
      source: input.source,
      detail: input.detail,
      metadata: input.metadata || null,
    });
    safeLog({
      level: input.severity === 'critical' ? 'error' : input.severity === 'warning' ? 'warning' : 'info',
      category: 'observer',
      event: 'observer_flag',
      tenant_id: input.salonId,
      session_id: input.sessionId,
      flag_type: input.flagType,
      severity: input.severity,
      source: input.source,
      detail: input.detail,
    });
  } catch (error: any) {
    safeLog({
      level: 'warning',
      category: 'observer',
      event: 'observer_flag_failed',
      tenant_id: input.salonId,
      session_id: input.sessionId,
      error: error?.message || String(error),
    });
  }
}

async function fetchRecentTranscript(sessionId: string, table: string, limit = 12) {
  const { data } = await supabase
    .from(table)
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse() as Array<{ role: string; content: string }>;
}

/** Accurate count of user turns for this session (not just the recent window). */
async function countUserTurns(sessionId: string, table: string): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('role', 'user');
  return count || 0;
}

function runHeuristics(
  ctx: ObserverContext,
  recent: Array<{ role: string; content: string }>
): PendingFlag[] {
  const flags: PendingFlag[] = [];
  const toolTrace = ctx.toolTrace || [];

  // 1. Tool failures this turn.
  const failures = toolTrace.filter(t => isToolFailure(t.result));
  if (failures.length > 0) {
    const byName: Record<string, number> = {};
    for (const f of failures) byName[f.name] = (byName[f.name] || 0) + 1;
    const repeated = Object.entries(byName).some(([, n]) => n >= 2);
    flags.push({
      flagType: 'tool_failure',
      severity: repeated ? 'critical' : 'warning',
      source: 'heuristic',
      detail: `Tool call(s) failed this turn: ${failures.map(f => f.name).join(', ')}`,
      metadata: { failures: failures.map(f => ({ name: f.name, result: f.result })) },
    });
  }

  // 2. Tool thrash — hit the per-turn tool-call ceiling.
  if ((ctx.toolCallCount || 0) >= MAX_TOOL_CALLS) {
    flags.push({
      flagType: 'tool_thrash',
      severity: 'warning',
      source: 'heuristic',
      detail: `Agent reached the tool-call limit (${MAX_TOOL_CALLS}) in a single turn.`,
      metadata: { toolCallCount: ctx.toolCallCount },
    });
  }

  // 3. Confusion — generic error fallback was returned to the client.
  if (normalize(ctx.reply) === normalize(ERROR_FALLBACK_REPLY)) {
    flags.push({
      flagType: 'confusion',
      severity: 'warning',
      source: 'heuristic',
      detail: 'Agent returned the generic error fallback instead of a real reply.',
    });
  }

  // 4. Loop — the new reply repeats an *earlier* assistant/draft message verbatim.
  // The current reply has already been persisted to the transcript before the
  // observer runs, so it appears once in `recent`; a genuine loop means it shows
  // up at least twice (current + an earlier identical reply).
  const priorAssistant = recent
    .filter(m => m.role === 'assistant' || m.role === 'draft')
    .map(m => normalize(m.content));
  const replyNorm = normalize(ctx.reply);
  if (replyNorm && priorAssistant.filter(c => c === replyNorm).length >= 2) {
    flags.push({
      flagType: 'loop',
      severity: 'warning',
      source: 'heuristic',
      detail: 'Agent repeated a previous reply almost verbatim (possible loop).',
    });
  }

  return flags;
}

function buildLlmModel() {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction:
      'You are a QA supervisor monitoring a salon booking assistant ("Sophia") talking to a customer over SMS. ' +
      'Sophia should only help with bookings, salon services/pricing, opening hours, and salon FAQs. ' +
      'Review the recent exchange and decide whether there is an anomaly the salon owner should review: ' +
      'a loop or repetition, confusion/self-contradiction, drifting off-topic away from salon matters, ' +
      'mishandling a failed tool call, or stating facts that look fabricated (hallucination). ' +
      'Respond with STRICT minified JSON only, no prose: ' +
      '{"anomaly":boolean,"type":"loop|confusion|off_topic|tool_failure|hallucination|none","severity":"info|warning|critical","detail":"short reason"}. ' +
      'If the conversation looks healthy, return {"anomaly":false,"type":"none","severity":"info","detail":""}.',
  });
}

async function runLlmCheck(
  ctx: ObserverContext,
  recent: Array<{ role: string; content: string }>
): Promise<PendingFlag | null> {
  const model = buildLlmModel();
  if (!model) return null;

  const transcript = recent
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
  const prompt = `Recent conversation:\n${transcript}\n\nLatest customer message: ${ctx.userMessage}\nSophia's reply: ${ctx.reply}\n\nReturn the JSON verdict.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const verdict = JSON.parse(match[0]);
    if (!verdict?.anomaly) return null;

    const type: ObserverFlagType = ['loop', 'confusion', 'off_topic', 'tool_failure', 'hallucination'].includes(verdict.type)
      ? verdict.type
      : 'confusion';
    const severity: ObserverSeverity = ['info', 'warning', 'critical'].includes(verdict.severity)
      ? verdict.severity
      : 'warning';

    return {
      flagType: type,
      severity,
      source: 'llm',
      detail: String(verdict.detail || 'LLM flagged a conversation anomaly.').slice(0, 500),
    };
  } catch (error: any) {
    safeLog({
      level: 'warning',
      category: 'observer',
      event: 'observer_llm_failed',
      tenant_id: ctx.salonId,
      session_id: ctx.sessionId,
      error: error?.message || String(error),
    });
    return null;
  }
}

export async function runObserver(ctx: ObserverContext): Promise<void> {
  try {
    const table = ctx.channel === 'sandbox' ? TEST_UI_TRANSCRIPTS_TABLE : 'transcripts';
    const recent = await fetchRecentTranscript(ctx.sessionId, table);

    const flags = runHeuristics(ctx, recent);

    // Plan-limit check (independent of the conversation content).
    const usage = await getSalonUsage(ctx.salonId);
    if (usage && usage.usageRatio != null) {
      if (usage.overLimit) {
        flags.push({
          flagType: 'limit',
          severity: 'critical',
          source: 'heuristic',
          detail: `Salon is over its monthly token limit (${usage.tokensUsedThisMonth}/${usage.monthlyTokenLimit}).`,
          metadata: { plan: usage.plan, used: usage.tokensUsedThisMonth, limit: usage.monthlyTokenLimit },
        });
      } else if (usage.usageRatio >= 0.9) {
        flags.push({
          flagType: 'limit',
          severity: 'warning',
          source: 'heuristic',
          detail: `Salon has used ${Math.round(usage.usageRatio * 100)}% of its monthly token limit.`,
          metadata: { plan: usage.plan, used: usage.tokensUsedThisMonth, limit: usage.monthlyTokenLimit },
        });
      }
    }

    // Periodic LLM checkpoint, only when cheap heuristics are quiet (saves cost).
    const conversationalFlags = flags.filter(f => f.flagType !== 'limit');
    const llmEnabled = process.env.OBSERVER_LLM_DISABLED !== 'true';
    if (llmEnabled && conversationalFlags.length === 0) {
      const userTurns = await countUserTurns(ctx.sessionId, table);
      const isCheckpoint = userTurns >= 3 && userTurns % LLM_CHECKPOINT_EVERY === 0;
      if (isCheckpoint) {
        const llmFlag = await runLlmCheck(ctx, recent);
        if (llmFlag) flags.push(llmFlag);
      }
    }

    for (const flag of flags) {
      await logObserverFlag({
        salonId: ctx.salonId,
        sessionId: ctx.sessionId,
        flagType: flag.flagType,
        severity: flag.severity,
        source: flag.source,
        detail: flag.detail,
        metadata: { ...(flag.metadata || {}), channel: ctx.channel },
      });
    }
  } catch (error: any) {
    safeLog({
      level: 'warning',
      category: 'observer',
      event: 'observer_failed',
      tenant_id: ctx.salonId,
      session_id: ctx.sessionId,
      error: error?.message || String(error),
    });
  }
}
