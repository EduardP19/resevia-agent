'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trackClientEvent } from '@/lib/client-events';
import PageViewTracker from '../../PageViewTracker';

export default function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      trackClientEvent({ event: 'dashboard_auto_refresh_tick', category: 'dashboard', interval_ms: intervalMs });
      router.refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return <PageViewTracker page="dashboard/inbox" />;
}
