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
export async function getOrCreateConversation(salonId: string, customerPhone: string, sessionId?: string) {
  let query = supabase.from('sessions').select('*');

  if (sessionId) {
    // If an ID is provided, try to find it and ensure it's not completed
    const { data: byId } = await query
      .eq('id', sessionId)
      .neq('status', 'completed')
      .single();
    if (byId) return byId;
  }

  // Fallback to finding existing active/review/handed_over session for this phone
  let { data } = await query
    .eq('salon_id', salonId)
    .eq('client_identifier', customerPhone)
    .in('status', ['active', 'review', 'handed_over'])
    .order('updated_at', { ascending: false })
    .limit(1)
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
    .select('id, status, platform, created_at, updated_at, metadata, summary')
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
    .select('id, client_identifier, status, platform, created_at, updated_at, metadata, salon_id, summary, business_profiles(name)')
    .order('updated_at', { ascending: false })
    .limit(limit);
  
  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data } = await query;
  return data || [];
}

/**
 * Dashboard: Unique clients (phone numbers) across all salons.
 * It returns the latest session for each unique client_identifier.
 */
export async function getGroupedSessions(salonId?: string) {
  // Use a raw query or RPC to get the latest session per client.
  // For simplicity using JS-side grouping for MVP.
  let query = supabase
    .from('sessions')
    .select(`
      id, 
      client_identifier, 
      status, 
      updated_at, 
      salon_id,
      business_profiles(name)
    `)
    .order('updated_at', { ascending: false });

  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const grouped: Record<string, any> = {};
  const sessionIds: string[] = [];

  for (const s of (data || [])) {
    if (!grouped[s.client_identifier]) {
      grouped[s.client_identifier] = {
        ...s,
        session_count: 0,
        has_review: false,
        last_question: null,
        draft_response: null
      };
      sessionIds.push(s.id);
    }
    grouped[s.client_identifier].session_count++;
    if (s.status === 'review') grouped[s.client_identifier].has_review = true;
    if (s.status === 'handed_over') grouped[s.client_identifier].has_escalation = true;
  }

  // Batch fetch transcripts for the latest sessions
  if (sessionIds.length > 0) {
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('session_id, content, role, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });

    for (const t of (transcripts || [])) {
      const client = Object.values(grouped).find(g => g.id === t.session_id);
      if (!client) continue;

      if (t.role === 'user' && !client.last_question) {
        client.last_question = t.content;
      }
      if (t.role === 'draft' && !client.draft_response) {
        client.draft_response = t.content;
      }
    }
  }

  return Object.values(grouped);
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

  // For each session, get the first user message for context and determine outcome
  const results = await Promise.all((sessions || []).map(async (s: any) => {
    const { data: transcript } = await supabase
      .from('transcripts')
      .select('content, role')
      .eq('session_id', s.id)
      .order('created_at', { ascending: true });
    
    const firstUserMsg = transcript?.find(m => m.role === 'user')?.content || 'No user messages yet';
    
    // Determine outcome
    let outcome = 'Enquiry';
    if (s.status === 'handed_over') outcome = 'Escalated';
    if (s.status === 'review') outcome = 'Awaiting Approval';
    if (transcript?.some(m => m.content.includes('confirmed') || m.content.includes('book_direct'))) {
      outcome = 'Booked';
    } else if (s.status === 'completed') {
      outcome = 'Completed';
    }

    return {
      ...s,
      context: firstUserMsg,
      outcome
    };
  }));

  return results;
}
