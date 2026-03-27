import { GoogleGenerativeAI } from '@google/generative-ai';
import { agentTools } from './agent';

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
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction,
    tools: agentTools
  });

  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({
    history: messages
      .slice(0, -1)
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
  });

  const result = await chat.sendMessage(
    lastMessage.role === 'system' ? `[Tool Result] ${lastMessage.content}` : lastMessage.content
  );
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
