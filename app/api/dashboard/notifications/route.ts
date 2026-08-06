import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase, isTestUiSession } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

const MAX_ITEMS = 10;

/**
 * Feeds the header notification bell: the sessions waiting on the owner
 * (escalations + drafts pending approval), newest first.
 */
export async function GET(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from('sessions')
    .select('id, client_identifier, status, channel, updated_at, metadata')
    .eq('salon_id', auth.session.tenantId)
    .in('status', ['escalated', 'needs_approval'])
    .order('updated_at', { ascending: false });

  if (error) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Fetch dashboard notifications',
      tenant_id: auth.session.tenantId,
      code: error?.code,
    });
    return NextResponse.json({ count: 0, items: [] });
  }

  const sessions = (data || []).filter((session: any) => !isTestUiSession(session));
  const items = sessions.slice(0, MAX_ITEMS).map((s: any) => ({
    id: s.id,
    client_identifier: s.client_identifier,
    status: s.status,
    channel: s.channel || 'sms',
    updated_at: s.updated_at,
    preview: null as string | null,
  }));

  // Batch fetch the latest transcript per session for the preview line:
  // the pending draft when one is awaiting approval, otherwise the customer's last message.
  if (items.length > 0) {
    const { data: transcripts, error: transcriptError } = await supabase
      .from('transcripts')
      .select('session_id, content, role, created_at')
      .in('session_id', items.map((i) => i.id))
      .in('role', ['user', 'draft'])
      .order('created_at', { ascending: false });

    if (transcriptError) {
      safeLog({
        level: 'warning',
        category: 'system',
        event: 'db_error',
        error: transcriptError?.message || String(transcriptError),
        query_description: 'Fetch dashboard notification previews',
        tenant_id: auth.session.tenantId,
        code: transcriptError?.code,
      });
    }

    const latestDraft = new Map<string, string>();
    const latestUser = new Map<string, string>();
    for (const t of transcripts || []) {
      const bucket = t.role === 'draft' ? latestDraft : latestUser;
      if (!bucket.has(t.session_id)) bucket.set(t.session_id, t.content);
    }

    for (const item of items) {
      const draft = latestDraft.get(item.id);
      item.preview =
        item.status === 'needs_approval' && draft
          ? draft
          : latestUser.get(item.id) || draft || null;
    }
  }

  return NextResponse.json({ count: sessions.length, items });
}
