import { supabase, getFAQs, getWorkers } from '@/lib/supabase';
import { executeToolCall, type ToolContext } from '@/lib/tool-handler';
import { safeLog } from '@/lib/logger';

/**
 * Executes one Deepgram voice-agent function call against the same tool
 * implementations the SMS/WhatsApp pipeline uses.
 *
 * Voice differs from text in one structural way: Deepgram owns the LLM loop, so
 * there is no place for us to swap the system prompt mid-conversation. Where
 * the text pipeline reacts to `update_booking_state` by rebuilding the prompt,
 * here we persist the state to `sessions.metadata.booking_state` and return it
 * to the model as text. The next turn's prompt is Deepgram's, unchanged — which
 * is why the tool result spells the locked fields back out.
 */
export interface VoiceToolCall {
  salonId: string;
  sessionId: string;
  customerPhone: string;
  name: string;
  args: any;
}

export async function runVoiceToolCall({
  salonId,
  sessionId,
  customerPhone,
  name,
  args,
}: VoiceToolCall): Promise<string> {
  const [{ data: session }, { data: salon }, workers, faqs] = await Promise.all([
    supabase.from('sessions').select('id, metadata').eq('id', sessionId).single(),
    supabase.from('business_profiles').select('*').eq('id', salonId).single(),
    getWorkers(salonId),
    getFAQs(salonId),
  ]);

  if (!salon) return 'Failed: salon not found.';

  const bookingState = (session?.metadata as any)?.booking_state || {};

  const ctx: ToolContext = {
    salonId,
    sessionId,
    customerPhone,
    salon,
    workers,
    faqs,
    salonServices: salon.services,
    channel: 'voice',
  };

  const { toolResult, updatedBookingState } = await executeToolCall(name, args, ctx, bookingState);

  if (updatedBookingState) {
    await supabase
      .from('sessions')
      .update({
        metadata: { ...((session?.metadata as any) || {}), booking_state: updatedBookingState },
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    // Deepgram's prompt is fixed for the life of the call, so the only way the
    // model learns what's now locked in is through this result string.
    const locked = ['service', 'date', 'time', 'worker']
      .filter((k) => updatedBookingState[k])
      .map((k) => `${k}: ${updatedBookingState[k]}`)
      .join(', ');
    if (locked) {
      return `${toolResult} Confirmed so far — ${locked}. Do not ask for these again.`;
    }
  }

  return toolResult;
}

/**
 * Deepgram sends `FunctionCallRequest` with one or more functions; each needs a
 * `FunctionCallResponse` carrying the same id. A thrown tool error is returned
 * as spoken-safe text rather than propagated — a failed tool must not drop the
 * call.
 */
export async function handleFunctionCallRequest(
  message: any,
  ctx: { salonId: string; sessionId: string; customerPhone: string }
): Promise<any[]> {
  const functions = Array.isArray(message?.functions) ? message.functions : [];

  return Promise.all(
    functions.map(async (fn: any) => {
      let content: string;
      try {
        const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : fn.arguments || {};
        content = await runVoiceToolCall({ ...ctx, name: fn.name, args });
      } catch (error: any) {
        safeLog({
          type: 'error',
          level: 'error',
          category: 'tool',
          event: 'voice_tool_failed',
          tool_name: fn?.name,
          tenant_id: ctx.salonId,
          session_id: ctx.sessionId,
          error: error?.message || String(error),
          stack: error?.stack,
        });
        content = "Failed: that didn't work just now. Tell the caller you'll have the team follow up.";
      }
      return { type: 'FunctionCallResponse', id: fn.id, name: fn.name, content };
    })
  );
}
