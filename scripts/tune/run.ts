import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt } from '@/lib/agent';
import { callAI } from '@/lib/ai';
import { executeToolCall, type ToolContext } from '@/lib/tool-handler';
import { getFAQs, getWorkers, supabase } from '@/lib/supabase';
import { checks, type RunRecord, type Scenario, type ToolCall, type Turn } from './checks';
import { scenarios } from './scenarios';

/**
 * Prompt tuning harness.
 *
 * Runs scripted *goals* (not scripted lines) against the real system prompt and
 * the real tools, then asserts on what happened. The point is a feedback loop
 * measured in seconds instead of one phone call per idea, and — more
 * importantly — visibility of the tool trace, which is the half you cannot see
 * from a transcript and where every failure so far has actually lived.
 *
 *   npm run tune                    all scenarios, voice register
 *   npm run tune -- --channel sms   text register
 *   npm run tune -- --only haggle   scenarios whose name contains "haggle"
 *   npm run tune -- --verbose       show tool args and full results
 *
 * `book_direct` and `book_appointment` are stubbed: check_availability still
 * hits Cal.com for real, so slot logic is genuinely exercised, but nothing is
 * ever written to a calendar and no client is ever emailed.
 */

const MAX_TURNS = 12;
const MAX_TOOL_CALLS = 6;

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const channel = (flag('channel', 'voice') as 'voice' | 'sms');
const only = flag('only');
const verbose = args.includes('--verbose');

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// lib/logger writes one JSON line per AI/tool call to stdout, which buries the
// transcript this script exists to show. Swallow those unless --verbose; real
// console output (errors, our own report) still goes through.
const realLog = console.log.bind(console);
if (!verbose) {
  console.log = (...a: any[]) => {
    const first = a[0];
    if (typeof first === 'string' && first.startsWith('{"') && first.includes('"timestamp"')) return;
    realLog(...a);
  };
}

const genAI = new GoogleGenerativeAI(process.env.AI_MODEL_API_KEY!);

// +44 7000 0xxxxx — an unallocated range, so a stray cancel or reschedule during
// a run can never reach a real client's booking.
let testNumberSeq = 0;
const nextTestNumber = () => `+4470000${String(++testNumberSeq).padStart(5, '0')}`;

/**
 * Gemini plays the caller. Kept deliberately terse and a little imperfect: a
 * caller who speaks in tidy full sentences is not the caller who breaks things.
 */
async function customerTurn(goal: string, history: Turn[]): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction: `You are a member of the public ringing a hair salon. Play the customer, never the receptionist.

Your goal for this call:
${goal}

Rules:
- Reply with ONLY what you say out loud. No stage directions, no quotes, no labels.
- One or two short sentences, the way people actually speak on the phone.
- Don't be unnaturally cooperative — you can be vague, change your mind, or interrupt.
- If your goal is complete, or the conversation is clearly going nowhere, reply with exactly: [END]`,
  });

  const transcript = history.map(t => `${t.role === 'customer' ? 'You' : 'Receptionist'}: ${t.content}`).join('\n');
  const result = await model.generateContent(
    history.length === 0
      ? 'The receptionist has just answered. Say your opening line.'
      : `${transcript}\n\nWhat do you say next?`
  );
  return result.response.text().trim();
}

