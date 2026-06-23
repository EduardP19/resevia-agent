/**
 * Manual/Auto resolution.
 *
 * The salon has a global switch (business_profiles.approval_mode):
 *   true  -> Manual Approval (Sophia drafts, owner approves before sending)
 *   false -> Automatic Reply (Sophia sends directly)
 *
 * Each chat can opt out of the global setting via sessions.response_mode_override:
 *   null     -> inherit the salon default
 *   'manual' -> force manual approval for this chat only
 *   'auto'   -> force automatic reply for this chat only
 *
 * Returns true when replies should be held as drafts for approval (manual mode).
 */
export type ResponseModeOverride = 'auto' | 'manual' | null | undefined;

export function resolveEffectiveApprovalMode(
  session: { response_mode_override?: ResponseModeOverride } | null | undefined,
  salon: { approval_mode?: boolean | null } | null | undefined
): boolean {
  const override = session?.response_mode_override;
  if (override === 'manual') return true;
  if (override === 'auto') return false;
  return Boolean(salon?.approval_mode);
}

/**
 * Human-readable effective mode for a chat, including whether it is overriding
 * the salon default. Used by the dashboard's per-chat toggle.
 */
export function describeEffectiveMode(
  session: { response_mode_override?: ResponseModeOverride } | null | undefined,
  salon: { approval_mode?: boolean | null } | null | undefined
): { manual: boolean; override: ResponseModeOverride; inheriting: boolean } {
  const override = session?.response_mode_override ?? null;
  return {
    manual: resolveEffectiveApprovalMode(session, salon),
    override,
    inheriting: override == null,
  };
}
