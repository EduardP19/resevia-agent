import React from 'react';
import { supabase } from '@/lib/supabase';
import ProfileEditor from './ProfileEditor';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';

export const revalidate = 0;

export default async function SettingsPage() {
  const auth = requireDashboardSession();
  const { data: salon } = await supabase.from('business_profiles').select('*').eq('id', auth.tenantId).single();
  safeLog({
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: salon?.id,
    page: 'dashboard/settings',
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: '#271549' }}>Settings</h2>
        <p className="text-sm text-gray-400 mt-1">Configure your AI agent's personality and business rules.</p>
      </div>

      {salon ? (
        <ProfileEditor salon={salon} />
      ) : (
        <div className="p-12 text-center bg-white rounded-2xl text-gray-400"
          style={{ border: '2px dashed rgba(109,40,217,0.15)' }}>
          No salon profile found.
        </div>
      )}
    </div>
  );
}
