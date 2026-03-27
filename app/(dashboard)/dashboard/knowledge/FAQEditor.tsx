'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
}

export default function FAQEditor({ initialFaqs, salonId }: { initialFaqs: FAQ[], salonId: string }) {
  const [faqs, setFaqs] = useState(initialFaqs);
  const [isAdding, setIsAdding] = useState(false);
  const [newFaq, setNewFaq] = useState({ category: 'General', question: '', answer: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();

  const handleAdd = async () => {
    const res = await fetch('/api/dashboard/faqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newFaq, salon_id: salonId }),
    });
    if (res.ok) {
      setIsAdding(false);
      setNewFaq({ category: 'General', question: '', answer: '' });
      router.refresh();
      // Optimistic update would be better but refresh is safer for now
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure?')) return;
    const res = await fetch('/api/dashboard/faqs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-brand-purple text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
        >
          + Add New FAQ
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl border-2 border-brand-purple/20 shadow-xl space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Category</label>
              <input 
                type="text" 
                value={newFaq.category} 
                onChange={e => setNewFaq({...newFaq, category: e.target.value})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-black"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Question</label>
              <input 
                type="text" 
                value={newFaq.question} 
                onChange={e => setNewFaq({...newFaq, question: e.target.value})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-black"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Answer</label>
            <textarea 
              rows={3}
              value={newFaq.answer} 
              onChange={e => setNewFaq({...newFaq, answer: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-black"
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button onClick={() => setIsAdding(false)} className="px-4 py-2 text-sm font-semibold text-gray-500">Cancel</button>
            <button onClick={handleAdd} className="bg-brand-purple text-white px-6 py-2 rounded-lg text-sm font-bold">Save FAQ</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-100">
          {initialFaqs.map(faq => (
            <div key={faq.id} className="p-6 hover:bg-gray-50/50 transition-colors group">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-bold uppercase mb-2">
                    {faq.category}
                  </span>
                  <h4 className="text-lg font-bold text-gray-900 mb-1">{faq.question}</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">{faq.answer}</p>
                </div>
                <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleDelete(faq.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
          {initialFaqs.length === 0 && (
            <div className="p-12 text-center text-gray-400">
              No entries in the knowledge base yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
