import Link from 'next/link';
import Logo from './Logo';
import { PlaygroundProvider } from './PlaygroundContext';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlaygroundProvider>
      <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 flex items-center space-x-3">
          <Logo className="w-10 h-10" />
          <h1 className="text-2xl font-bold text-gray-900">
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
          <Link href="/dashboard/analytics" className="flex items-center px-4 py-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors group">
            <span className="font-medium">Analytics</span>
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
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-widest">
            Salon Console
          </div>
          <div className="flex items-center space-x-6">
             <NotificationBell />
             <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight">
                Dev Mode
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 bg-[#fdfdfd]">
          {children}
        </div>
      </main>
    </div>
    </PlaygroundProvider>
  );
}
