import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDashboardSessionFromRequest } from '@/lib/dashboard-auth';
import { normalizeClientPhone } from '@/lib/client-profile';
import { supabase } from '@/lib/supabase';

const contactSchema = z.object({
  first_name: z.string().trim().max(100),
  last_name: z.string().trim().max(100),
  email: z.union([z.string().trim().email().max(254), z.literal('')]),
  notes: z.string().trim().max(4000),
});

export async function POST(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;
  const parsed = contactSchema.extend({ phone: z.string().min(1).max(50) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the contact details and email address.' }, { status: 400 });
  const phone = normalizeClientPhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: 'Enter a valid phone number with its country code.' }, { status: 400 });
  const { first_name, last_name, email, notes } = parsed.data;
  const { data, error } = await supabase.from('clients').insert({
    salon_id: auth.session.tenantId, phone,
    first_name: first_name || null, last_name: last_name || null, email: email.toLowerCase() || null,
    metadata: { notes },
  }).select('id, phone').single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'A client with this phone number already exists.' : 'Could not save the client.' }, { status: error.code === '23505' ? 409 : 500 });
  return NextResponse.json({ client: data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = requireDashboardSessionFromRequest(req);
  if (auth.response) return auth.response;
  const parsed = contactSchema.extend({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the contact details and email address.' }, { status: 400 });
  const { id, first_name, last_name, email, notes } = parsed.data;
  const { data: existing, error: readError } = await supabase.from('clients').select('metadata')
    .eq('id', id).eq('salon_id', auth.session.tenantId).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Could not load the client.' }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  const { data, error } = await supabase.from('clients').update({
    first_name: first_name || null, last_name: last_name || null, email: email.toLowerCase() || null,
    metadata: { ...existing.metadata, notes }, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('salon_id', auth.session.tenantId).select('id, phone').maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not save the client.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  return NextResponse.json({ client: data });
}
