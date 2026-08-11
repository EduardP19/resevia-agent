import { buildSystemPrompt } from './agent';
import { callAI } from './ai';
import { executeToolCall, type ToolContext } from './tool-handler';
import {
  TEST_UI_TRANSCRIPTS_TABLE,
  createTestUiConversation,
  deleteMessagesByRoleFromTable,
  getActiveHold,
  getDefaultSalon,
  getFAQs,
  getTranscriptHistoryFromTable,
  getWorkers,
  saveMessageToTable,
  supabase
} from './supabase';
import { safeLog } from '@/lib/logger';
import { addTokens, emptyTokens, recordTokenUsage } from './token-usage';
import { runObserver } from './observer';
import { ERROR_FALLBACK_REPLY } from './reply-format';
import { getAgentName } from './agent-name';

const MAX_TOOL_CALLS = 5;
const AI_MODEL = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';

export async function createTestUiResponse(options: {
  message: string;
  sessionId?: string;
  manualApproval: boolean;
  t?: string;
}) {
  const { message, sessionId, manualApproval, t } = options;
  const salon = await getDefaultSalon();

  if (!salon) {
    throw new Error('No salon found');
  }
  const agentName = getAgentName(salon);

  const conversation = await createTestUiConversation(salon.id, sessionId);
  safeLog({
    type: 'interaction',
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: salon.id,
    session_id: conversation.id,
    page: 'sophia-sandbox',
  });
  const conversationMetadata =
    conversation.metadata && typeof conversation.metadata === 'object'
      ? (conversation.metadata as Record<string, any>)
      : {};

  // Keep a single active draft per sophia-sandbox session.
  await deleteMessagesByRoleFromTable(conversation.id, 'draft', TEST_UI_TRANSCRIPTS_TABLE);
  await saveMessageToTable(conversation.id, 'user', message, TEST_UI_TRANSCRIPTS_TABLE, t);

  const [workers, faqs, activeHold, history] = await Promise.all([
    getWorkers(salon.id),
    getFAQs(salon.id),
    getActiveHold(conversation.client_identifier),
    getTranscriptHistoryFromTable(conversation.id, TEST_UI_TRANSCRIPTS_TABLE),
  ]);

  let updatedBookingState = (conversationMetadata.booking_state as Record<string, any>) || {};
  let systemPrompt = buildSystemPrompt(salon, workers, faqs, updatedBookingState);

  if (activeHold) {
    systemPrompt += `\n\n[SYSTEM INFO] You currently have a slot held for this client: ${activeHold.service_name} at ${new Date(activeHold.start_time).toLocaleString()}. They need to confirm to finalize.`;
  }

  if (updatedBookingState?.service) {
    systemPrompt += `\n\n[SYSTEM REMINDER] The service is ALREADY LOCKED as "${updatedBookingState.service}". Do NOT ask for it. Do NOT mention other services. Focus ONLY on date and time.`;
  }

  const toolCtx: ToolContext = {
    salonId: salon.id,
    sessionId: conversation.id,
    customerPhone: conversation.client_identifier,
    salon,
    workers,
    faqs,
    salonServices: salon.services,
  };

  let aiResponse = await callAI(
    systemPrompt,
    history.map((entry: any) => ({
      role: entry.role,
      content: entry.content,
    })),
    { tenant_id: salon.id, session_id: conversation.id }
  );
  let interactionTokens = addTokens(emptyTokens(), aiResponse.tokens);

  let toolCallCount = 0;
  const toolTrace: Array<{ name: string; result: string }> = [];
  while (aiResponse.tool_call && toolCallCount < MAX_TOOL_CALLS) {
    toolCallCount += 1;
    const { name, args } = aiResponse.tool_call;

    const result = await executeToolCall(name, args, toolCtx, updatedBookingState);
    toolTrace.push({ name, result: result.toolResult });

    if (result.updatedBookingState) updatedBookingState = result.updatedBookingState;
    if (result.updatedSystemPrompt) systemPrompt = result.updatedSystemPrompt;

    await saveMessageToTable(
      conversation.id,
      'system',
      `Tool (${name}): ${result.toolResult}`,
      TEST_UI_TRANSCRIPTS_TABLE,
      t
    );

    const updatedHistory = await getTranscriptHistoryFromTable(
      conversation.id,
      TEST_UI_TRANSCRIPTS_TABLE
    );

    aiResponse = await callAI(
      systemPrompt,
      updatedHistory.map((entry: any) => ({
        role: entry.role,
        content: entry.content,
      })),
      { tenant_id: salon.id, session_id: conversation.id }
    );
    interactionTokens = addTokens(interactionTokens, aiResponse.tokens);
  }

  // Internal sandbox usage is logged for diagnostics but excluded from spend monitoring.
  await recordTokenUsage({
    salonId: salon.id,
    sessionId: conversation.id,
    model: AI_MODEL,
    channel: 'sandbox',
    interaction: 'inbound_message',
    tokens: interactionTokens,
    toolCalls: toolCallCount,
    metadata: { source: 'sophia-sandbox' },
  });

  const reply = aiResponse.reply || ERROR_FALLBACK_REPLY;
  const nextMetadata = {
    ...conversationMetadata,
    source: 'sophia-sandbox',
    allocated_phone: conversationMetadata.allocated_phone || conversation.client_identifier,
    booking_state: updatedBookingState,
  };

  if (manualApproval) {
    await saveMessageToTable(conversation.id, 'draft', reply, TEST_UI_TRANSCRIPTS_TABLE, t);
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'session',
      event: 'draft_created',
      tenant_id: salon.id,
      session_id: conversation.id,
    });
    await supabase
      .from('sessions')
      .update({
        metadata: nextMetadata,
        status: 'needs_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    await runObserver({
      salonId: salon.id,
      sessionId: conversation.id,
      channel: 'sandbox',
      userMessage: message,
      reply,
      status: 'needs_approval',
      agentName: salon.agent_name,
      toolTrace,
      toolCallCount,
    }).catch(() => {});

    return {
      reply,
      draft: true,
      status: 'needs_approval',
      sessionId: conversation.id,
      approvalMode: true,
      agentName,
    };
  }

  await saveMessageToTable(conversation.id, 'assistant', reply, TEST_UI_TRANSCRIPTS_TABLE, t);
  await supabase
    .from('sessions')
    .update({
      metadata: nextMetadata,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  await runObserver({
    salonId: salon.id,
    sessionId: conversation.id,
    channel: 'sandbox',
    userMessage: message,
    reply,
    status: 'active',
    agentName: salon.agent_name,
    toolTrace,
    toolCallCount,
  }).catch(() => {});

  return {
    reply,
    draft: false,
    status: 'active',
    sessionId: conversation.id,
    approvalMode: false,
    agentName,
  };
}

export async function approveTestUiDraft(sessionId: string, content: string, t?: string) {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, metadata')
    .eq('id', sessionId)
    .contains('metadata', { source: 'sophia-sandbox' })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!session) {
    throw new Error('Test UI session not found');
  }

  await saveMessageToTable(sessionId, 'assistant', content, TEST_UI_TRANSCRIPTS_TABLE, t);
  await deleteMessagesByRoleFromTable(sessionId, 'draft', TEST_UI_TRANSCRIPTS_TABLE);

  await supabase
    .from('sessions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  safeLog({
    type: 'audit',
    level: 'info',
    category: 'session',
    event: 'draft_approved',
    session_id: sessionId,
  });
}
