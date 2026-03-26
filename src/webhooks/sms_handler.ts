import { Request, Response } from 'express';
import twilio from 'twilio';
import { AgentEngine } from '../engine/agent_engine.js';
import { supabase } from '../lib/supabase.js';
import { Session, Transcript } from '../types/index.js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Handles incoming SMS from Twilio.
 * Endpoint: POST /api/webhooks/sms
 */
export async function handleIncomingSMS(req: Request, res: Response, agent: AgentEngine) {
  const { Body: userInput, From: fromNumber, MessageSid: messageSid } = req.body;

  console.log(`[SMS Received] From: ${fromNumber} | Body: ${userInput}`);

  try {
    // 1. Fetch or create session
    let { data: session, error: sError } = await supabase
      .from('sessions')
      .select('*')
      .eq('client_identifier', fromNumber)
      .eq('status', 'active')
      .single();

    if (!session) {
      const { data: newSession, error: nsError } = await supabase
        .from('sessions')
        .insert({
          platform: 'sms',
          client_identifier: fromNumber,
          status: 'active'
        })
        .select()
        .single();
      
      if (nsError) throw nsError;
      session = newSession;
    }

    // 2. Fetch transcript history
    const { data: history, error: hError } = await supabase
      .from('transcripts')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    if (hError) throw hError;

    // 3. Get AI Response
    const aiResponse = await agent.getResponse(session as Session, history as Transcript[], userInput);

    // 4. Save User Message to DB
    await supabase.from('transcripts').insert({
      session_id: session.id,
      role: 'user',
      content: userInput
    });

    // 5. Save AI Message to DB
    await supabase.from('transcripts').insert({
      session_id: session.id,
      role: 'assistant',
      content: aiResponse.content || 'I am processing your request.'
    });

    // 6. Send SMS back via Twilio
    await twilioClient.messages.create({
      body: aiResponse.content || 'Sorry, I encountered an error. Please try again.',
      from: process.env.TWILIO_PHONE_NUMBER,
      to: fromNumber
    });

    res.status(200).send('<Response></Response>'); // Empty TwiML response
  } catch (error: any) {
    console.error('[SMS Error]', error);
    res.status(500).send('Error processing SMS');
  }
}
