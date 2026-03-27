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

/**
 * Parse a system message saved as "Tool (name): result" into its parts.
 */
function parseToolMessage(content: string): { toolName: string; result: string } | null {
  const match = content.match(/^Tool \(([^)]+)\): ([\s\S]*)$/);
  if (!match) return null;
  return { toolName: match[1], result: match[2] };
}

export async function callAI(systemInstruction: string, messages: AIMessage[]): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    systemInstruction,
    tools: agentTools
  });

  const lastMessage = messages[messages.length - 1];

  // Build Gemini chat history from all messages except the last.
  // System messages (tool results) are converted into model functionCall +
  // function functionResponse pairs. Role 'function' is required by the SDK's
  // VALID_PARTS_PER_ROLE — using 'user' causes a validation error.
  const history: any[] = [];
  for (const m of messages.slice(0, -1)) {
    if (m.role === 'system') {
      const parsed = parseToolMessage(m.content);
      if (parsed) {
        // Gemini requires model functionCall immediately before function functionResponse.
        const last = history[history.length - 1];
        if (!last?.parts?.[0]?.functionCall) {
          history.push({
            role: 'model',
            parts: [{ functionCall: { name: parsed.toolName, args: {} } }]
          });
        }
        history.push({
          role: 'function',
          parts: [{ functionResponse: { name: parsed.toolName, response: { result: parsed.result } } }]
        });
      }
    } else {
      history.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
  }

  // Handle the current (last) message.
  // If it's a tool result, append a synthetic model functionCall to history so
  // Gemini accepts the functionResponse sent via sendMessage.
  let sendPayload: any;
  if (lastMessage.role === 'system') {
    const parsed = parseToolMessage(lastMessage.content);
    if (parsed) {
      history.push({
        role: 'model',
        parts: [{ functionCall: { name: parsed.toolName, args: {} } }]
      });
      sendPayload = [{ functionResponse: { name: parsed.toolName, response: { result: parsed.result } } }];
    } else {
      sendPayload = lastMessage.content;
    }
  } else {
    sendPayload = lastMessage.content;
  }

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(sendPayload);
  const response = await result.response;
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
