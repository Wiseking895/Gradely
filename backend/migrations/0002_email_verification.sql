-- Gradely Phase A: email verification foundation.
--
-- Status model (explicit, one-way transitions):
--   * users.email_verified_at  NULL  -> timestamp   (single transition on
--     successful POST /api/auth/verify-email; never reset by this phase).
--   * users.status             unchanged ('active' | 'disabled') — account
--     disablement remains a separate, operator-driven concern.
--   * schools.status           unchanged ('active' | 'suspended' | 'archived')
--     — email verification does NOT grant platform approval; no approval,
--     payment, report-approval or report-release state is added or bypassed
--     here (the current product policy requires none of them yet).
--   * school_memberships       unchanged.
--
-- Tokens: only the SHA-256 hash (64 hex chars) of the raw verification token
-- is stored — the raw token exists only in the emailed link. Single use is
-- enforced by consumed_at; expiry by expires_at. Resend deletes any
-- outstanding unconsumed tokens for that user, so at most one live token
-- exists per account.
--
-- Backfill: accounts provisioned before email verification existed (e.g. via
-- npm run admin:create) are marked verified at their creation time so
-- pre-existing operators are not locked out. This migration is idempotent in
-- effect on a fresh database (no rows to backfill).

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL;

CREATE TABLE email_verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the raw token (src/lib/verificationTokens.ts).
  token_hash  text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- Set atomically when the token is redeemed; NULL means still redeemable.
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX email_verification_tokens_user_id_idx
  ON email_verification_tokens (user_id);

CREATE INDEX email_verification_tokens_expires_at_idx
  ON email_verification_tokens (expires_at);
