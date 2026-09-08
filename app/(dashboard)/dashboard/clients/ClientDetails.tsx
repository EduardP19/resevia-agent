import Link from 'next/link';
import { clientDisplayName, type ClientProfile } from '@/lib/client-profile';
import ClientForm from './ClientForm';

export default function ClientDetails({ client }: { client: ClientProfile }) {
  const bookings = [...(client.booking_history || [])].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  return <div className="mb-10">
    <Link href="/dashboard/clients" className="text-sm text-gray-600 hover:underline">All clients</Link>
    <h1 className="mt-3 mb-6 text-2xl font-bold text-gray-900 break-words">{clientDisplayName(client) || client.phone}</h1>
    <section className="border-y border-gray-200 py-5"><ClientForm client={client} /></section>
    <section className="mt-7">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Booking history</h2>
      {bookings.length ? <div className="overflow-x-auto border-y border-gray-200"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500"><tr>{['Service', 'Date and time (London)', 'Staff', 'Status'].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-100">{bookings.map(booking => <tr key={booking.booking_id}>
          <td className="px-3 py-3 min-w-[160px] text-gray-900"><div className="font-medium">{booking.service}</div>{booking.duration_minutes && <div className="text-xs text-gray-500 mt-1">{booking.duration_minutes} min</div>}</td>
          <td className="px-3 py-3 whitespace-nowrap text-gray-600">{new Date(booking.start_time).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="px-3 py-3 text-gray-600">{booking.worker_name || '-'}</td>
          <td className="px-3 py-3"><span className={`capitalize ${booking.status === 'confirmed' ? 'text-emerald-700' : booking.status === 'cancelled' ? 'text-red-700' : 'text-gray-500'}`}>{booking.status}</span></td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-gray-500 py-4">No bookings yet.</p>}
    </section>
  </div>;
}
