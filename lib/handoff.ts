export const HANDOFF_PHRASE = "That's something our team handles personally. I'll make sure they're in touch soon. Thanks";

export function isHandoff(replyText: string): boolean {
  if (!replyText) return false;
  
  const triggers = [
    HANDOFF_PHRASE.toLowerCase(),
    "let me get the team to help",
    "someone will be in touch",
    "i'll pass you to a human",
    "transfer you to support",
    // Guardrail / out-of-remit escalation phrasing used in the system prompt.
    "pass your details to the team",
    "pass your details on",
    "i'll make sure someone gets back to you",
    "best handled by the team",
  ];

  const lowerText = replyText.toLowerCase();
  return triggers.some(trigger => lowerText.includes(trigger));
}
