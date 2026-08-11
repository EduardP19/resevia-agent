import { supabase } from '@/lib/supabase';
import { notifyOwnerConversationAttention } from '@/lib/owner-email-notifications';
import { safeLog } from '@/lib/logger';

const DELAY_MS = 60_000;

// In-process timers keyed by session_id. Cleared if the session is viewed.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function scheduleDeferredNotification(input: {
  conversationId: string;
  salonId: string;
  status: 'needs_approval' | 'escalated';
  clientPhone?: string | null;
}) {
  const sendAfter = new Date(Date.now() + DELAY_MS).toISOString();

  // Upsert: one pending row per session (replace any previous pending one).
  await supabase.from('pending_notifications').delete().eq('session_id', input.conversationId);
  await supabase.from('pending_notifications').insert({
    session_id: input.conversationId,
    salon_id: input.salonId,
    status: input.status,
    client_phone: input.clientPhone ?? null,
    send_after: sendAfter,
  });

  // Clear any existing in-process timer for this session.
  const existing = pendingTimers.get(input.conversationId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingTimers.delete(input.conversationId);
    await firePendingNotification(input.conversationId);
  }, DELAY_MS);

  pendingTimers.set(input.conversationId, timer);

  safeLog({
    type: 'audit',
    level: 'info',
    category: 'auth',
    event: 'owner_notification_scheduled',
    tenant_id: input.salonId,
    session_id: input.conversationId,
    send_after: sendAfter,
  });
}

export async function cancelDeferredNotification(sessionId: string) {
  const timer = pendingTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(sessionId);
  }

  const { data } = await supabase
    .from('pending_notifications')
    .delete()
    .eq('session_id', sessionId)
    .select('id')
    .limit(1);

  if (data && data.length > 0) {
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'auth',
      event: 'owner_notification_cancelled',
      session_id: sessionId,
      reason: 'session_viewed',
    });
  }
}

async function firePendingNotification(sessionId: string) {
  const { data: row } = await supabase
    .from('pending_notifications')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (!row) return; // Was cancelled between timer fire and now.

  await supabase.from('pending_notifications').delete().eq('session_id', sessionId);

  await notifyOwnerConversationAttention({
    conversationId: row.session_id,
    salonId: row.salon_id,
    status: row.status as 'needs_approval' | 'escalated',
    clientPhone: row.client_phone,
  });
}
