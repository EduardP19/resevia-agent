'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';

export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Passive Cron: Trigger cleanup logic when dashboard is active
    const triggerCleanup = () => fetch('/api/cron/cleanup').catch(() => {});
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'reload') {
      trackClientEvent({ event: 'page_reload', category: 'dashboard', page: 'dashboard/inbox' });
    }

    triggerCleanup(); // Run immediately on mount

    const interval = setInterval(() => {
      trackClientEvent({ event: 'dashboard_auto_refresh_tick', category: 'dashboard', interval_ms: intervalMs });
      triggerCleanup();
      router.refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}
