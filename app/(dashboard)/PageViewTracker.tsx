'use client';

import { useEffect } from 'react';
import { trackClientEvent } from '@/lib/client-events';

export default function PageViewTracker({
  page,
  session_id,
  tenant_id,
  extra,
}: {
  page: string;
  session_id?: string;
  tenant_id?: string;
  extra?: Record<string, any>;
}) {
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    trackClientEvent({
      event: 'page_view',
      category: 'dashboard',
      page,
      session_id,
      tenant_id,
      is_reload: nav?.type === 'reload',
      ...extra,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return null;
}
