import { NextRequest, NextResponse } from 'next/server';
import { createFAQ, updateFAQ, deleteFAQ } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const faq = await req.json();
    const data = await createFAQ(faq);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...faq } = await req.json();
    const data = await updateFAQ(id, faq);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await deleteFAQ(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
