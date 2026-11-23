/**
 * Phase 0 TDD Specification Runner for Firestore Security Rules.
 * Verifies the "Dirty Dozen" adversarial payloads against Alba Mercado's security invariants.
 */

export interface DirtyDozenCase {
  id: string;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 'DD-01',
    name: 'Unverified Admin Email Spoof',
    collection: 'products',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isBootstrappedAdmin() requires request.auth.token.email_verified == true.',
  },
  {
    id: 'DD-02',
    name: 'Self-Assigned Admin Escalation',
    collection: 'users',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Non-bootstrapped users may only create profiles with role == "customer".',
  },
  {
    id: 'DD-03',
    name: 'Shadow Ghost Field Injection on Order',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isValidOrder() enforces strict keys().hasOnly() schema allowlist.',
  },
  {
    id: 'DD-04',
    name: 'Price Tampering during Checkout Stock Decrement',
    collection: 'products',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'isCustomerStockPurchase() restricts affectedKeys().hasOnly([stock, soldCount, updatedAt]).',
  },
  {
    id: 'DD-05',
    name: 'Negative Stock or Arbitrary Restock Spoofing',
    collection: 'products',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'isCustomerStockPurchase() mandates 0 <= incoming.stock < existing.stock and exact soldCount delta.',
  },
  {
    id: 'DD-06',
    name: 'Cross-User Order PII Read',
    collection: 'orders',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    rationale: 'Orders restrict get to existing().userId == request.auth.uid || isAdmin().',
  },
  {
    id: 'DD-07',
    name: 'Unfiltered Order List Scraping',
    collection: 'orders',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    rationale: 'allow list explicitly evaluates existing().userId == request.auth.uid || isBootstrappedAdmin().',
  },
  {
    id: 'DD-08',
    name: 'Order Owner Identity Spoofing',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Non-admins must satisfy incoming().userId == request.auth.uid.',
  },
  {
    id: 'DD-09',
    name: 'Terminal State Mutation on Delivered Order',
    collection: 'orders',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Customers may only cancel orders while existing().shipmentStatus == "confirmed".',
  },
  {
    id: 'DD-10',
    name: 'Document ID Poisoning (Oversized / Invalid Characters)',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isValidId() restricts IDs to ^[a-zA-Z0-9_\\-]+$ with length <= 128.',
  },
  {
    id: 'DD-11',
    name: 'Client Backdated Timestamp Forgery',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Temporal integrity requires createdAt == request.time and updatedAt == request.time.',
  },
  {
    id: 'DD-12',
    name: 'Customer Broadcast Notification Abuse',
    collection: 'notifications',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Non-admins may only create type == "order" notifications for their own UID.',
  },
];
