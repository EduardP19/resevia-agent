import { NextRequest, NextResponse } from 'next/server';
import { searchSessionsByPhone } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 });

  try {
    const results = await searchSessionsByPhone(phone);
    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
