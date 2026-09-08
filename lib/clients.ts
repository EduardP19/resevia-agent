import { supabase } from '@/lib/supabase';
import { normalizeClientPhone, type ClientProfile } from '@/lib/client-profile';
import { safeLog } from '@/lib/logger';

export async function getClientByPhone(salonId: string, rawPhone: string): Promise<ClientProfile | null> {
  const phone = normalizeClientPhone(rawPhone);
  if (!phone) return null;
  const { data, error } = await supabase.from('clients').select('*')
    .eq('salon_id', salonId).eq('phone', phone).maybeSingle();
  if (error) {
    safeLog({ type: 'error', level: 'error', category: 'system', event: 'client_lookup_failed',
      tenant_id: salonId, error: error.message });
    // Recognition must not interrupt a call if the database is temporarily unavailable.
    return null;
  }
  return data as ClientProfile | null;
}
