import DashboardLayout from '@/app/(dashboard)/layout';
import ClientsDirectory from '@/app/(dashboard)/dashboard/clients/ClientsDirectory';
import ClientDetails from '@/app/(dashboard)/dashboard/clients/ClientDetails';
import ChatInterface from '@/app/(dashboard)/dashboard/sessions/[id]/ChatInterface';
import type { ClientProfile } from '@/lib/client-profile';

const client: ClientProfile = {
  id: '33333333-3333-4333-8333-333333333333', salon_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alexandra', last_name: 'Smith Jones', email: 'alexandra@example.org', phone: '+447700900123', whatsapp_available: null, whatsapp_checked_at: null,
  metadata: { notes: 'Prefers morning appointments.' }, created_at: '2026-09-08T12:00:00Z', updated_at: '2026-09-08T12:00:00Z',
  booking_history: [{ booking_id: 'booking-test', service: 'Wash, Cut and Blow Dry', start_time: '2026-09-10T09:00:00Z', status: 'confirmed', worker_name: 'Sam', duration_minutes: 60 }],
};

export default function VerificationPage({ searchParams }: { searchParams: { view?: string } }) {
  return <DashboardLayout>{searchParams.view === 'call' ? <div className="max-w-3xl mx-auto">
    <h1 className="text-2xl font-bold mb-4">Phone conversation</h1>
    <ChatInterface sessionId="22222222-2222-4222-8222-222222222222" clientPhone={client.phone} sessionChannel="voice" sessionStatus="active" initialTranscript={[]} />
  </div> : searchParams.view === 'profile' ? <div className="max-w-5xl mx-auto"><ClientDetails client={client} /></div> : <ClientsDirectory clients={[client]} total={1} query="" page={1} />}</DashboardLayout>;
}
