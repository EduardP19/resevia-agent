import { NextRequest, NextResponse } from 'next/server';
import { updateSalonProfile } from '@/lib/supabase';

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const data = await updateSalonProfile(id, updates);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
