import { agentTools, buildSystemPrompt } from '@/lib/agent';
import { getAgentName } from '@/lib/agent-name';
import type { ClientProfile } from '@/lib/client-profile';

/**
 * Deepgram Voice Agent API — Settings payload builder.
 *
 * Deepgram runs the STT -> LLM -> TTS loop; we supply the brain's configuration.
 * `agent.think.prompt` and `agent.think.functions` are provider-agnostic
 * top-level fields, so the exact system prompt and the exact 8 tool schemas the
 * SMS/WhatsApp pipeline already uses port across untouched — one agent, three
 * channels, one place to change its behaviour.
 */

export const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

// Twilio Media Streams are 8kHz mu-law in both directions. Matching that on
// both sides of Deepgram makes the bridge a byte passthrough — no resampling,
// no added latency, no audio quality lost to a needless conversion.
const TELEPHONY_AUDIO = {
  input: { encoding: 'mulaw', sample_rate: 8000 },
  output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
};

/**
 * Gemini's `SchemaType` enum members are the lowercase JSON Schema type names
 * ('object', 'string', ...), so the declarations are already in the shape
 * Deepgram expects. This flattens the Gemini `[{ functionDeclarations: [...] }]`
 * wrapper and nothing else — keeping one canonical tool definition.
 */
export function deepgramFunctions(toolEndpoint?: VoiceSettingsInput['toolEndpoint']) {
  return agentTools.flatMap((t: any) => t.functionDeclarations).map((fn: any) => ({
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
    ...(toolEndpoint
      ? { endpoint: { url: toolEndpoint.url, method: 'POST', headers: toolEndpoint.headers || {} } }
      : {}),
  }));
}

export interface VoiceSettingsInput {
  salon: any;
  workers?: any[];
  faqs?: any[];
  bookingState?: any;
  client?: ClientProfile | null;
  /**
   * When given, every function is configured for **server-side** execution:
   * Deepgram calls this URL itself instead of asking the client to run the tool.
   * That is what keeps the bridge dumb — it never needs Supabase, Cal.com, or
   * any of the booking logic, so it can live on a different host entirely.
   */
  toolEndpoint?: { url: string; headers?: Record<string, string> };
}

export function buildVoiceSystemPrompt({ salon, workers, faqs, bookingState, client }: VoiceSettingsInput): string {
  return buildSystemPrompt(salon, workers, faqs, bookingState, { channel: 'voice', client });
}

export function buildVoiceGreeting(salon: any, client?: ClientProfile | null): string {
  const salonName = (typeof salon?.name === 'string' && salon.name.trim()) || 'the salon';
  const firstName = typeof client?.first_name === 'string' ? client.first_name.trim() : '';
  if (firstName) return `Hello ${firstName}, you've reached ${salonName}. This is ${getAgentName(salon)} — how can I help?`;
  return `Hello, you've reached ${salonName}. This is ${getAgentName(salon)} — how can I help?`;
}

/**
 * The Settings message sent as the first frame on the Deepgram socket.
 *
 * Model comes from AI_MODEL_NAME so voice and text never drift onto different
 * Gemini versions; DEEPGRAM_VOICE_MODEL overrides it for voice alone.
 */
export function buildVoiceAgentSettings(input: VoiceSettingsInput) {
  const functions = deepgramFunctions(input.toolEndpoint);
  return {
    type: 'Settings',
    audio: TELEPHONY_AUDIO,
    agent: {
      language: 'en',
      listen: {
        provider: { type: 'deepgram', model: process.env.DEEPGRAM_LISTEN_MODEL || 'flux-general-en' },
      },
      think: {
        provider: {
          type: 'google',
          model: process.env.DEEPGRAM_VOICE_MODEL || process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
        },
        prompt: buildVoiceSystemPrompt(input),
        functions,
      },
      speak: {
        // Pandora is Aura-2's British female voice. Thalia (the previous
        // default) is American, which reads as an offshore call centre to a
        // London salon's clients. Neither escapes the 8kHz phone codec —
        // accent is the part that's actually ours to choose.
        provider: { type: 'deepgram', model: process.env.DEEPGRAM_SPEAK_MODEL || 'aura-2-pandora-en' },
      },
      greeting: buildVoiceGreeting(input.salon, input.client),
    },
  };
}
