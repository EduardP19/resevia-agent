'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';
import PageViewTracker from '../../PageViewTracker';

export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const triggerCleanup = () => fetch('/api/cron/cleanup').catch(() => {});
    triggerCleanup();

    const interval = setInterval(() => {
      trackClientEvent({ event: 'dashboard_auto_refresh_tick', category: 'dashboard', interval_ms: intervalMs });
      triggerCleanup();
      router.refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return <PageViewTracker page="dashboard/inbox" />;
}
