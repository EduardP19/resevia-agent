import { NextRequest, NextResponse } from 'next/server';
import { searchSessionsByPhone } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 });

  try {
    const results = await searchSessionsByPhone(phone);
    return NextResponse.json(results);
  } catch (err: any) {
    safeLog({
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: err?.message || String(err),
      stack: err?.stack,
      query_description: 'Dashboard search sessions by phone',
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
