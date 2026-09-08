export interface Turn {
  role: 'customer' | 'sophia';
  content: string;
}

export interface ToolCall {
  name: string;
  args: any;
  result: string;
}

export interface RunRecord {
  turns: Turn[];
  tools: ToolCall[];
  /** Turns where the model produced tool calls but no words. Dead air on a call. */
  silentTurns?: number;
}

export interface Scenario {
  name: string;
  goal: string;
  checks: CheckName[];
}

export type CheckName = keyof typeof checks;

const agentText = (r: RunRecord) => r.turns.filter(t => t.role === 'sophia').map(t => t.content).join('\n').toLowerCase();

/** Times a tool actually returned, as HH:mm. */
function offeredSlots(r: RunRecord): string[] {
  const slots: string[] = [];
  for (const t of r.tools) {
    if (t.name !== 'check_availability') continue;
    for (const m of t.result.matchAll(/\b([0-2]?\d:[0-5]\d)\b/g)) slots.push(m[1]);
  }
  return slots;
}

const UNAVAILABLE_PHRASES = [
  "isn't available", 'is not available', 'not available', 'fully booked',
  'no longer available', "isn't free", 'unavailable',
];

const BRUSH_OFF = 'i can only help with appointments and salon questions here';

/**
 * Each check returns null when it passes, or a one-line reason when it fails.
 * They read the transcript and the tool trace together — the tool trace is the
 * half that was invisible during the real calls, and it's where the interesting
 * failures actually live.
 */
export const checks = {
  calledCheckAvailability: (r: RunRecord) =>
    r.tools.some(t => t.name === 'check_availability')
      ? null
      : 'never called check_availability',

  /**
   * The headline failure from the first live call: 46 seconds of silence, then
   * "that isn't available" for a slot that was free, with no tool having run.
   */
  neverClaimsAvailabilityWithoutChecking: (r: RunRecord) => {
    const said = agentText(r);
    const claimed = UNAVAILABLE_PHRASES.find(p => said.includes(p));
    if (!claimed) return null;
    const checked = r.tools.some(t => t.name === 'check_availability' && !/^failed/i.test(t.result));
    return checked ? null : `said "${claimed}" but check_availability never returned a result`;
  },

  /** She booked 3pm off a vague "openings from nine AM". Cal returned 409. */
  onlyBooksOfferedTimes: (r: RunRecord) => {
    const booked = r.tools.filter(t => t.name === 'book_direct' || t.name === 'book_appointment');
    if (booked.length === 0) return null;
    const offered = offeredSlots(r);
    if (offered.length === 0) return 'booked without any slots having been offered';
    const bad = booked.find(t => t.args?.time && !offered.includes(t.args.time));
    return bad ? `booked ${bad.args.time}, which was not in the offered slots (${offered.join(', ')})` : null;
  },

  /**
   * Covers how a time is actually said out loud: "3pm", "15:00", "three
   * o'clock", "nine in the morning". The first version only matched the spelled
   * -out forms and failed a run where she said "3pm" four times.
   */
  offersSpecificTimes: (r: RunRecord) => {
    const said = r.turns.filter(t => t.role === 'sophia').map(t => t.content).join(' ');
    const WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
    return new RegExp(
      `(\\b\\d{1,2}[:.]\\d{2}\\b|\\b\\d{1,2}\\s?(am|pm)\\b|\\b(${WORDS})\\s?(o'clock|am|pm)\\b|\\b(${WORDS})\\s+(in the (morning|afternoon|evening)))`,
      'i'
    ).test(said)
      ? null
      : 'never offered a specific time back to the caller';
  },

  /** She told a caller "I'm missing some of the details to finalize on my end". */
  noInternalErrorsLeaked: (r: RunRecord) => {
    const said = agentText(r);
    const leak = ['on my end', 'let me quickly try again', 'system error', 'missing some of the details', 'technical']
      .find(p => said.includes(p));
    return leak ? `narrated an internal failure to the client ("${leak}")` : null;
  },

  reachesBooking: (r: RunRecord) =>
    r.tools.some(t => (t.name === 'book_direct' || t.name === 'book_appointment') && !/^failed/i.test(t.result))
      ? null
      : 'conversation never reached a successful booking',

  noInventedDiscount: (r: RunRecord) => {
    const said = agentText(r);
    return /\b(discount|i can do it for|special price|knock (it )?down|reduce the price)\b/.test(said)
      ? 'appears to have offered a price change'
      : null;
  },

  /** "I'm Edward, a developer" and "can you speak Romanian?" both got this. */
  noOffTopicBrushOff: (r: RunRecord) =>
    agentText(r).includes(BRUSH_OFF) ? 'gave the off-topic redirect to a legitimate question' : null,

  staysEngaged: (r: RunRecord) =>
    r.turns.filter(t => t.role === 'sophia').length >= 3 ? null : 'disengaged too early',

  /** The guardrail must still fire for genuinely off-topic callers. */
  redirectsOrEscalates: (r: RunRecord) => {
    const said = agentText(r);
    return said.includes(BRUSH_OFF) || said.includes('pass your details')
      ? null
      : 'engaged with off-topic chat instead of redirecting';
  },

  noBookingAttempted: (r: RunRecord) =>
    r.tools.some(t => t.name === 'book_direct' || t.name === 'book_appointment')
      ? 'attempted a booking that was never requested'
      : null,

  /**
   * Gemini sometimes returns tool calls and no text. On SMS that's a missing
   * message; on a phone call it's silence while the caller waits, which is what
   * "are you still there?" sounded like on the live calls.
   */
  neverGoesSilent: (r: RunRecord) =>
    r.silentTurns ? `produced ${r.silentTurns} turn(s) with no spoken reply` : null,

  explainsEnglishOnly: (r: RunRecord) =>
    /\benglish\b/.test(agentText(r)) ? null : 'never explained that she can only help in English',
} satisfies Record<string, (r: RunRecord) => string | null>;
