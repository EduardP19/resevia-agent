import { redirect } from 'next/navigation';
import Logo from '@/app/(dashboard)/Logo';
import { getDashboardSession, sanitizeDashboardRedirect } from '@/lib/dashboard-auth';

export const revalidate = 0;

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string };
}) {
  const next = sanitizeDashboardRedirect(searchParams?.next);
  const session = getDashboardSession();

  if (session) {
    redirect(next);
  }

  const errorMessage =
    searchParams?.error === 'tenant'
      ? 'Those credentials are configured, but the tenant profile could not be found.'
      : searchParams?.error
      ? 'Email or password is incorrect.'
      : null;

  return (
    <main className="min-h-[100dvh] bg-[#f8f6fb] flex items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-md bg-white rounded-2xl p-8"
        style={{ boxShadow: '0 24px 70px rgba(39,21,73,0.14)', border: '1px solid rgba(109,40,217,0.1)' }}
      >
        <div className="flex items-center gap-3 mb-8">
          <Logo className="w-10 h-10 flex-shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#271549' }}>Resevia</h1>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest">Tenant Console</p>
          </div>
        </div>

        <form action="/api/auth/login" method="post" className="space-y-5">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Email
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full bg-[#faf8fd] border border-[#e8e0f0] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all"
              placeholder="tenant@example.com"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full bg-[#faf8fd] border border-[#e8e0f0] rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 transition-all"
              placeholder="••••••••"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              name="remember"
              defaultChecked
              className="h-4 w-4 rounded border-[#d9cdee] text-[#6D28D9] focus:ring-[#6D28D9]"
            />
            Keep me logged in on this device
          </label>

          {errorMessage && (
            <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            className="w-full px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)', boxShadow: '0 4px 16px rgba(109,40,217,0.3)' }}
          >
            Log in
          </button>
        </form>
      </div>
    </main>
  );
}
