import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AppNotification,
  AppUser,
  DeliveryAgent,
  LocalBackupSnapshotMeta,
  Order,
  Product,
  StoreSettings,
  SubscriptionPayment,
  UserProfile,
} from '../src/types/ecommerce.ts';

export interface StoredLocalUser extends UserProfile {
  passwordHash: string;
}

export interface LocalDatabaseSchema {
  version: number;
  products: Product[];
  orders: Order[];
  notifications: AppNotification[];
  users: StoredLocalUser[];
  subscriptionPayments: SubscriptionPayment[];
  deliveryAgents: DeliveryAgent[];
  shippingSettings: StoreSettings;
}

export interface SessionPayload {
  uid: string;
  email: string;
  role: 'customer' | 'admin';
  exp: number;
  jti: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.resolve(DATA_DIR, 'backups');
const REQUESTED_DB_FILE = path.basename(
  (process.env.LOCAL_DB_PATH || 'alba-mercado-db.json').trim() || 'alba-mercado-db.json',
);
const RESOLVED_DB_PATH = path.resolve(DATA_DIR, REQUESTED_DB_FILE);

if (!RESOLVED_DB_PATH.startsWith(DATA_DIR + path.sep)) {
  throw new Error('La ruta de la base de datos local debe residir dentro del directorio ./data/.');
}
if (!BACKUPS_DIR.startsWith(DATA_DIR + path.sep)) {
  throw new Error('La ruta de respaldos debe residir dentro del directorio ./data/.');
}

const SIGNING_SECRET =
  process.env.LOCAL_AUTH_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
const revokedTokens = new Set<string>();

let writeQueue: Promise<void> = Promise.resolve();
let dbCache: LocalDatabaseSchema | null = null;

function createSeedDatabase(): LocalDatabaseSchema {
  const nowIso = new Date().toISOString();
  const products: Product[] = [];

  const notifications: AppNotification[] = [
    {
      id: 'notif-local-welcome',
      userId: 'all',
      title: 'Modo PC Local / Red Local listo',
      message:
        'Base de datos local sincronizada en tiempo real. Usá el código ALBA10 para obtener 10% de descuento en tus compras.',
      type: 'promo',
      orderId: '',
      read: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  return {
    version: 1,
    products,
    orders: [],
    notifications,
    users: [],
    subscriptionPayments: [],
    deliveryAgents: [],
    shippingSettings: {
      freeShippingThreshold: 150000,
      standardShippingCost: 8500,
      updatedBy: 'system',
      updatedAt: nowIso,
    },
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadLocalDb(): LocalDatabaseSchema {
  if (dbCache) return dbCache;
  ensureDataDir();

  if (fs.existsSync(RESOLVED_DB_PATH)) {
    try {
      const raw = fs.readFileSync(RESOLVED_DB_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LocalDatabaseSchema>;
      const fallback = createSeedDatabase();
      dbCache = {
        version: 1,
        products: Array.isArray(parsed.products) ? parsed.products : fallback.products,
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        notifications: Array.isArray(parsed.notifications)
          ? parsed.notifications
          : fallback.notifications,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        subscriptionPayments: Array.isArray(parsed.subscriptionPayments)
          ? parsed.subscriptionPayments
          : [],
        deliveryAgents: Array.isArray(parsed.deliveryAgents)
          ? parsed.deliveryAgents
          : [],
        shippingSettings:
          parsed.shippingSettings &&
          typeof parsed.shippingSettings.freeShippingThreshold === 'number' &&
          typeof parsed.shippingSettings.standardShippingCost === 'number'
            ? parsed.shippingSettings
            : fallback.shippingSettings,
      };
      return dbCache;
    } catch {
      // Fall back to fresh seed if corrupted
    }
  }

  dbCache = createSeedDatabase();
  persistLocalDbSync(dbCache);
  return dbCache;
}

function persistLocalDbSync(data: LocalDatabaseSchema): void {
  ensureDataDir();
  const tmpPath = path.resolve(DATA_DIR, `${REQUESTED_DB_FILE}.tmp`);
  if (!tmpPath.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Ruta temporal inválida para la base de datos.');
  }
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, RESOLVED_DB_PATH);
}

/**
 * Serializes all database mutations so concurrent PC/LAN requests
 * (such as simultaneous checkouts) stay atomic and consistent.
 */
export function withDbWriteLock<T>(
  mutator: (db: LocalDatabaseSchema) => T | Promise<T>,
): Promise<T> {
  const resultPromise = writeQueue.then(async () => {
    const db = loadLocalDb();
    const result = await mutator(db);
    persistLocalDbSync(db);
    return result;
  });
  writeQueue = resultPromise.then(
    () => undefined,
    () => undefined,
  );
  return resultPromise;
}

export function getDbFileName(): string {
  return REQUESTED_DB_FILE;
}

export function getDbRelativeDisplay(): string {
  return `data/${REQUESTED_DB_FILE}`;
}

export function getDetectedLanUrls(port: number, host: string): string[] {
  if (host === '127.0.0.1' || host === 'localhost') {
    return [];
  }
  const urls: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const iface of entries) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return Array.from(new Set(urls));
}

// --- Password & Session Security ---

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

export function verifyConstantTimeSecret(candidate: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isEnvAdminConfigured(): boolean {
  return Boolean(process.env.LOCAL_ADMIN_PASSWORD && process.env.LOCAL_ADMIN_PASSWORD.trim().length > 0);
}

export function hasClaimedLocalAdmin(db: LocalDatabaseSchema): boolean {
  return db.users.some((u) => u.role === 'admin' && Boolean(u.passwordHash));
}

export function signSessionToken(user: {
  uid: string;
  email: string;
  role: 'customer' | 'admin';
}): string {
  const payload: SessionPayload = {
    uid: user.uid,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload || !payload.uid || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    if (revokedTokens.has(payload.jti)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function revokeSessionToken(token: string): void {
  const parsed = verifySessionToken(token);
  if (parsed?.jti) {
    revokedTokens.add(parsed.jti);
  }
}

export function toPublicProfile(user: StoredLocalUser): UserProfile {
  const { passwordHash: _omit, ...profile } = user;
  return profile;
}

export function toAppUser(user: UserProfile): AppUser {
  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    emailVerified: true,
  };
}

const SAFE_BACKUP_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+\.json$/;

function ensureBackupsDir(): void {
  ensureDataDir();
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function resolveSafeBackupPath(fileName: string): string {
  const clean = path.basename(String(fileName || '').trim());
  if (!SAFE_BACKUP_FILENAME_PATTERN.test(clean) || clean.length > 120) {
    throw new Error('Nombre de archivo de respaldo inválido.');
  }
  const abs = path.resolve(BACKUPS_DIR, clean);
  if (!abs.startsWith(BACKUPS_DIR + path.sep)) {
    throw new Error('Ruta de archivo de respaldo no permitida.');
  }
  return abs;
}

export function buildLocalBackupObject(sourceMode: 'local' | 'lan') {
  const db = loadLocalDb();
  return {
    version: db.version,
    exportedAt: new Date().toISOString(),
    sourceMode,
    products: db.products,
    orders: db.orders,
    notifications: db.notifications,
    subscriptionPayments: db.subscriptionPayments,
    shippingSettings: db.shippingSettings,
  };
}

export function saveLocalBackupSnapshot(
  sourceMode: 'local' | 'lan',
  prefix = 'backup',
): LocalBackupSnapshotMeta {
  ensureBackupsDir();
  const payload = buildLocalBackupObject(sourceMode);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'backup';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `alba-${safePrefix}-${sourceMode}-${stamp}.json`;
  const targetPath = resolveSafeBackupPath(fileName);
  const jsonContent = JSON.stringify(payload, null, 2);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, jsonContent, 'utf8');
  fs.renameSync(tmpPath, targetPath);

  return {
    fileName,
    createdAt: payload.exportedAt,
    sizeBytes: Buffer.byteLength(jsonContent, 'utf8'),
    sourceMode,
    productsCount: payload.products.length,
    ordersCount: payload.orders.length,
    notificationsCount: payload.notifications.length,
  };
}

export function listLocalBackups(): LocalBackupSnapshotMeta[] {
  ensureBackupsDir();
  const items = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
  const list: LocalBackupSnapshotMeta[] = [];

  for (const item of items) {
    if (!item.isFile() || item.isSymbolicLink()) continue;
    if (!SAFE_BACKUP_FILENAME_PATTERN.test(item.name)) continue;
    try {
      const abs = resolveSafeBackupPath(item.name);
      const stat = fs.statSync(abs);
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
        exportedAt?: string;
        sourceMode?: string;
        products?: unknown[];
        orders?: unknown[];
        notifications?: unknown[];
      };
      list.push({
        fileName: item.name,
        createdAt:
          typeof parsed.exportedAt === 'string' ? parsed.exportedAt : stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sourceMode: typeof parsed.sourceMode === 'string' ? parsed.sourceMode : 'local',
        productsCount: Array.isArray(parsed.products) ? parsed.products.length : 0,
        ordersCount: Array.isArray(parsed.orders) ? parsed.orders.length : 0,
        notificationsCount: Array.isArray(parsed.notifications) ? parsed.notifications.length : 0,
      });
    } catch {
      // Skip malformed files in backups folder
    }
  }

  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
}

export function readLocalBackupSnapshot(fileName: string): string {
  const abs = resolveSafeBackupPath(fileName);
  if (!fs.existsSync(abs)) {
    throw new Error('No se encontró el archivo de respaldo solicitado.');
  }
  return fs.readFileSync(abs, 'utf8');
}

export function deleteLocalBackupSnapshot(fileName: string): void {
  const abs = resolveSafeBackupPath(fileName);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
}

