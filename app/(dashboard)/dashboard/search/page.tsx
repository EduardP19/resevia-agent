import { requireDashboardSession } from '@/lib/dashboard-auth';
import SearchClient from './SearchClient';

export const revalidate = 0;

export default function SearchPage() {
  requireDashboardSession();
  return <SearchClient />;
}
