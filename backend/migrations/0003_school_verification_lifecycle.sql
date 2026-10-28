-- Gradely Phase A: explicit school + membership activation lifecycle.
--
-- Registration creates a school in 'pending_verification' and the founding
-- administrator's membership in 'pending'. Successful email verification is
-- the ONLY transition performed by this phase:
--
--   schools.status:            pending_verification -> active
--   school_memberships.status: pending              -> active
--
-- Suspended/archived schools are never reactivated by email verification.
-- No payment, platform-approval, report-approval or report-release rule is
-- introduced or bypassed here; those features do not exist yet.
--
-- Resend safety: at most one unconsumed verification token may exist per user.
-- The application also takes a per-user transaction advisory lock, so the
-- index is defence in depth against concurrent resends.

ALTER TABLE schools
  DROP CONSTRAINT IF EXISTS schools_status_check;
ALTER TABLE schools
  ADD CONSTRAINT schools_status_check
  CHECK (status IN ('pending_verification', 'active', 'suspended', 'archived'));

ALTER TABLE school_memberships
  DROP CONSTRAINT IF EXISTS school_memberships_status_check;
ALTER TABLE school_memberships
  ADD CONSTRAINT school_memberships_status_check
  CHECK (status IN ('pending', 'active', 'revoked'));

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_one_live_per_user
  ON email_verification_tokens (user_id)
  WHERE consumed_at IS NULL;
