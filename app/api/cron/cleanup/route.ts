import { NextResponse } from 'next/server';
import { supabase, saveMessage } from '@/lib/supabase';
import { sendSMS } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const sevenMinsAgo = new Date(now.getTime() - 7 * 60 * 1000).toISOString();

  try {
    // 1. Find sessions to EXPIRE (older than 7 mins)
    const { data: toExpire } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id')
      .eq('status', 'active')
      .lt('updated_at', sevenMinsAgo);

    for (const session of (toExpire || [])) {
      const msg = "Session expired. Please start a new one by saying Hi if you still need assistance.";
      await sendSMS(session.client_identifier!, msg);
      await saveMessage(session.id, 'system', msg);
      await supabase.from('sessions').update({ status: 'completed' }).eq('id', session.id);
    }

    // 2. Find sessions to WARN (older than 5 mins, not yet warned)
    const { data: toWarn } = await supabase
      .from('sessions')
      .select('id, client_identifier, salon_id, metadata')
      .eq('status', 'active')
      .lt('updated_at', fiveMinsAgo)
      .gt('updated_at', sevenMinsAgo); // Only between 5 and 7 mins

    for (const session of (toWarn || [])) {
      if (session.metadata?.warned_at) continue;

      const msg = "In 2 minutes this session will expire. You will have to start a new one by saying Hi if you'd like to continue.";
      await sendSMS(session.client_identifier!, msg);
      await saveMessage(session.id, 'system', msg);
      
      const newMetadata = { ...session.metadata, warned_at: now.toISOString() };
      await supabase.from('sessions').update({ metadata: newMetadata }).eq('id', session.id);
    }

    return NextResponse.json({ 
      expired: toExpire?.length || 0, 
      warned: toWarn?.filter(s => !s.metadata?.warned_at).length || 0 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
