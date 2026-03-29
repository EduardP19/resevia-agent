import { NextResponse } from 'next/server';
import { supabase, saveMessage, getSessionTranscript } from '@/lib/supabase';
import { sendSMS } from '@/lib/twilio';
import { generateSummary } from '@/lib/ai';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const twoMinsAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const threeMinsAgo = new Date(now.getTime() - 3 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Find sessions to EXPIRE (older than 3 mins)
    const { data: toExpire } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id')
      .in('status', ['active', 'review'])
      .lt('updated_at', threeMinsAgo)
      .gt('updated_at', twoDaysAgo);

    for (const session of (toExpire || [])) {
      // Generate summary before closing
      const transcript = await getSessionTranscript(session.id);
      const summary = await generateSummary(transcript);

      const msg = "Session expired. Please start a new one by saying Hi if you still need assistance.";
      await sendSMS(session.client_identifier!, msg);
      await saveMessage(session.id, 'system', msg);
      await supabase.from('sessions').update({ 
        status: 'completed',
        summary 
      }).eq('id', session.id);
    }

    // 2. Find sessions to WARN (older than 2 mins, not yet warned)
    const { data: toWarn } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id, metadata')
      .in('status', ['active', 'review'])
      .lt('updated_at', twoMinsAgo)
      .gt('updated_at', threeMinsAgo)
      .gt('updated_at', twoDaysAgo);

    for (const session of (toWarn || [])) {
      if (session.metadata?.warned_at) continue;

      const msg = "Just checking if you're still there! In 1 minute this session will expire and you'll have to start a new one by saying Hi.";
      await sendSMS(session.client_identifier!, msg);
      await saveMessage(session.id, 'system', msg);
      
      const newMetadata = { ...session.metadata, warned_at: now.toISOString() };
      await supabase.from('sessions').update({ metadata: newMetadata }).eq('id', session.id);
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
      expired: toExpire?.length || 0, 
      warned: toWarn?.filter(s => !s.metadata?.warned_at).length || 0,
      holdsExpired: expiredHolds?.length || 0
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
