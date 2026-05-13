import { createClient } from '@supabase/supabase-js';
import { safeLog } from '@/lib/logger';

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

function isMissingSophiaSandboxTColumnError(error: any) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const code = typeof error?.code === 'string' ? error.code : '';

  // Supabase/PostgREST schema cache error when a column does not exist yet.
  return (
    code === 'PGRST204' ||
    message.includes("Could not find the 't' column") ||
    details.includes("Could not find the 't' column")
  );
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
    // If an ID is provided, try to find it and ensure it's still open
    const { data: byId } = await query
      .eq('id', sessionId)
      .not('status', 'in', '("expired","completed")')
      .single();
    if (byId) return byId;
  }

  // Fallback to finding existing open session for this phone
  let { data } = await query
    .eq('salon_id', salonId)
    .eq('client_identifier', customerPhone)
    .in('status', ['active', 'needs_approval', 'escalated'])
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
          .in('status', ['active', 'needs_approval', 'escalated'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        if (raceData) return raceData;
      }
      safeLog({
        level: 'error',
        category: 'system',
        event: 'db_error',
        tenant_id: salonId,
        error: nsError?.message || String(nsError),
        stack: nsError?.stack,
        query_description: 'Create SMS conversation session',
        code: nsError?.code,
      });
      throw nsError;
    }
    data = newData;
    safeLog({
      level: 'info',
      category: 'session',
      event: 'session_created',
      tenant_id: salonId,
      session_id: newData.id,
      customer_phone: customerPhone,
      channel: 'sms',
    });
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
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: `Load transcript history from ${table}`,
      session_id: sessionId,
      code: error?.code,
    });
    throw formatTranscriptTableError(error, table);
  }

  return data || [];
}

// Save message to transcript
export async function saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string) {
  return saveMessageToTable(sessionId, role, content, 'transcripts');
}

export async function saveMessageToTable(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  table: TranscriptTableName = 'transcripts',
  t?: string,
  extraPayload?: Record<string, any>
) {
  const basePayload: Record<string, any> = {
    session_id: sessionId,
    role,
    content,
    ...(extraPayload || {})
  };

  const includeT = table === TEST_UI_TRANSCRIPTS_TABLE;

  if (!includeT) {
    const { data, error } = await supabase.from(table).insert(basePayload).select().single();
    if (error) {
      safeLog({
        level: 'error',
        category: 'system',
        event: 'db_error',
        error: error?.message || String(error),
        stack: error?.stack,
        query_description: `Save ${role} message to ${table}`,
        session_id: sessionId,
        code: error?.code,
      });
      throw formatTranscriptTableError(error, table);
    }
    return data;
  }

  const payloadWithT = {
    ...basePayload,
    t: t?.trim() || null,
  };

  const { data, error } = await supabase.from(table).insert(payloadWithT).select().single();

  if (!error) return data;

  if (table === TEST_UI_TRANSCRIPTS_TABLE && isMissingSophiaSandboxTColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await supabase.from(table).insert(basePayload).select().single();

    if (fallbackError) {
      safeLog({
        level: 'error',
        category: 'system',
        event: 'db_error',
        error: fallbackError?.message || String(fallbackError),
        stack: fallbackError?.stack,
        query_description: `Save fallback ${role} message to ${table}`,
        session_id: sessionId,
        code: fallbackError?.code,
      });
      throw formatTranscriptTableError(fallbackError, table);
    }
    return fallbackData;
  }

  safeLog({
    level: 'error',
    category: 'system',
    event: 'db_error',
    error: error?.message || String(error),
    stack: error?.stack,
    query_description: `Save ${role} message to ${table}`,
    session_id: sessionId,
    code: error?.code,
  });
  throw formatTranscriptTableError(error, table);
}

function normalizeTranscriptContent(content: string) {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function findRecentDuplicateUserMessage(
  sessionId: string,
  content: string,
  excludeMessageId?: string,
  windowMs = 30_000
) {
  const normalizedContent = normalizeTranscriptContent(content);
  if (!normalizedContent) return null;

  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await supabase
    .from('transcripts')
    .select('id, content, created_at')
    .eq('session_id', sessionId)
    .eq('role', 'user')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  return (data || []).find((message: any) => {
    if (excludeMessageId && message.id === excludeMessageId) return false;
    return normalizeTranscriptContent(message.content || '') === normalizedContent;
  }) || null;
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
      .not('status', 'in', '("expired","completed")')
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
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Load session before expiring',
      session_id: sessionId,
      code: error?.code,
    });
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

  if (existingSession.status === 'expired' || existingSession.status === 'completed') {
    return {
      ...existingSession,
      metadata: nextMetadata,
    };
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({
      status: 'expired',
      updated_at: new Date().toISOString(),
      metadata: nextMetadata,
    })
    .eq('id', sessionId)
    .not('status', 'in', '("expired","completed")')
    .select('id, status, metadata')
    .maybeSingle();

  if (updateError) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: updateError?.message || String(updateError),
      stack: updateError?.stack,
      query_description: 'Expire session',
      session_id: sessionId,
      code: updateError?.code,
    });
    throw updateError;
  }

  if (updatedSession) {
    safeLog({
      level: 'info',
      category: 'session',
      event: 'session_closed',
      session_id: sessionId,
      reason: 'timeout',
    });
  }

  return (
    updatedSession || {
      ...existingSession,
      status: 'expired',
      metadata: nextMetadata,
    }
  );
}

