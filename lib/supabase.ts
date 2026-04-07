import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);
export const TEST_UI_TRANSCRIPTS_TABLE = 'transcripts-sophia-sandbox';

type TranscriptTableName = 'transcripts' | typeof TEST_UI_TRANSCRIPTS_TABLE;
type TranscriptRole = 'user' | 'assistant' | 'system' | 'draft';

export function isTestUiSession(session: { metadata?: any } | null | undefined) {
  const metadata = session?.metadata;
  return Boolean(metadata && typeof metadata === 'object' && metadata.source === 'sophia-sandbox');
}

function formatTranscriptTableError(error: any, table: TranscriptTableName) {
  if (table === TEST_UI_TRANSCRIPTS_TABLE) {
    return new Error(
      `${error.message}. Ensure the sophia-sandbox transcript migration has been applied for "${TEST_UI_TRANSCRIPTS_TABLE}".`
    );
  }

  return error;
}

// Load salon by ID
export async function getSalonById(salonId: string) {
  const { data } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('id', salonId)
    .single();
  return data;
}

export async function getDefaultSalon() {
  const { data } = await supabase
    .from('business_profiles')
    .select('*')
    .limit(1)
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

    if (nsError) {
      // Race condition: another request already created the session — fetch it
      if (nsError.code === '23505') {
        const { data: raceData } = await supabase
          .from('sessions')
          .select('*')
          .eq('salon_id', salonId)
          .eq('client_identifier', customerPhone)
          .in('status', ['active', 'review', 'handed_over'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        if (raceData) return raceData;
      }
      throw nsError;
    }
    data = newData;
  }
  return data;
}

// Load all messages for a session
export async function getTranscriptHistory(sessionId: string) {
  return getTranscriptHistoryFromTable(sessionId, 'transcripts');
}

export async function getTranscriptHistoryFromTable(
  sessionId: string,
  table: TranscriptTableName = 'transcripts'
) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    throw formatTranscriptTableError(error, table);
  }

  return data || [];
}

// Save message to transcript
export async function saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string) {
  await saveMessageToTable(sessionId, role, content, 'transcripts');
}

export async function saveMessageToTable(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  table: TranscriptTableName = 'transcripts'
) {
  const { error } = await supabase.from(table).insert({
    session_id: sessionId,
    role,
    content
  });

  if (error) {
    throw formatTranscriptTableError(error, table);
  }
}

export async function deleteMessagesByRoleFromTable(
  sessionId: string,
  role: TranscriptRole,
  table: TranscriptTableName = 'transcripts'
) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('session_id', sessionId)
    .eq('role', role);

  if (error) {
    throw formatTranscriptTableError(error, table);
  }
}

async function fallbackAllocateTestUiPhone() {
  const { data } = await supabase
    .from('sessions')
    .select('client_identifier')
    .contains('metadata', { source: 'sophia-sandbox' })
    .like('client_identifier', '07%')
    .order('client_identifier', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latest = data?.client_identifier || '0699999999';
  const nextValue = String(Number(latest) + 1).padStart(10, '0');
  return nextValue;
}

export async function allocateTestUiPhone() {
  const { data, error } = await supabase.rpc('allocate_test_ui_phone');

  if (!error && typeof data === 'string' && data.length > 0) {
    return data;
  }

  return fallbackAllocateTestUiPhone();
}

export async function createTestUiConversation(salonId: string, sessionId?: string) {
  if (sessionId) {
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .neq('status', 'completed')
      .contains('metadata', { source: 'sophia-sandbox' })
      .maybeSingle();

    if (existingSession) {
      return existingSession;
    }
  }

  const clientPhone = await allocateTestUiPhone();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      platform: 'web',
      salon_id: salonId,
      client_identifier: clientPhone,
      status: 'active',
      metadata: {
        source: 'sophia-sandbox',
        allocated_phone: clientPhone,
      },
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function expireSessionById(sessionId: string, metadataPatch?: Record<string, any>) {
  const { data: existingSession, error } = await supabase
    .from('sessions')
    .select('id, status, metadata')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!existingSession) {
    return null;
  }

  const currentMetadata =
    existingSession.metadata && typeof existingSession.metadata === 'object'
      ? existingSession.metadata
      : {};
  const expiredAt =
    typeof currentMetadata.expired_at === 'string'
      ? currentMetadata.expired_at
      : new Date().toISOString();
  const nextMetadata = {
    ...currentMetadata,
    ...metadataPatch,
    expired_at: expiredAt,
  };

  if (existingSession.status === 'completed') {
    return {
      ...existingSession,
      metadata: nextMetadata,
    };
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
      metadata: nextMetadata,
    })
    .eq('id', sessionId)
    .neq('status', 'completed')
    .select('id, status, metadata')
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  return (
    updatedSession || {
      ...existingSession,
      status: 'completed',
      metadata: nextMetadata,
    }
  );
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
  return (data || []).filter((session: any) => !isTestUiSession(session));
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
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('customer_phone', customerPhone)
    .eq('status', 'held')
    .gte('start_time', nowIso)
    .or(`expires_at.is.null,expires_at.gte.${nowIso}`)
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();
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
  return (data || []).filter((session: any) => !isTestUiSession(session));
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
      metadata,
      salon_id,
      business_profiles(name)
    `)
    .order('updated_at', { ascending: false });

  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const visibleSessions = (data || []).filter((session: any) => !isTestUiSession(session));

  const grouped: Record<string, any> = {};
  const sessionIds: string[] = [];

  for (const s of visibleSessions) {
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
    .select('id, created_at, status, salon_id, metadata, business_profiles(name)')
    .eq('client_identifier', phone)
    .order('created_at', { ascending: false });
  
  if (sError) throw sError;

  const visibleSessions = (sessions || []).filter((session: any) => !isTestUiSession(session));

  // For each session, get the first user message for context and determine outcome
  const results = await Promise.all(visibleSessions.map(async (s: any) => {
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
