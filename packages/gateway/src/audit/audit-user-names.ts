import type { OidcVerifier } from '@iqb/gate-oidc';
import { type AuditUser, nameAuditUser } from './audit-user.js';

/** Tokens whose name is kept at most: a script that varies its token is named anew each time. */
const MAX_KEPT = 10000;

/**
 * Names the person of a checked request ({@link nameAuditUser}) and keeps the name of each token
 * for a while. A script in a loop is refused again and again with the same token, and its
 * rejections fold into one entry -- without the kept name, each of them would still cost a
 * signature check, and on an unknown key a question to the provider. The name only goes into the
 * log and never decides about a request, so a token that expires meanwhile keeps its name until
 * the end of the while.
 */
export class AuditUserNames {
  private readonly kept = new Map<string, { at: number; user: Promise<AuditUser> }>();

  constructor(
    private readonly verifier: OidcVerifier | undefined,
    private readonly userClaim: string | undefined,
    private readonly keepMs: number
  ) {}

  name(authorization: string | undefined, now = Date.now()): Promise<AuditUser> {
    // Without a provider nothing is verified, and reading a claim costs nothing worth keeping
    if (!this.verifier || !authorization) return nameAuditUser(authorization, this.verifier, this.userClaim);
    const kept = this.kept.get(authorization);
    if (kept && now - kept.at < this.keepMs) return kept.user;
    const user = nameAuditUser(authorization, this.verifier, this.userClaim);
    if (this.kept.size >= MAX_KEPT) this.prune(now);
    if (this.kept.size < MAX_KEPT) this.kept.set(authorization, { at: now, user });
    return user;
  }

  /** Forgets the names kept for longer than the while. */
  prune(now = Date.now()): void {
    this.kept.forEach(({ at }, authorization) => {
      if (now - at >= this.keepMs) this.kept.delete(authorization);
    });
  }
}