// Mark a session as completed
export async function completeSession(salonId: string, clientIdentifier: string) {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('salon_id', salonId)
    .eq('client_identifier', clientIdentifier)
    .in('status', ['active', 'needs_approval']);

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      tenant_id: salonId,
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Complete active session',
      code: error?.code,
    });
    throw error;
  }

  safeLog({
    level: 'info',
    category: 'session',
    event: 'session_closed',
    tenant_id: salonId,
    reason: 'completed',
  });
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
 * Dashboard: All active/review/escalated sessions across all salons.
 * Returns one row per session (not grouped by phone), so multiple concurrent
 * sessions from the same client all appear in the inbox.
 */
export async function getGroupedSessions(salonId?: string) {
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
    .in('status', ['active', 'needs_approval', 'escalated'])
    .order('updated_at', { ascending: false });

  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const visibleSessions = (data || []).filter((session: any) => !isTestUiSession(session));

  const sessions = visibleSessions.map((s: any) => ({
    ...s,
    has_review: s.status === 'needs_approval',
    has_escalation: s.status === 'escalated',
    last_question: null as string | null,
    draft_response: null as string | null,
  }));

  const sessionIds = sessions.map((s: any) => s.id);

  // Batch fetch the latest transcript message per session
  if (sessionIds.length > 0) {
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('session_id, content, role, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });

    for (const t of (transcripts || [])) {
      const session = sessions.find((s: any) => s.id === t.session_id);
      if (!session) continue;

      if (t.role === 'user' && !session.last_question) {
        session.last_question = t.content;
      }
      if (t.role === 'draft' && !session.draft_response) {
        session.draft_response = t.content;
      }
    }
  }

  return sessions;
}

/**
 * Dashboard: archived/expired sessions.
 * This intentionally returns one row per session, so repeat conversations from
 * the same phone number remain visible as separate history entries.
 */
export async function getHistorySessions(salonId?: string, limit = 100) {
  let query = supabase
    .from('sessions')
    .select('id, client_identifier, status, platform, created_at, updated_at, metadata, salon_id, summary, business_profiles(name)')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (salonId) {
    query = query.eq('salon_id', salonId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const liveStatuses = new Set(['active', 'needs_approval', 'escalated']);

  return (data || [])
    .filter((session: any) => {
      if (isTestUiSession(session)) return false;
      return !liveStatuses.has(session.status);
    })
    .map((session: any) => {
      const occurredAt = session.updated_at || session.created_at;

      let outcome = session.summary;
      if (!outcome && session.status === 'expired') outcome = 'Session timed out before the conversation was completed.';
      if (!outcome && session.status === 'completed') outcome = 'Conversation completed.';
      if (!outcome && session.status === 'escalated') outcome = 'Conversation was escalated to the team.';
      if (!outcome) outcome = 'Outcome summary pending.';

      return {
        ...session,
        occurred_at: occurredAt,
        outcome,
        is_expired: session.status === 'expired',
      };
    });
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

function getPhoneSearchTerms(phone: string) {
  const trimmed = phone.trim().replace(/[%_]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  const terms = [trimmed];

  if (digits) {
    terms.push(digits);

    if (digits.startsWith('00') && digits.length > 2) {
      terms.push(`+${digits.slice(2)}`, digits.slice(2));
    }

    if (digits.startsWith('0') && digits.length > 1) {
      terms.push(`+44${digits.slice(1)}`, `44${digits.slice(1)}`);
    }

    if (!digits.startsWith('0') && !digits.startsWith('00')) {
      terms.push(`+${digits}`);
    }
  }

  return Array.from(new Set(terms.filter(term => term.length >= 2)));
}

export async function searchSessionsByPhone(phone: string, salonId?: string) {
  const terms = getPhoneSearchTerms(phone);

  if (terms.length === 0) {
    return [];
  }

  const matchQueries = await Promise.all(
    terms.map(term => {
      let query = supabase
        .from('sessions')
        .select('client_identifier, metadata')
        .ilike('client_identifier', `%${term}%`)
        .limit(50);

      if (salonId) {
        query = query.eq('salon_id', salonId);
      }

      return query;
    })
  );

  const matchError = matchQueries.find(result => result.error)?.error;
  if (matchError) throw matchError;

  const matchedPhones = Array.from(
    new Set(
      matchQueries
        .flatMap(result => result.data || [])
        .filter((session: any) => !isTestUiSession(session))
        .map((session: any) => session.client_identifier)
        .filter(Boolean)
    )
  );

  if (matchedPhones.length === 0) {
    return [];
  }

  let sessionsQuery = supabase
    .from('sessions')
    .select('id, client_identifier, created_at, status, salon_id, metadata, summary, business_profiles(name)')
    .in('client_identifier', matchedPhones)
    .order('created_at', { ascending: false });

  if (salonId) {
    sessionsQuery = sessionsQuery.eq('salon_id', salonId);
  }

  const { data: sessions, error: sError } = await sessionsQuery;

  if (sError) throw sError;

  const visibleSessions = Array.from(
    new Map(
      (sessions || [])
        .filter((session: any) => !isTestUiSession(session))
        .map((session: any) => [session.id, session])
    ).values()
  );

  // For each session, get the first user message for context and determine outcome
  const results = await Promise.all(visibleSessions.map(async (s: any) => {
    const { data: transcript } = await supabase
      .from('transcripts')
      .select('content, role')
      .eq('session_id', s.id)
      .order('created_at', { ascending: true });
    
    const firstUserMsg = transcript?.find(m => m.role === 'user')?.content || 'No user messages yet';
    
    // Determine outcome
    let outcome = s.summary || 'Enquiry';
    if (s.status === 'escalated') outcome = 'Escalated';
    if (s.status === 'needs_approval') outcome = 'Awaiting Approval';
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
