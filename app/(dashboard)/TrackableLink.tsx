'use client';

import Link from 'next/link';
import { trackClientEvent } from '@/lib/client-events';
import type { ComponentProps } from 'react';

type Props = ComponentProps<typeof Link> & {
  trackEvent: string;
  trackProps?: Record<string, any>;
};

export default function TrackableLink({ trackEvent, trackProps, onClick, children, ...rest }: Props) {
  return (
    <Link
      {...rest}
      onClick={(e) => {
        trackClientEvent({ event: trackEvent, category: 'dashboard', ...trackProps });
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );
}
