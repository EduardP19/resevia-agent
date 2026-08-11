import React from 'react';
import { supabase } from '@/lib/supabase';
import ProfileEditor from './ProfileEditor';
import UsageCard from './UsageCard';
import { safeLog } from '@/lib/logger';
import { requireDashboardSession } from '@/lib/dashboard-auth';
import { getTenantApiSpend } from '@/lib/token-usage';
import { getAgentName } from '@/lib/agent-name';

export const revalidate = 0;

export default async function SettingsPage() {
  const auth = requireDashboardSession();
  const [{ data: salon }, spend] = await Promise.all([
    supabase.from('business_profiles').select('*').eq('id', auth.tenantId).single(),
    getTenantApiSpend(auth.tenantId),
  ]);
  safeLog({
    type: 'interaction',
    level: 'info',
    category: 'dashboard',
    event: 'page_loaded',
    tenant_id: salon?.id,
    page: 'dashboard/settings',
  });
  const agentName = getAgentName(salon);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-2.5 mb-1">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl"
            style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #C9A96E 100%)' }}
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#271549' }}>Settings</h2>
        </div>
        <p className="text-sm text-gray-400 ml-[42px]">
          Customise how {agentName} represents your business and handles client conversations.
        </p>
      </div>

      {salon ? (
        <>
          <UsageCard spend={spend} agentName={agentName} />
          <ProfileEditor salon={salon} />
        </>
      ) : (
        <div
          className="p-12 text-center bg-white rounded-2xl text-gray-400"
          style={{ border: '2px dashed rgba(109,40,217,0.15)' }}
        >
          No salon profile found.
        </div>
      )}
    </div>
  );
}
