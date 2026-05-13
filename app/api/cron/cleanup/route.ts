import { NextResponse } from 'next/server';
import { supabase, saveMessage, getSessionTranscript, isTestUiSession } from '@/lib/supabase';
import { sendSMS } from '@/lib/twilio';
import { generateSummary } from '@/lib/ai';
import { safeLog } from '@/lib/logger';
import {
  smsMetadataFromTwilioMessage,
  updateTranscriptSmsMetadata,
  upsertSmsMessage,
} from '@/lib/sms-messages';

export const dynamic = 'force-dynamic';

async function getLastTranscriptRoles(sessionIds: string[]): Promise<Record<string, string>> {
  if (sessionIds.length === 0) return {};

  const { data } = await supabase
    .from('transcripts')
    .select('session_id, role, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: false });

  const bySession: Record<string, string> = {};
  for (const row of (data || [])) {
    if (!bySession[row.session_id]) {
      bySession[row.session_id] = row.role;
    }
  }
  return bySession;
}

export async function GET() {
  const now = new Date();
  const nowIso = now.toISOString();
  const twoMinsAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const threeMinsAgo = new Date(now.getTime() - 3 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Find sessions to EXPIRE (older than 3 mins)
    const { data: toExpire } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id, status, metadata')
      .in('status', ['active', 'review'])
      .lt('updated_at', threeMinsAgo)
      .gt('updated_at', twoDaysAgo);

    const expirableSessions = (toExpire || []).filter(session => !isTestUiSession(session));
    const expireRoles = await getLastTranscriptRoles(expirableSessions.map(s => s.id));

    let expiredCount = 0;
    for (const session of expirableSessions) {
      // Only expire sessions where the latest message is from the agent.
      // If the client is still waiting for us (last message is user/draft/system), do not terminate.
      if (expireRoles[session.id] !== 'assistant') continue;

      const currentMetadata = (session.metadata && typeof session.metadata === 'object') ? session.metadata : {};
      if ((currentMetadata as any).expired_at) continue;

      // Claim this session atomically before sending expiry message to avoid duplicate sends.
      const { data: claimed } = await supabase
        .from('sessions')
        .update({
          status: 'completed',
          metadata: { ...currentMetadata, expired_at: nowIso }
        })
        .eq('id', session.id)
        .eq('status', session.status)
        .eq('metadata', currentMetadata)
        .select('id')
        .maybeSingle();

      if (!claimed) continue;

      // Generate summary after claim so only one worker performs it.
      const transcript = await getSessionTranscript(session.id);
      const summary = await generateSummary(transcript);

      const msg = "Session expired. Please start a new one by saying Hi if you still need assistance.";
      const outboundMessage = await sendSMS(session.client_identifier!, msg, undefined, {
        tenant_id: session.salon_id,
        session_id: session.id,
      });
      await upsertSmsMessage({
        twilioMessageSid: outboundMessage.sid,
        direction: 'outbound',
        sessionId: session.id,
        salonId: session.salon_id,
        ...smsMetadataFromTwilioMessage(outboundMessage),
        rawPayload: outboundMessage,
      });
      // Save as 'assistant' so test window shows what the client would receive via SMS.
      // In production this is sent via Twilio; in test mode it appears in the chat.
      const assistantMessage = await saveMessage(session.id, 'assistant', msg);
      if (assistantMessage?.id) {
        const outboundMetadata = {
          twilioMessageSid: outboundMessage.sid,
          direction: 'outbound' as const,
          ...smsMetadataFromTwilioMessage(outboundMessage),
        };
        await updateTranscriptSmsMetadata(assistantMessage.id, outboundMetadata);
        await upsertSmsMessage({
          ...outboundMetadata,
          sessionId: session.id,
          transcriptId: assistantMessage.id,
          salonId: session.salon_id,
          rawPayload: outboundMessage,
        });
      }
      await supabase.from('sessions').update({ summary }).eq('id', session.id);
      safeLog({
        level: 'info',
        category: 'session',
        event: 'session_closed',
        tenant_id: session.salon_id,
        session_id: session.id,
        reason: 'timeout',
      });
      expiredCount++;
    }

    // 2. Find sessions to WARN (older than 2 mins, not yet warned)
    const { data: toWarn } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id, status, metadata')
      .in('status', ['active', 'review'])
      .lt('updated_at', twoMinsAgo)
      .gt('updated_at', threeMinsAgo)
      .gt('updated_at', twoDaysAgo);

    const warnableSessions = (toWarn || []).filter(session => !isTestUiSession(session));
    const warnRoles = await getLastTranscriptRoles(warnableSessions.map(s => s.id));

    let warnedCount = 0;
    for (const session of warnableSessions) {
      // Warn only when we are waiting for the client's reply.
      if (warnRoles[session.id] !== 'assistant') continue;

      const currentMetadata = (session.metadata && typeof session.metadata === 'object') ? session.metadata : {};
      if ((currentMetadata as any).warned_at) continue;

      // Claim warning atomically before sending to avoid duplicates on concurrent cron runs.
      const { data: claimed } = await supabase
        .from('sessions')
        .update({ metadata: { ...currentMetadata, warned_at: nowIso } })
        .eq('id', session.id)
        .eq('status', session.status)
        .eq('metadata', currentMetadata)
        .select('id')
        .maybeSingle();

      if (!claimed) continue;

      const msg = "Just checking if you're still there! In 1 minute this session will expire and you'll have to start a new one by saying Hi.";
      const outboundMessage = await sendSMS(session.client_identifier!, msg, undefined, {
        tenant_id: session.salon_id,
        session_id: session.id,
      });
      await upsertSmsMessage({
        twilioMessageSid: outboundMessage.sid,
        direction: 'outbound',
        sessionId: session.id,
        salonId: session.salon_id,
        ...smsMetadataFromTwilioMessage(outboundMessage),
        rawPayload: outboundMessage,
      });
      // Save as 'assistant' so test window shows what the client would receive via SMS.
      const assistantMessage = await saveMessage(session.id, 'assistant', msg);
      if (assistantMessage?.id) {
        const outboundMetadata = {
          twilioMessageSid: outboundMessage.sid,
          direction: 'outbound' as const,
          ...smsMetadataFromTwilioMessage(outboundMessage),
        };
        await updateTranscriptSmsMetadata(assistantMessage.id, outboundMetadata);
        await upsertSmsMessage({
          ...outboundMetadata,
          sessionId: session.id,
          transcriptId: assistantMessage.id,
          salonId: session.salon_id,
          rawPayload: outboundMessage,
        });
      }
      safeLog({
        level: 'info',
        category: 'session',
        event: 'session_warning',
        tenant_id: session.salon_id,
        session_id: session.id,
      });
      warnedCount++;
    }

    // 3. Expire stale booking holds (SKILL §6 Round 2)
    // Holds with expires_at in the past are cleaned up to free blocked slots
    const { data: expiredHolds } = await supabase
      .from('bookings')
      .select('id')
      .eq('status', 'held')
      .lt('expires_at', now.toISOString());

    if (expiredHolds && expiredHolds.length > 0) {
      const holdIds = expiredHolds.map(h => h.id);
      await supabase
        .from('bookings')
        .update({ status: 'expired' })
        .in('id', holdIds);
    }

    return NextResponse.json({ 
      expired: expiredCount,
      warned: warnedCount,
      holdsExpired: expiredHolds?.length || 0
    });
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Cron cleanup failed',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
