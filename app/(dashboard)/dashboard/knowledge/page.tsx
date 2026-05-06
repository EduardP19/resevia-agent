import React from 'react';
import { getFAQs, supabase } from '@/lib/supabase';
import FAQEditor from './FAQEditor';

export const revalidate = 0;

export default async function KnowledgeBasePage() {
  const { data: salon } = await supabase.from('business_profiles').select('*').limit(1).single();
  const faqs = salon ? await getFAQs(salon.id) : [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: '#271549' }}>Knowledge Base</h2>
        <p className="text-sm text-gray-400 mt-1">Manage the information Sophia uses to answer client questions.</p>
      </div>

      {salon ? (
        <FAQEditor initialFaqs={faqs} salonId={salon.id} />
      ) : (
        <div
          className="p-12 text-center bg-white rounded-2xl text-gray-400"
          style={{ border: '2px dashed rgba(109,40,217,0.15)' }}
        >
          No salon profile found. Please create one first.
        </div>
      )}
    </div>
  );
}
