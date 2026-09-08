import { requireDashboardSession } from '@/lib/dashboard-auth';
import { supabase } from '@/lib/supabase';
import type { ClientProfile } from '@/lib/client-profile';
import ClientsDirectory from './ClientsDirectory';

export const revalidate = 0;

export default async function ClientsPage({ searchParams }: { searchParams?: { q?: string; page?: string } }) {
  const auth = requireDashboardSession();
  const query = (searchParams?.q || '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(10000, Number.parseInt(searchParams?.page || '1', 10) || 1));
  let request = supabase.from('clients').select('*', { count: 'exact' }).eq('salon_id', auth.tenantId);
  // PostgREST's OR grammar has delimiters that cannot be accepted as search operators.
  const term = query.replace(/[^\p{L}\p{N}@+ ._-]/gu, '').replace(/[_%]/g, '').trim();
  for (const part of term.split(/\s+/).filter(Boolean)) {
    request = request.or(`first_name.ilike.%${part}%,last_name.ilike.%${part}%,email.ilike.%${part}%,phone.ilike.%${part}%`);
  }
  const { data, count, error } = await request.order('first_name', { ascending: true, nullsFirst: false })
    .order('id').range((page - 1) * 50, page * 50 - 1);
  if (error) return <div role="alert" className="text-sm text-red-700">The client directory is unavailable. Please try again shortly.</div>;
  return <ClientsDirectory clients={(data || []) as ClientProfile[]} total={count || 0} query={query} page={page} />;
}
