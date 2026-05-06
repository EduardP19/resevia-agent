'use client';

export default function HeaderActions({ isReview }: { isReview: boolean }) {
  if (!isReview) return null;

  const focusInput = () => {
    (window as any).__focusApprovalInput?.();
  };

  return (
    <button
      onClick={focusInput}
      className="px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-95"
      style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
    >
      Review & Approve
    </button>
  );
}
