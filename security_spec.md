# Fieldnotes Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Ownership & Email Verification**: All reads and writes to `/users/{userId}` and `/users/{userId}/logs/{logId}` require an authenticated user with `request.auth.token.email_verified == true` and `request.auth.uid == userId`.
2. **Master Gate & Relational Consistency**: A `SymptomLog` at `/users/{userId}/logs/{logId}` can only be created or updated if the parent `/users/{userId}` profile document already exists (`exists(...)`) or is being created atomically in the same batch (`existsAfter(...)`).
3. **Strict Key & Schema Blueprint**: Neither `UserSettings` nor `SymptomLog` may contain undeclared shadow fields. Every string is strictly bounded by `.size()` and IDs must match `^[a-zA-Z0-9_\-]+$`.
4. **Temporal & Identity Immutability**: `uid`, `userId`, `id`, and `createdAt` cannot be mutated on `update`. `createdAt` (on create) and `updatedAt` (on create and update) must equal `request.time`.
5. **Query Enforcer on List**: Listing `/users/{userId}/logs` is restricted to the verified owner and explicitly asserts `resource.data.userId == request.auth.uid` without any `get()` or `exists()` calls inside `allow list`.

## 2. The "Dirty Dozen" Payloads
1. **Unverified Email Write**: Authenticated user with `email_verified: false` attempting to create `/users/{uid}`.
2. **Cross-User Spoofing (Settings)**: User A (`uid_a`) writing to `/users/uid_b` or setting `data.uid = "uid_b"`.
3. **Shadow Field Injection (Settings)**: Adding `"isAdmin": true` to `/users/{uid}`.
4. **Orphaned Log Write**: Creating `/users/{uid}/logs/{logId}` when `/users/{uid}` does not exist before or after the transaction.
5. **ID Poisoning Attack**: Creating a log with a 500-character or special-character `$logId` or mismatched `data.id != logId`.
6. **Severity Out-of-Bounds**: Creating or updating a `SymptomLog` with `severity: 99` or `severity: -5` or string `"high"`.
7. **Unbounded Tag Array**: Sending 25 tags in `data.tags` (exceeding max 12) or non-string tag elements.
8. **Notes Denial-of-Wallet**: Sending a 50,000-character `notes` string (exceeding max 1000).
9. **Client Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a past/future timestamp instead of `request.time`.
10. **Immutable Field Mutation**: Updating `createdAt` or `userId` on an existing `SymptomLog`.
11. **Cross-User Log Scraping (`list`)**: User A attempting to list `/users/uid_b/logs`.
12. **Profile Enum Violation**: Updating `profile` to `"custom_invalid"` instead of `"female"` or `"male"`.
