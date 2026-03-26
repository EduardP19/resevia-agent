import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Load salon by their Twilio SMS number
export async function getSalonBySmsNumber(smsNumber: string) {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('twilio_number', smsNumber) // Used to be 'sms_number'
    .single();
  
  if (error) {
    // Fallback for MVP: return the first salon if twilio_number isn't set
    const { data: firstSalon } = await supabase.from('business_profiles').select('*').limit(1).single();
    return firstSalon;
  }
  return data;
}

// Load or create conversation for a customer
export async function getOrCreateConversation(salonId: string, customerPhone: string) {
  let { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('salon_id', salonId)
    .eq('client_identifier', customerPhone)
    .eq('status', 'active')
    .single();

  if (!data) {
    const { data: newData, error: nsError } = await supabase
      .from('sessions')
      .insert({
        platform: 'sms',
        salon_id: salonId,
        client_identifier: customerPhone,
        status: 'active',
        metadata: {}
      })
      .select()
      .single();
    
    if (nsError) throw nsError;
    data = newData;
  }
  return data;
}

// Load all messages for a session
export async function getTranscriptHistory(sessionId: string) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  
  return data || [];
}

// Save message to transcript
export async function saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string) {
  await supabase.from('transcripts').insert({
    session_id: sessionId,
    role,
    content
  });
}
