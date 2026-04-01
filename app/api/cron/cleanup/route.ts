import { NextResponse } from 'next/server';
import { supabase, saveMessage, getSessionTranscript } from '@/lib/supabase';
import { sendSMS } from '@/lib/twilio';
import { generateSummary } from '@/lib/ai';

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

    const expireRoles = await getLastTranscriptRoles((toExpire || []).map(s => s.id));

    let expiredCount = 0;
    for (const session of (toExpire || [])) {
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
      await sendSMS(session.client_identifier!, msg);
      // Save as 'assistant' so test window shows what the client would receive via SMS.
      // In production this is sent via Twilio; in test mode it appears in the chat.
      await saveMessage(session.id, 'assistant', msg);
      await supabase.from('sessions').update({ summary }).eq('id', session.id);
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

    const warnRoles = await getLastTranscriptRoles((toWarn || []).map(s => s.id));

    let warnedCount = 0;
    for (const session of (toWarn || [])) {
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
      await sendSMS(session.client_identifier!, msg);
      // Save as 'assistant' so test window shows what the client would receive via SMS.
      await saveMessage(session.id, 'assistant', msg);
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
