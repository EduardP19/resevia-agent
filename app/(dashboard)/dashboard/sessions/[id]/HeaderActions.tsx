'use client';

export default function HeaderActions({ isReview }: { isReview: boolean }) {
  const focusInput = () => {
    (window as any).__focusApprovalInput?.();
  };

  return (
    <div className="flex space-x-3">
      <button
        onClick={focusInput}
        className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
      >
        Escalate to Human
      </button>
      <button
        onClick={focusInput}
        className="bg-brand-purple text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
      >
        {isReview ? 'Review & Approve' : 'Send Manual Message'}
      </button>
    </div>
  );
}
