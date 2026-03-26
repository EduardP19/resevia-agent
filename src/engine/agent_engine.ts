import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { BusinessProfile, Session, Transcript } from '../types/index.js';
import { supabase } from '../lib/supabase.js';

export class AgentEngine {
  private genAI: GoogleGenerativeAI;
  private businessProfile: BusinessProfile;

  constructor(apiKey: string, profile: BusinessProfile) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.businessProfile = profile;
  }

  /**
   * Generates a response based on current context and history.
   */
  async getResponse(session: Session, history: Transcript[], userInput: string) {
    const model = this.genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: this.generateSystemPrompt(),
      tools: [{ functionDeclarations: this.getFunctionDeclarations() }]
    });

    const chat = model.startChat({
      history: history.map(t => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content }]
      }))
    });

    const result = await chat.sendMessage(userInput);
    const response = await result.response;
    
    // Check for function calls
    const call = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall);
    if (call && call.functionCall) {
      return { role: 'assistant', functionCall: call.functionCall };
    }

    return { role: 'assistant', content: response.text() };
  }

  private generateSystemPrompt(): string {
    return `
      You are an AI Receptionist for ${this.businessProfile.name}, a ${this.businessProfile.industry} business.
      Your tone is ${this.businessProfile.tone_of_voice}.
      
      Business Info:
      - Opening Hours: ${this.businessProfile.opening_hours}
      - Services: ${this.businessProfile.services.map(s => `${s.name} (£${s.price})`).join(', ')}
      
      Rules:
      1. Be polite and human-centric.
      2. If asked about pricing or availability, use the provided tools.
      3. If a client is upset or needs medical advice, suggest a handoff to a human representative.
      
      Current Objective: Help the user book an appointment or answer their questions about services.
    `.trim();
  }

  private getFunctionDeclarations() {
    return [
      {
        name: 'check_availability',
        description: 'Check for available booking slots on a specific date',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            service: { type: 'string' }
          },
          required: ['date']
        }
      },
      {
        name: 'book_appointment',
        description: 'Book an appointment for a client',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            time: { type: 'string' },
            service: { type: 'string' },
            client_name: { type: 'string' },
            client_email: { type: 'string' }
          },
          required: ['date', 'time', 'service', 'client_name']
        }
      }
    ];
  }
}
