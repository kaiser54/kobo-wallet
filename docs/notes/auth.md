# Auth and security notes

## Password storage

- Passwords are stored as bcrypt hashes (`User.passwordHash`).
- bcrypt is the standard for password hashing because it's intentionally slow (~100ms per hash) — fast enough for login, slow enough to make brute-force expensive.
- We use bcryptjs (pure JS, no native bindings) for cross-platform compatibility.
- Cost factor: 12 rounds. Industry standard in 2026.

## Password reset tokens

- Stored as bcrypt hashes too, not plain tokens.
- Lifetime: 1 hour from creation.
- Single-use: `usedAt` is set the moment the token is consumed.
- Plain token is sent only once, in the reset email. Never logged.

### Why hash reset tokens

If our database leaks:
- Without hashing: attacker has every active reset token. They can reset any account whose token hasn't expired.
- With hashing: attacker has hashes. To use one, they'd need to brute-force it. bcrypt makes that economically infeasible.

This is defense in depth. The DB shouldn't leak — but if it does, the damage is bounded.

## Why we use JWT sessions

- Forced by Auth.js v5's Credentials provider — it doesn't support DB sessions.
- See ADR-011 for trade-offs.
- For production, we'd add server-side revocation via a `tokensInvalidatedAt` column on User, bumped on logout and password change. Any JWT issued before that timestamp is rejected. Cheaper than a full session table.