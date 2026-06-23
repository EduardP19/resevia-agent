'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
}

const inputClass = "w-full bg-[#faf8fd] border border-[#e8e0f0] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all";
const OTHER_CATEGORY_OPTION = '__other__';

export default function FAQEditor({ initialFaqs, salonId, agentName }: { initialFaqs: FAQ[]; salonId: string; agentName: string }) {
  const categoryOptions = useMemo(() => {
    const unique = new Set(
      initialFaqs
        .map((faq) => faq.category.trim())
        .filter((category) => category.length > 0)
    );
    unique.add('General');
    const sorted = Array.from(unique).sort((a, b) => a.localeCompare(b));
    return ['General', ...sorted.filter((category) => category !== 'General')];
  }, [initialFaqs]);

  const [isAdding, setIsAdding] = useState(false);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  const [newCategorySelection, setNewCategorySelection] = useState('General');
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ question: '', answer: '' });
  const [editCategorySelection, setEditCategorySelection] = useState('');
  const [editCustomCategory, setEditCustomCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const resolveCategory = (selection: string, customCategory: string) =>
    selection === OTHER_CATEGORY_OPTION ? customCategory.trim() : selection.trim();

  const handleAdd = async () => {
    const resolvedCategory = resolveCategory(newCategorySelection, newCustomCategory);
    if (!newFaq.question.trim() || !newFaq.answer.trim() || !resolvedCategory) return;
    trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'faq_add_submit', tenant_id: salonId });
    setSaving(true);
    const res = await fetch('/api/dashboard/faqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newFaq, category: resolvedCategory, salon_id: salonId }),
    });
    setSaving(false);
    if (res.ok) {
      trackClientEvent({ event: 'settings_updated', category: 'dashboard', tenant_id: salonId, fields_changed: ['faq_created'] });
      setIsAdding(false);
      setNewFaq({ question: '', answer: '' });
      setNewCategorySelection('General');
      setNewCustomCategory('');
      router.refresh();
    }
  };

  const startEdit = (faq: FAQ) => {
    setEditingId(faq.id);
    const trimmedCategory = faq.category.trim();
    const isCurrentCategory = categoryOptions.includes(trimmedCategory);
    setEditCategorySelection(isCurrentCategory ? trimmedCategory : OTHER_CATEGORY_OPTION);
    setEditCustomCategory(isCurrentCategory ? '' : trimmedCategory);
    setEditData({ question: faq.question, answer: faq.answer });
  };

  const handleUpdate = async () => {
    const resolvedCategory = resolveCategory(editCategorySelection, editCustomCategory);
    if (!editData.question.trim() || !editData.answer.trim() || !editingId || !resolvedCategory) return;
    trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'faq_update_submit', tenant_id: salonId });
    setSaving(true);
    const res = await fetch('/api/dashboard/faqs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, ...editData, category: resolvedCategory }),
    });
    setSaving(false);
    if (res.ok) {
      trackClientEvent({ event: 'settings_updated', category: 'dashboard', tenant_id: salonId, fields_changed: ['faq_updated'] });
      setEditingId(null);
      setEditCategorySelection('');
      setEditCustomCategory('');
      router.refresh();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return;
    trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'faq_delete_confirm', tenant_id: salonId });
    const res = await fetch('/api/dashboard/faqs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      trackClientEvent({ event: 'settings_updated', category: 'dashboard', tenant_id: salonId, fields_changed: ['faq_deleted'] });
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {/* Add FAQ button */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'faq_add_open', tenant_id: salonId });
            setIsAdding(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.25)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          Add FAQ
        </button>
      </div>

      {/* Add form */}
      {isAdding && (
        <div
          className="bg-white rounded-2xl p-6 space-y-4"
          style={{ border: '1px solid rgba(109,40,217,0.2)', boxShadow: '0 8px 32px rgba(109,40,217,0.1)' }}
        >
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">New FAQ</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Category</label>
              <div className="space-y-2">
                <select
                  value={newCategorySelection}
                  onChange={(e) => setNewCategorySelection(e.target.value)}
                  className={inputClass}
                >
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value={OTHER_CATEGORY_OPTION}>Other</option>
                </select>
                {newCategorySelection === OTHER_CATEGORY_OPTION && (
                  <input
                    type="text"
                    placeholder="Enter new category"
                    value={newCustomCategory}
                    onChange={(e) => setNewCustomCategory(e.target.value)}
                    className={inputClass}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Question</label>
              <input
                type="text"
                value={newFaq.question}
                onChange={e => setNewFaq({ ...newFaq, question: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Answer</label>
            <textarea
              rows={3}
              value={newFaq.answer}
              onChange={e => setNewFaq({ ...newFaq, answer: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewCategorySelection('General');
                setNewCustomCategory('');
              }}
              className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)' }}
            >
              {saving ? 'Saving…' : 'Save FAQ'}
            </button>
          </div>
        </div>
      )}

      {/* FAQ list */}
      <div
        className="bg-white rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 2px 16px rgba(109,40,217,0.07)', border: '1px solid rgba(109,40,217,0.08)' }}
      >
        <div className="divide-y divide-[#f0ebfa]">
          {initialFaqs.map(faq => (
            <div key={faq.id} className="p-5 hover:bg-[#faf8fd]/60 transition-colors group">
              {editingId === faq.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Category</label>
                      <div className="space-y-2">
                        <select
                          value={editCategorySelection}
                          onChange={(e) => setEditCategorySelection(e.target.value)}
                          className={inputClass}
                        >
                          {categoryOptions.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                          <option value={OTHER_CATEGORY_OPTION}>Other</option>
                        </select>
                        {editCategorySelection === OTHER_CATEGORY_OPTION && (
                          <input
                            type="text"
                            placeholder="Enter new category"
                            value={editCustomCategory}
                            onChange={(e) => setEditCustomCategory(e.target.value)}
                            className={inputClass}
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Question</label>
                      <input
                        type="text"
                        value={editData.question}
                        onChange={e => setEditData({ ...editData, question: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Answer</label>
                    <textarea
                      rows={3}
                      value={editData.answer}
                      onChange={e => setEditData({ ...editData, answer: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditCategorySelection('');
                        setEditCustomCategory('');
                      }}
                      className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdate}
                      disabled={saving}
                      className="px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
                      style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)' }}
                    >
                      {saving ? 'Saving…' : 'Update'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase mb-2"
                      style={{ background: 'rgba(109,40,217,0.08)', color: '#6D28D9' }}
                    >
                      {faq.category}
                    </span>
                    <h4 className="text-sm font-bold text-gray-900 mb-1 leading-snug">{faq.question}</h4>
                    <p className="text-sm text-gray-500 leading-relaxed">{faq.answer}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => startEdit(faq)}
                      className="p-2 rounded-lg transition-colors text-gray-400 hover:text-[#6D28D9] hover:bg-[#6D28D9]/08"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(faq.id)}
                      className="p-2 rounded-lg transition-colors text-gray-400 hover:text-rose-500 hover:bg-rose-50"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {initialFaqs.length === 0 && (
            <div className="p-16 text-center">
              <div
                className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'rgba(109,40,217,0.08)' }}
              >
                <svg className="w-6 h-6" style={{ color: '#6D28D9' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-400 mb-1">No entries yet</p>
              <p className="text-xs text-gray-400">Add FAQs to help {agentName} answer common questions accurately.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
