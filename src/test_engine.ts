import { AgentEngine } from './engine/agent_engine.js';
import { BusinessProfile } from './types/index.js';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.AI_MODEL_API_KEY || '';

const mockProfile: BusinessProfile = {
  id: 'test-123',
  name: 'Resevia Beauty Lounge',
  industry: 'Beauty & Wellness',
  opening_hours: 'Mon-Fri 9-6',
  services: [
    { name: 'Full Set Lashes', price: 65, duration_minutes: 90 },
    { name: 'Eyebrow Shape', price: 25, duration_minutes: 30 }
  ],
  tone_of_voice: 'professional and warm'
};

async function runTest() {
  const engine = new AgentEngine(apiKey, mockProfile);
  
  console.log('Sending message: "Hi, how much is a full set of lashes?"');
  const response = await engine.getResponse({ id: 'test', platform: 'web' } as any, [], 'Hi, how much is a full set of lashes?');
  
  console.log('\n--- AI Response ---');
  console.log(JSON.stringify(response, null, 2));

  console.log('\nSending message: "Can I book for tomorrow at 10am?"');
  const bookingResponse = await engine.getResponse({ id: 'test', platform: 'web' } as any, [], 'Can I book for tomorrow at 10am?');
  
  console.log('\n--- AI Booking Response ---');
  console.log(JSON.stringify(bookingResponse, null, 2));
}

runTest().catch(console.error);
