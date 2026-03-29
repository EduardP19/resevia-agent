'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import NotificationBell from './NotificationBell';
import Logo from './Logo';
import { PlaygroundProvider } from './PlaygroundContext';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <PlaygroundProvider>
      <div className="flex h-screen bg-gray-50 font-sans relative">
        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0
        `}>
          <div className="p-6 flex items-center space-x-3">
            <Logo className="w-10 h-10" />
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Resevia
            </h1>
          </div>
          
          <nav className="flex-1 px-4 space-y-1">
            <Link href="/dashboard/inbox" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
              <span className="font-medium">Inbox</span>
            </Link>
            <Link href="/dashboard/search" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
              <span className="font-medium">Search</span>
            </Link>
            <Link href="/dashboard/playground" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
              <span className="font-medium">AI Playground</span>
            </Link>
            <Link href="/dashboard/knowledge" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
              <span className="font-medium">Knowledge Base</span>
            </Link>
            <Link href="/dashboard/settings" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
              <span className="font-medium">Settings</span>
            </Link>
          </nav>

          <div className="p-4 border-t border-gray-100">
            <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              System Status
            </div>
            <div className="mt-2 px-4 flex items-center space-x-2">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Sophia Online</span>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden w-full">
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-8">
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                aria-label="Open mobile menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
              </button>
              <div className="text-sm font-medium text-gray-500 uppercase tracking-widest truncate">
                Salon Console
              </div>
            </div>
            <div className="flex items-center space-x-3 md:space-x-6">
               <NotificationBell />
               <div className="bg-orange-100 text-orange-700 px-2 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-tight whitespace-nowrap">
                  Dev Mode
               </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#fdfdfd]">
            {children}
          </div>
        </main>
      </div>
    </PlaygroundProvider>
  );
}
