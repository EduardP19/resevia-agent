import { GoogleGenerativeAI } from '@google/generative-ai';
import { agentTools } from './agent';
import { withTiming } from '@/lib/logger';

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

type AILogContext = {
  tenant_id?: string;
  session_id?: string;
};

/**
 * Parse a system message saved as "Tool (name): result" into its parts.
 */
function parseToolMessage(content: string): { toolName: string; result: string } | null {
  const match = content.match(/^Tool \(([^)]+)\): ([\s\S]*)$/);
  if (!match) return null;
  return { toolName: match[1], result: match[2] };
}

export async function callAI(
  systemInstruction: string,
  messages: AIMessage[],
  context: AILogContext = {}
): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction,
    tools: agentTools
  });

  // Build the full Gemini contents array from all messages.
  // Using generateContent (not startChat + sendMessage) bypasses the SDK's
  // validateChatHistory check, which incorrectly rejects functionResponse parts
  // in user-role messages even though the Gemini API fully supports them.
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const parsed = parseToolMessage(m.content);
      if (!parsed) continue;
      // Gemini requires a model functionCall turn immediately before a functionResponse.
      const last = contents[contents.length - 1];
      const lastIsFunctionCall = last?.role === 'model' && last.parts?.some((p: any) => p.functionCall);
      if (!lastIsFunctionCall) {
        contents.push({
          role: 'model',
          parts: [{ functionCall: { name: parsed.toolName, args: {} } }]
        });
      }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: parsed.toolName, response: { result: parsed.result } } }]
      });
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
  }

  // One timed log covers start/success/failure/slow. Gemini is the call most
  // likely to push an inbound webhook past Twilio's deadline, so duration_ms
  // here is the main early warning for timeouts.
  const result = await withTiming(
    {
      category: 'ai',
      event: 'ai_call',
      source: 'lib.ai.callAI',
      tenant_id: context.tenant_id,
      session_id: context.session_id,
      message_count: messages.length,
      model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
      enrich: (r: any) => {
        const usage = r?.response?.usageMetadata;
        const toolCall = r?.response?.candidates?.[0]?.content?.parts?.find(
          (p: any) => p.functionCall
        );
        return {
          prompt_tokens: usage?.promptTokenCount || 0,
          completion_tokens: usage?.candidatesTokenCount || 0,
          total_tokens: usage?.totalTokenCount || 0,
          tool_call: toolCall?.functionCall?.name || null,
        };
      },
    },
    () => model.generateContent({ contents })
  );

  const response = result.response;
  const usage = response.usageMetadata;

  const candidates = response.candidates?.[0];
  const toolCallPart = candidates?.content?.parts?.find((p: any) => p.functionCall);

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

export async function generateSummary(transcript: { role: string; content: string }[]): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction: "You are an assistant that summarizes salon customer conversations. Provide a concise, 1-sentence summary of what the client wanted or the outcome of the chat. Example: 'Client inquired about hair coloring prices and availability.'",
  });

  const chatHistory = transcript.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const prompt = `Summarize this salon conversation in 1 sentence:\n\n${chatHistory}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Summarization failed', err);
    return 'Summary not available.';
  }
}
