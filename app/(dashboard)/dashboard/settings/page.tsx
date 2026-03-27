import React from 'react';
import { supabase } from '@/lib/supabase';
import ProfileEditor from './ProfileEditor';

export const revalidate = 0;

export default async function SettingsPage() {
  const { data: salon } = await supabase.from('business_profiles').select('*').limit(1).single();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Salon Settings</h2>
        <p className="text-gray-500 mt-1">Configure your AI agent's personality and business rules.</p>
      </div>

      {salon ? (
        <ProfileEditor salon={salon} />
      ) : (
        <div>No salon profile found.</div>
      )}
    </div>
  );
}