async function runScenario(scenario: Scenario, baseCtx: ToolContext, basePrompt: string) {
  // Each scenario gets its own caller number. Sharing one leaked state between
  // runs through update_client_profile and the bookings table — Sophia greeted
  // the Romanian caller as "Edward", a name from an earlier scenario.
  const ctx: ToolContext = { ...baseCtx, customerPhone: nextTestNumber() };
  const record: RunRecord = { turns: [], tools: [] };
  let systemPrompt = basePrompt;
  let bookingState: Record<string, any> = {};
  // Mirrors the shape lib/ai.ts expects: tool results come back as system
  // messages formatted "Tool (name): result".
  const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const said = await customerTurn(scenario.goal, record.turns);
    if (said.includes('[END]')) break;
    record.turns.push({ role: 'customer', content: said });
    history.push({ role: 'user', content: said });

    let ai = await callAI(systemPrompt, history);
    let toolCalls = 0;

    while (ai.tool_call && toolCalls < MAX_TOOL_CALLS) {
      toolCalls++;
      const { name, args: toolArgs } = ai.tool_call;

      let result: string;
      if (name === 'book_direct' || name === 'book_appointment') {
        // Stubbed, but not credulous: the real holdBooking rejects a call with
        // missing arguments, and a stub that confirms anything would hide the
        // agent booking with undefined service/date/time — which it did.
        const missing = ['serviceName', 'date', 'time'].filter(k => !toolArgs?.[k]);
        result = missing.length
          ? `Failed: missing required booking details (${missing.join(', ')}).`
          : `Booking confirmed for ${toolArgs.serviceName} on ${toolArgs.date} at ${toolArgs.time}. [STUBBED]`;
      } else {
        const out = await executeToolCall(name, toolArgs, ctx, bookingState);
        result = out.toolResult;
        if (out.updatedBookingState) bookingState = out.updatedBookingState;
        if (out.updatedSystemPrompt) systemPrompt = out.updatedSystemPrompt;
      }

      record.tools.push({ name, args: toolArgs, result });
      history.push({ role: 'system', content: `Tool (${name}): ${result}` });
      ai = await callAI(systemPrompt, history);
    }

    const reply = ai.reply || '(no reply)';
    if (!ai.reply) record.silentTurns = (record.silentTurns || 0) + 1;
    record.turns.push({ role: 'sophia', content: reply });
    history.push({ role: 'assistant', content: reply });
  }

  return record;
}

function report(scenario: Scenario, record: RunRecord) {
  console.log(`\n${c.bold(c.cyan(`SCENARIO: ${scenario.name}`))}`);

  let toolIndex = 0;
  for (const turn of record.turns) {
    if (turn.role === 'customer') {
      console.log(`  ${c.dim('customer')}  ${turn.content}`);
    } else {
      // Tools run between the customer's line and Sophia's reply, so they print
      // in the order they actually happened.
      while (toolIndex < record.tools.length) {
        const t = record.tools[toolIndex++];
        const detail = verbose ? `${JSON.stringify(t.args)} -> ${t.result}` : t.result.slice(0, 90);
        console.log(`  ${c.yellow('→ tool')}    ${t.name} ${c.dim(detail)}`);
      }
      console.log(`  ${c.bold('sophia')}    ${turn.content}`);
    }
  }

  const failures: string[] = [];
  for (const name of scenario.checks) {
    const reason = checks[name](record);
    if (reason) {
      failures.push(`${name}: ${reason}`);
      console.log(`  ${c.red('✗')} ${name} ${c.dim(`— ${reason}`)}`);
    } else {
      console.log(`  ${c.green('✓')} ${name}`);
    }
  }
  return failures;
}

async function main() {
  const { data: salon } = await supabase.from('business_profiles').select('*').limit(1).single();
  if (!salon) throw new Error('No salon found');

  const [workers, faqs] = await Promise.all([getWorkers(salon.id), getFAQs(salon.id)]);
  const basePrompt = buildSystemPrompt(salon, workers, faqs, null, { channel });

  const baseCtx: ToolContext = {
    salonId: salon.id,
    customerPhone: '',
    salon,
    workers,
    faqs,
    salonServices: salon.services,
    channel,
  };

  const selected = only
    ? scenarios.filter(s => s.name.toLowerCase().includes(only.toLowerCase()))
    : scenarios;

  console.log(c.dim(`${salon.name} · ${channel} register · ${basePrompt.length} chars · ${selected.length} scenario(s)`));

  const failed: Array<{ scenario: string; failures: string[] }> = [];
  for (const scenario of selected) {
    try {
      const record = await runScenario(scenario, baseCtx, basePrompt);
      const failures = report(scenario, record);
      if (failures.length) failed.push({ scenario: scenario.name, failures });
    } catch (error: any) {
      console.log(`\n${c.red(`SCENARIO: ${scenario.name} — crashed`)}\n  ${error?.message}`);
      failed.push({ scenario: scenario.name, failures: [`crashed: ${error?.message}`] });
    }
  }

  console.log(`\n${c.bold('─'.repeat(60))}`);
  if (failed.length === 0) {
    console.log(c.green(`All ${selected.length} scenarios passed.`));
  } else {
    console.log(c.red(`${failed.length} of ${selected.length} scenarios failed:`));
    for (const f of failed) console.log(`  ${f.scenario}\n${f.failures.map(x => `    - ${x}`).join('\n')}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
