import { NextRequest, NextResponse } from 'next/server';
import { createFAQ, updateFAQ, deleteFAQ, supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';

export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const faq = await req.json();
    const data = await createFAQ({ ...faq, salon_id: auth.session.tenantId });
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: auth.session.tenantId,
      user_id: auth.session.email,
      fields_changed: ['faq_created'],
    });
    return NextResponse.json(data);
  } catch (err: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Create FAQ',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { id, ...faq } = await req.json();
    const { data: existing } = await supabase
      .from('faqs')
      .select('salon_id')
      .eq('id', id)
      .eq('salon_id', auth.session.tenantId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
    }

    const data = await updateFAQ(id, faq);
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: auth.session.tenantId,
      user_id: auth.session.email,
      fields_changed: Object.keys(faq),
    });
    return NextResponse.json(data);
  } catch (err: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Update FAQ',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await req.json();
    const { data: existing } = await supabase
      .from('faqs')
      .select('salon_id')
      .eq('id', id)
      .eq('salon_id', auth.session.tenantId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
    }

    await deleteFAQ(id);
    safeLog({
      type: 'audit',
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: auth.session.tenantId,
      user_id: auth.session.email,
      fields_changed: ['faq_deleted'],
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Delete FAQ',
      tenant_id: auth.session.tenantId,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
