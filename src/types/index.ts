export interface BusinessProfile {
  id: string;
  name: string;
  industry: string;
  opening_hours: string;
  services: Service[];
  tone_of_voice: string;
  special_offers?: string;
}

export interface Service {
  name: string;
  price: number;
  duration_minutes: number;
  cal_event_id?: string; // Optional: can override the default
}

export interface Session {
  id: string;
  created_at: string;
  platform: 'voice' | 'web' | 'whatsapp';
  client_identifier: string; // Phone number or UUID
  status: 'active' | 'completed' | 'handed_over';
  metadata: Record<string, any>;
}

export interface Transcript {
  id: string;
  session_id: string;
  created_at: string;
  role: 'system' | 'assistant' | 'user';
  content: string;
}
