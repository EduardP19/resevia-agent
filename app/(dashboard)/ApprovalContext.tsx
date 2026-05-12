'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { trackClientEvent } from '@/lib/client-events';

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
    trackClientEvent({
      event: 'button_clicked',
      category: 'dashboard',
      action: 'approval_toggle',
      tenant_id: salonId,
      next_mode: next ? 'manual' : 'auto',
    });
    setSaving(true);
    setMode(next);
    try {
      const res = await fetch('/api/dashboard/salon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: salonId, approval_mode: next }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update approval mode (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.approval_mode === 'boolean') {
        setMode(data.approval_mode);
        trackClientEvent({
          event: 'settings_updated',
          category: 'dashboard',
          tenant_id: salonId,
          fields_changed: ['approval_mode'],
          mode: data.approval_mode ? 'manual' : 'auto',
        });
      }
    } catch {
      trackClientEvent({
        event: 'settings_update_failed',
        category: 'dashboard',
        level: 'warn',
        tenant_id: salonId,
        fields_changed: ['approval_mode'],
      });
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
