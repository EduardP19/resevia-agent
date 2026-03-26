export function isHandoff(replyText: string): boolean {
  const triggers = [
    "Let me get the team to help",
    "someone will be in touch",
    "I'll pass you to a human",
    "transfer you to support"
  ];

  return triggers.some(trigger => 
    replyText.toLowerCase().includes(trigger.toLowerCase())
  );
}
