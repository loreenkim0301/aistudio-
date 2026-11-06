# Security Specification: Event Applications

## 1. Data Invariants
- Application records must contain valid applicant information (`name`, `email`, `phone`, `agreed`, `createdAt`).
- Applications cannot exceed length limits (protect against denial of wallet / payload stuffing).
- Strict PII isolation: Only authorized organizers (`isAdmin()`) can read or delete application records.
- Bootstrapped admin is `loreen@selectway.co.kr` with verified email or users present in the `/admins/` collection.

## 2. Dirty Dozen Test Cases
1. Missing required field `email` on application create -> Denied
2. Invalid email format or oversized string (>100 chars) -> Denied
3. Attempting to inject extra properties (e.g. `role: 'admin'`) -> Denied
4. Unauthenticated or non-admin user reading all `/applications/` -> Denied
5. Non-admin user deleting an application -> Denied
6. Oversized document ID (>128 chars or illegal characters) -> Denied
7. Updating application without admin privileges -> Denied
8. False agreement (`agreed: false`) -> Denied
9. Unverified email spoofing admin -> Denied
10. Anonymous user modifying admin roster -> Denied
11. Blanket wildcard queries to arbitrary collections -> Denied
12. Application creation with non-string name -> Denied
