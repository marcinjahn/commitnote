export interface ShareInviteConditions {
  readonly standalone: boolean;
  readonly hasLastLoginHint: boolean;
  readonly dismissed: boolean;
}

export function shouldShowShareInvite(
  conditions: ShareInviteConditions,
): boolean {
  return (
    !conditions.standalone &&
    !conditions.hasLastLoginHint &&
    !conditions.dismissed
  );
}
