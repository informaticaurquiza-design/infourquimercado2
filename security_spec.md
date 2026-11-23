# Alba Mercado — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Product Integrity**: Only admins may create, delete, or edit product prices, descriptions, SKUs, or active status. Verified signed-in customers may only atomically decrement `stock` and increment `soldCount` by the exact purchased delta during checkout (`stock >= 0 && stock < existing.stock && soldCount == existing.soldCount + (existing.stock - stock)`).
2. **Order Ownership & PII Isolation**: Orders contain customer shipping PII (address, phone, email). Only the order owner (`existing().userId == request.auth.uid`) or an admin can read an order. Customers can only create orders with their own `userId == request.auth.uid`. Once an order reaches a terminal state (`delivered` or `cancelled`), non-admins cannot mutate it.
3. **Notification Scoping**: Customers may only read notifications addressed to their own `userId` or `'all'`. Customers may only update the `read` flag on their own notifications. Only admins may broadcast (`userId == 'all'`) or send shipment/promo alerts to other users.
4. **User Profile RBAC Hardening**: Users may only read/write their own `/users/{userId}` document. Non-admins are strictly prevented from setting `role: 'admin'` on creation or modifying `role` on update.
5. **Temporal Integrity & Path Hardening**: All `createdAt` and `updatedAt` timestamps must match `request.time`. All single-document operations validate document IDs via `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars). Every string field enforces explicit `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Admin Email Spoof**: Caller sets token `email: "informaticaurquiza@gmail.com"` with `email_verified: false` attempting to create a product -> MUST DENY.
2. **Self-Assigned Admin Escalation**: Regular user creates `/users/{uid}` with `role: "admin"` -> MUST DENY.
3. **Shadow Ghost Field Injection**: Customer creates `/orders/{id}` with extra field `isFreeOverride: true` -> MUST DENY (`hasOnly`).
4. **Price Tampering on Checkout**: Customer attempts to update `/products/{id}` modifying `price: 1` along with `stock` -> MUST DENY (`affectedKeys().hasOnly(['stock', 'soldCount', 'updatedAt'])`).
5. **Negative Stock / Restock Spoofing**: Customer attempts to update `/products/{id}` setting `stock: existing.stock + 50` or `stock: -1` -> MUST DENY.
6. **Cross-User Order PII Read**: User B attempts `get` on User A's order `/orders/{orderA}` -> MUST DENY.
7. **Unfiltered Order List Scraping**: User B attempts `list` on `/orders` without `where('userId', '==', uid)` -> MUST DENY.
8. **Order Identity Spoofing**: User B creates `/orders/{id}` with `userId: "userA"` -> MUST DENY.
9. **Terminal State Mutation**: User A attempts to change a `delivered` order back to `cancelled` -> MUST DENY.
10. **Document ID Poisoning**: Attacker attempts `create` on `/orders/{1500_char_junk_id}` -> MUST DENY (`isValidId`).
11. **Backdated Timestamp Forgery**: User submits client timestamp instead of `serverTimestamp()` (`request.time`) -> MUST DENY.
12. **Broadcast Notification Abuse**: Regular user attempts to create `/notifications/{id}` with `userId: "all"` and `type: "promo"` -> MUST DENY.
