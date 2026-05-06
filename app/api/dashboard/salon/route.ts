import { NextRequest, NextResponse } from 'next/server';
import { supabase, updateSalonProfile } from '@/lib/supabase';

export async function GET() {
  const { data } = await supabase.from('business_profiles').select('id, approval_mode').limit(1).single();
  return NextResponse.json(data ?? {});
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const data = await updateSalonProfile(id, updates);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
