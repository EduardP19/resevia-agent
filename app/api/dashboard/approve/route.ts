import { NextRequest, NextResponse } from 'next/server';
import { supabase, saveMessage } from '@/lib/supabase';
import { sendSMS } from '@/lib/twilio';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, content } = await req.json();

    const { data: session, error: sError } = await supabase
      .from('sessions')
      .select('*, business_profiles(twilio_number)')
      .eq('id', sessionId)
      .single();

    if (!session || sError) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // 1. Send SMS via Twilio
    await sendSMS(session.client_identifier, content);

    // 2. Save as final assistant message (remove draft if exists)
    // For simplicity, we just add the new one as 'assistant'
    await saveMessage(sessionId, 'assistant', content);
    
    // Delete any drafts for this session to clean up
    await supabase.from('transcripts').delete().eq('session_id', sessionId).eq('role', 'draft');

    // 3. Update session status to active
    await supabase.from('sessions').update({
      status: 'active',
      updated_at: new Date().toISOString()
    }).eq('id', sessionId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Approve Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
