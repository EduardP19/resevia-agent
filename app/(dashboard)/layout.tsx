'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NotificationBell from './NotificationBell';
import Logo from './Logo';
import ApprovalToggle from './ApprovalToggle';
import { ApprovalProvider } from './ApprovalContext';
import { trackClientEvent } from '@/lib/client-events';

const navItems = [
  {
    href: '/dashboard/inbox',
    label: 'Inbox',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4m8-7v7" />
      </svg>
    ),
  },
  {
    href: '/dashboard/search',
    label: 'Search',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/knowledge',
    label: 'Knowledge',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'reload') {
      trackClientEvent({
        event: 'page_reload',
        category: 'dashboard',
        page: pathname || '/dashboard',
      });
    }
  }, [pathname]);

  return (
    <ApprovalProvider>
    <div className="flex h-[100dvh] bg-[#f8f6fb] font-sans relative">

      {/* Mobile drawer overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => {
            trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'close_mobile_menu_overlay' });
            setIsMobileMenuOpen(false);
          }}
        />
      )}

      {/* Sidebar — hidden on mobile, always visible on md+ */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 flex flex-col transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0
        `}
        style={{ background: 'linear-gradient(180deg, #1a0a35 0%, #271549 60%, #1a1030 100%)' }}
      >
        {/* Logo + close button row */}
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center space-x-3">
            <Logo className="w-9 h-9 flex-shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight leading-none font-display">Resevia</h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Console</p>
            </div>
          </div>
          <button
            onClick={() => {
              trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'close_mobile_menu' });
              setIsMobileMenuOpen(false);
            }}
            className="md:hidden p-1.5 text-white/40 hover:text-white rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'sidebar_nav_click', page: item.href });
                  setIsMobileMenuOpen(false);
                }}
                className={`
                  flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-150 group
                  ${isActive
                    ? 'bg-white/15 text-white shadow-inset-brand'
                    : 'text-white/50 hover:text-white hover:bg-white/8'
                  }
                `}
              >
                <span className={`transition-colors ${isActive ? 'text-brand-gold' : 'text-white/40 group-hover:text-white/70'}`}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-gold flex-shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Status footer */}
        <div className="p-4 m-3 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center space-x-2.5">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse flex-shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <div>
              <p className="text-xs font-semibold text-white/80">Sophia Online</p>
              <p className="text-[10px] text-white/30 uppercase tracking-widest">AI Agent Active</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden w-full min-w-0">
        {/* Top header */}
        <header
          className="h-14 md:h-16 bg-white/80 backdrop-blur-md border-b border-[#e8e0f0] flex items-center px-4 md:px-8 flex-shrink-0"
          style={{ boxShadow: '0 1px 0 rgba(109,40,217,0.06)' }}
        >
          {/* Left: hamburger (mobile) — invisible placeholder on desktop to preserve layout */}
          <div className="flex-1 flex items-center">
            <button
              onClick={() => {
                trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'open_mobile_menu' });
                setIsMobileMenuOpen(true);
              }}
              className="md:hidden p-2 -ml-1 text-gray-500 hover:bg-[#f0ebfa] rounded-lg transition-colors"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/* Centre: Resevia wordmark on mobile */}
          <span className="md:hidden text-sm font-bold tracking-tight absolute left-1/2 -translate-x-1/2" style={{ color: '#271549' }}>Resevia</span>

          {/* Right: bell + toggle */}
          <div className="flex-1 flex items-center justify-end space-x-2 md:space-x-4">
            <NotificationBell />
            <span className="h-5 w-px bg-gray-200 hidden md:block" />
            <div className="hidden md:block">
              <ApprovalToggle />
            </div>
          </div>
        </header>

        {/* Page content — add pb-16 on mobile to clear the bottom nav */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8 scrollbar-thin">
          {children}
        </div>
      </main>

      {/* Bottom tab bar — mobile only */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex bg-white border-t border-[#e8e0f0]"
        style={{ boxShadow: '0 -4px 24px rgba(109,40,217,0.08)' }}
      >
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                trackClientEvent({ event: 'button_clicked', category: 'dashboard', action: 'mobile_nav_click', page: item.href });
              }}
              className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors"
              style={{ color: isActive ? '#6D28D9' : '#9CA3AF' }}
            >
              <span className={`transition-transform ${isActive ? 'scale-110' : ''}`}>
                {item.icon}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest">{item.label}</span>
              {isActive && (
                <span className="absolute bottom-0 w-8 h-0.5 rounded-t-full" style={{ background: '#6D28D9' }} />
              )}
            </Link>
          );
        })}
      </nav>

    </div>
    </ApprovalProvider>
  );
}
