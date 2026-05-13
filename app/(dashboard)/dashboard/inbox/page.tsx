import { redirect } from 'next/navigation';

export default async function InboxRedirectPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  if (filter) {
    redirect(`/dashboard/home?filter=${encodeURIComponent(filter)}`);
  }
  redirect('/dashboard/home');
}
