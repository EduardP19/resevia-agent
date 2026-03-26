import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.AI_MODEL_API_KEY!);

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GeminiFunctionCall {
  name: string;
  args: any;
}

export interface AIResponse {
  reply?: string;
  tool_call?: GeminiFunctionCall;
  raw: any;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export async function callAI(systemInstruction: string, messages: AIMessage[]): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    systemInstruction,
    tools: [{
      functionDeclarations: [
        {
          name: 'check_availability',
          description: 'Check available time slots for a specific date',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              date: { type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format' }
            },
            required: ['date']
          }
        },
        {
          name: 'book_appointment',
          description: 'Reserve/Hold a slot for a service (blocks the calendar but requires confirmation)',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              serviceName: { type: SchemaType.STRING },
              date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
              time: { type: SchemaType.STRING, description: 'HH:mm' },
              clientName: { type: SchemaType.STRING },
              clientEmail: { type: SchemaType.STRING }
            },
            required: ['serviceName', 'date', 'time', 'clientName']
          }
        },
        {
          name: 'confirm_booking',
          description: 'Finalize a previously held slot (confirms the booking)',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              holdUid: { type: SchemaType.STRING, description: 'The UID of the held booking to confirm' }
            },
            required: ['holdUid']
          }
        }
      ]
    }]
  });

  const chat = model.startChat({
    history: messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  const response = await result.response;
  const usage = response.usageMetadata;

  const candidates = response.candidates?.[0];
  const toolCallPart = candidates?.content?.parts?.find(p => p.functionCall);

  if (toolCallPart?.functionCall) {
    return {
      tool_call: toolCallPart.functionCall,
      raw: response,
      tokens: {
        prompt: usage?.promptTokenCount || 0,
        completion: usage?.candidatesTokenCount || 0,
        total: usage?.totalTokenCount || 0
      }
    };
  }

  return {
    reply: response.text(),
    raw: response,
    tokens: {
      prompt: usage?.promptTokenCount || 0,
      completion: usage?.candidatesTokenCount || 0,
      total: usage?.totalTokenCount || 0
    }
  };
}
