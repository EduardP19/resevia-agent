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
