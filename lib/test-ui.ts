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

const MAX_TOOL_CALLS = 5;

export async function createTestUiResponse(options: {
  message: string;
  sessionId?: string;
  manualApproval: boolean;
}) {
  const { message, sessionId, manualApproval } = options;
  const salon = await getDefaultSalon();

  if (!salon) {
    throw new Error('No salon found');
  }

  const conversation = await createTestUiConversation(salon.id, sessionId);
  const conversationMetadata =
    conversation.metadata && typeof conversation.metadata === 'object'
      ? (conversation.metadata as Record<string, any>)
      : {};

  // Keep a single active draft per test-ui session.
  await deleteMessagesByRoleFromTable(conversation.id, 'draft', TEST_UI_TRANSCRIPTS_TABLE);
  await saveMessageToTable(conversation.id, 'user', message, TEST_UI_TRANSCRIPTS_TABLE);

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
    }))
  );

  let toolCallCount = 0;
  while (aiResponse.tool_call && toolCallCount < MAX_TOOL_CALLS) {
    toolCallCount += 1;
    const { name, args } = aiResponse.tool_call;

    const result = await executeToolCall(name, args, toolCtx, updatedBookingState);

    if (result.updatedBookingState) updatedBookingState = result.updatedBookingState;
    if (result.updatedSystemPrompt) systemPrompt = result.updatedSystemPrompt;

    await saveMessageToTable(
      conversation.id,
      'system',
      `Tool (${name}): ${result.toolResult}`,
      TEST_UI_TRANSCRIPTS_TABLE
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
      }))
    );
  }

  const reply =
    aiResponse.reply ||
    "I'm sorry, I ran into an issue processing your previous message. Could you please rephrase your last question?";
  const nextMetadata = {
    ...conversationMetadata,
    source: 'test-ui',
    allocated_phone: conversationMetadata.allocated_phone || conversation.client_identifier,
    tokens: aiResponse.tokens,
    booking_state: updatedBookingState,
  };

  if (manualApproval) {
    await saveMessageToTable(conversation.id, 'draft', reply, TEST_UI_TRANSCRIPTS_TABLE);
    await supabase
      .from('sessions')
      .update({
        metadata: nextMetadata,
        status: 'review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    return {
      reply,
      draft: true,
      status: 'review',
      sessionId: conversation.id,
      approvalMode: true,
    };
  }

  await saveMessageToTable(conversation.id, 'assistant', reply, TEST_UI_TRANSCRIPTS_TABLE);
  await supabase
    .from('sessions')
    .update({
      metadata: nextMetadata,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  return {
    reply,
    draft: false,
    status: 'active',
    sessionId: conversation.id,
    approvalMode: false,
  };
}

export async function approveTestUiDraft(sessionId: string, content: string) {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, metadata')
    .eq('id', sessionId)
    .contains('metadata', { source: 'test-ui' })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!session) {
    throw new Error('Test UI session not found');
  }

  await saveMessageToTable(sessionId, 'assistant', content, TEST_UI_TRANSCRIPTS_TABLE);
  await deleteMessagesByRoleFromTable(sessionId, 'draft', TEST_UI_TRANSCRIPTS_TABLE);

  await supabase
    .from('sessions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
}
