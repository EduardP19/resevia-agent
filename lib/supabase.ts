import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Load salon by ID
export async function getSalonById(salonId: string) {
  const { data } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('id', salonId)
    .single();
  return data;
}

export async function updateSalonProfile(id: string, updates: any) {
  const { data, error } = await supabase.from('business_profiles').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

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

// Mark a session as completed
export async function completeSession(salonId: string, clientIdentifier: string) {
  await supabase
    .from('sessions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('salon_id', salonId)
    .eq('client_identifier', clientIdentifier)
    .eq('status', 'active');
}

// Dashboard: all messages within a single session
export async function getSessionTranscript(sessionId: string) {
  const { data } = await supabase
    .from('transcripts')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  return data || [];
}

// Dashboard: all sessions for a specific client (same phone number)
export async function getClientSessions(salonId: string, clientIdentifier: string) {
  const { data } = await supabase
    .from('sessions')
    .select('id, status, platform, created_at, updated_at, metadata')
    .eq('salon_id', salonId)
    .eq('client_identifier', clientIdentifier)
    .order('created_at', { ascending: false });
  return data || [];
}

// Active workers for a salon (name + services, used for system prompt)
export async function getWorkers(salonId: string) {
  const { data } = await supabase
    .from('workers')
    .select('name, services')
    .eq('salon_id', salonId)
    .eq('is_active', true);
  return data || [];
}

// The most recent held (unconfirmed) booking for a customer
export async function getActiveHold(customerPhone: string) {
  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('customer_phone', customerPhone)
    .eq('status', 'held')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

// FAQ entries for a salon
export async function getFAQs(salonId: string) {
  const { data } = await supabase
    .from('faqs')
    .select('id, category, question, answer, sort_order')
    .eq('salon_id', salonId)
    .order('category')
    .order('sort_order');
  return (data || []) as any[];
}

// Dashboard: all sessions for a salon (for inbox/overview)
export async function getSalonSessions(salonId?: string, limit = 50) {
  let query = supabase
    .from('sessions')
    .select('id, client_identifier, status, platform, created_at, updated_at, metadata, salon_id, business_profiles(name)')
    .order('updated_at', { ascending: false })
    .limit(limit);
  
  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data } = await query;
  return data || [];
}

// FAQ Management
export async function createFAQ(faq: { salon_id: string; category: string; question: string; answer: string; sort_order?: number }) {
  const { data, error } = await supabase.from('faqs').insert(faq).select().single();
  if (error) throw error;
  return data;
}

export async function updateFAQ(id: string, faq: Partial<{ category: string; question: string; answer: string; sort_order: number }>) {
  const { data, error } = await supabase.from('faqs').update(faq).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFAQ(id: string) {
  const { error } = await supabase.from('faqs').delete().eq('id', id);
  if (error) throw error;
}

export async function searchSessionsByPhone(phone: string) {
  const { data: sessions, error: sError } = await supabase
    .from('sessions')
    .select('id, created_at, status, salon_id, business_profiles(name)')
    .eq('client_identifier', phone)
    .order('created_at', { ascending: false });
  
  if (sError) throw sError;

  // For each session, get the first user message for context
  const results = await Promise.all((sessions || []).map(async (s: any) => {
    const { data: firstMessage } = await supabase
      .from('transcripts')
      .select('content')
      .eq('session_id', s.id)
      .eq('role', 'user')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    
    return {
      ...s,
      context: firstMessage?.content || 'No user messages yet'
    };
  }));

  return results;
}
