'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Passive Cron: Trigger cleanup logic when dashboard is active
    const triggerCleanup = () => fetch('/api/cron/cleanup').catch(() => {});
    
    triggerCleanup(); // Run immediately on mount

    const interval = setInterval(() => {
      triggerCleanup();
      router.refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}
