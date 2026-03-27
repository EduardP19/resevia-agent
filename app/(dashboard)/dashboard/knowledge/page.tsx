import React from 'react';
import { getFAQs, supabase } from '@/lib/supabase';
import FAQEditor from './FAQEditor';

export const revalidate = 0;

export default async function KnowledgeBasePage() {
  // For now, we'll use Amo Salon's ID as default or show all
  const { data: salon } = await supabase.from('business_profiles').select('*').limit(1).single();
  const faqs = salon ? await getFAQs(salon.id) : [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Knowledge Base</h2>
        <p className="text-gray-500 mt-1">Manage the information Sophia uses to answer client questions.</p>
      </div>

      {salon ? (
        <FAQEditor initialFaqs={faqs} salonId={salon.id} />
      ) : (
        <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400">
            No salon profile found. Please create one first.
        </div>
      )}
    </div>
  );
}
