import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './lib/supabase.js';
import { AgentEngine } from './engine/agent_engine.js';
import { BusinessProfile } from './types/index.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.AI_MODEL_API_KEY || '';

// Initialize Engine with a placeholder profile (should be fetched from DB)
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

const agent = new AgentEngine(GEMINI_API_KEY, mockProfile);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'resevia-agent', timestamp: new Date().toISOString() });
});

// Direct Test Endpoint
app.post('/api/test/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await agent.getResponse({ id: 'test-session', platform: 'web' } as any, history, message);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

import { handleIncomingSMS } from './webhooks/sms_handler.js';

// ... (existing code)

// Twilio SMS Webhook
app.post('/api/webhooks/sms', (req, res) => handleIncomingSMS(req, res, agent));

// Voice Webhook Entry Point (Placeholder)
app.post('/api/webhooks/voice', async (req, res) => {
  console.log('--- Incoming Call ---', req.body);
  res.status(200).json({ status: 'received' });
});


app.listen(PORT, () => {
  console.log(`🚀 Resevia Agent running on port ${PORT}`);
});
