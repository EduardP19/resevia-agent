/** Returned to the client when the agent could not produce a real reply. */
export const ERROR_FALLBACK_REPLY =
  "I'm sorry, I ran into an issue processing your previous message. Could you please rephrase your last question?";

export function normalizeCustomerReply(rawReply: string): string {
  let reply = (rawReply || '').trim();

  // Remove wrapping quotes around the entire message.
  if (
    (reply.startsWith('"') && reply.endsWith('"')) ||
    (reply.startsWith("'") && reply.endsWith("'")) ||
    (reply.startsWith('“') && reply.endsWith('”')) ||
    (reply.startsWith('‘') && reply.endsWith('’'))
  ) {
    reply = reply.slice(1, -1).trim();
  }

  return reply;
}
