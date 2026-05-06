'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ApprovalContextValue {
  mode: boolean | null;
  salonId: string | null;
  saving: boolean;
  toggle: () => Promise<void>;
}

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

export function ApprovalProvider({
  children,
  initialMode,
  initialSalonId,
}: {
  children: ReactNode;
  initialMode?: boolean;
  initialSalonId?: string;
}) {
  const [mode, setMode] = useState<boolean | null>(initialMode ?? null);
  const [salonId, setSalonId] = useState<string | null>(initialSalonId ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialMode !== undefined && initialSalonId) return;
    fetch('/api/dashboard/salon')
      .then(r => r.json())
      .then(d => {
        if (d?.id) { setSalonId(d.id); setMode(!!d.approval_mode); }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    if (saving || mode === null || !salonId) return;
    const next = !mode;
    setSaving(true);
    setMode(next);
    try {
      await fetch('/api/dashboard/salon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: salonId, approval_mode: next }),
      });
    } catch {
      setMode(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ApprovalContext.Provider value={{ mode, salonId, saving, toggle }}>
      {children}
    </ApprovalContext.Provider>
  );
}

export function useApproval() {
  const ctx = useContext(ApprovalContext);
  if (!ctx) throw new Error('useApproval must be used within ApprovalProvider');
  return ctx;
}
