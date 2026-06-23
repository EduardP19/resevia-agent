export const DEFAULT_AGENT_NAME = 'Sophia';

type AgentNameSource = {
  agent_name?: string | null;
} | null | undefined;

export function getAgentName(source?: AgentNameSource) {
  const configuredName = typeof source?.agent_name === 'string' ? source.agent_name.trim() : '';
  return configuredName || DEFAULT_AGENT_NAME;
}

export function getAgentPossessiveName(source?: AgentNameSource | string) {
  const agentName = typeof source === 'string' ? getAgentName({ agent_name: source }) : getAgentName(source);
  return agentName.endsWith('s') ? `${agentName}'` : `${agentName}'s`;
}
