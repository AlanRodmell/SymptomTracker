/**
 * Dirty Dozen Security Specification Test Suite for firestore.rules
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unverified Email Write',
    collectionPath: '/users/user_123',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: false },
    payload: {
      uid: 'user_123',
      profile: 'female',
      cycleAnchor: '2026-11-01',
      cycleLength: 28,
      reminderEnabled: false,
      reminderTime: '20:00',
      customFavorites: [],
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-User Spoofing (Settings)',
    collectionPath: '/users/user_target',
    operation: 'create',
    auth: { uid: 'user_attacker', email_verified: true },
    payload: {
      uid: 'user_target',
      profile: 'female',
      cycleAnchor: '',
      cycleLength: 28,
      reminderEnabled: false,
      reminderTime: '20:00',
      customFavorites: [],
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection (Settings)',
    collectionPath: '/users/user_123',
    operation: 'update',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      profile: 'female',
      isAdmin: true,
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Orphaned Log Write without Parent User Document',
    collectionPath: '/users/user_no_profile/logs/log_1',
    operation: 'create',
    auth: { uid: 'user_no_profile', email_verified: true },
    payload: {
      id: 'log_1',
      userId: 'user_no_profile',
      dateISO: '2026-11-15T12:00:00.000Z',
      category: 'Physical',
      region: 'Head & Neck',
      subregion: 'Head / Scalp',
      side: 'None',
      symptom: 'Ache',
      severity: 5,
      baseline: false,
      periodStart: false,
      notes: '',
      tags: [],
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID Poisoning Attack',
    collectionPath: '/users/user_123/logs/invalid$id!@#',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      id: 'invalid$id!@#',
      userId: 'user_123',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Severity Out-of-Bounds (99)',
    collectionPath: '/users/user_123/logs/log_1',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      id: 'log_1',
      userId: 'user_123',
      severity: 99,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unbounded Tag Array (15 tags > max 12)',
    collectionPath: '/users/user_123/logs/log_1',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      id: 'log_1',
      userId: 'user_123',
      tags: new Array(15).fill('Stress'),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Notes Denial-of-Wallet (2000 chars > max 1000)',
    collectionPath: '/users/user_123/logs/log_1',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      id: 'log_1',
      userId: 'user_123',
      notes: 'x'.repeat(2000),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: '/users/user_123/logs/log_1',
    operation: 'create',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      id: 'log_1',
      userId: 'user_123',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Field Mutation (createdAt / userId)',
    collectionPath: '/users/user_123/logs/log_1',
    operation: 'update',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      userId: 'user_other',
      createdAt: '2026-11-15T00:00:00.000Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Cross-User Log Scraping (list)',
    collectionPath: '/users/user_victim/logs',
    operation: 'list',
    auth: { uid: 'user_attacker', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Profile Enum Violation',
    collectionPath: '/users/user_123',
    operation: 'update',
    auth: { uid: 'user_123', email_verified: true },
    payload: {
      profile: 'invalid_profile_type',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
