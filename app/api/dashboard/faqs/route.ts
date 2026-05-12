import { NextRequest, NextResponse } from 'next/server';
import { createFAQ, updateFAQ, deleteFAQ } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const faq = await req.json();
    const data = await createFAQ(faq);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      tenant_id: faq?.salon_id,
      user_id: req.headers.get('x-user-id') || undefined,
      fields_changed: ['faq_created'],
    });
    return NextResponse.json(data);
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Create FAQ',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...faq } = await req.json();
    const data = await updateFAQ(id, faq);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      user_id: req.headers.get('x-user-id') || undefined,
      fields_changed: Object.keys(faq),
    });
    return NextResponse.json(data);
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Update FAQ',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await deleteFAQ(id);
    safeLog({
      level: 'info',
      category: 'dashboard',
      event: 'settings_updated',
      user_id: req.headers.get('x-user-id') || undefined,
      fields_changed: ['faq_deleted'],
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Delete FAQ',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
