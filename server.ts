import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLocalBackupObject,
  deleteLocalBackupSnapshot,
  getDbRelativeDisplay,
  getDetectedLanUrls,
  hasClaimedLocalAdmin,
  hashPassword,
  isEnvAdminConfigured,
  listLocalBackups,
  loadLocalDb,
  readLocalBackupSnapshot,
  revokeSessionToken,
  saveLocalBackupSnapshot,
  signSessionToken,
  toAppUser,
  toPublicProfile,
  verifyConstantTimeSecret,
  verifyPassword,
  verifySessionToken,
  withDbWriteLock,
  type SessionPayload,
  type StoredLocalUser,
} from './server/localDb.ts';
import {
  activateCloudflareAccountInBrowser,
  getCloudflarePublicUrl,
  getCloudflareStatus,
  openCloudflareUrlInChrome,
  openCloudflareUrlInDefaultBrowser,
  setCloudflareStateListener,
  startCloudflareTunnel,
  stopCloudflareTunnel,
} from './server/cloudflareTunnel.ts';
import { buildPcAppBundle, type DownloadPlatform } from './server/zipBuilder.ts';
import { getDefaultCategoryImage } from './src/lib/categoryAssets.ts';
import {
  MAX_PRODUCT_IMAGES,
  getProductGallery,
  isValidImageSource,
} from './src/lib/imageTools.ts';
import {
  ID_PATTERN,
  MONTHLY_SUBSCRIPTION_COST,
  clampString,
  formatCurrency,
  generateOrderNumber,
  generateTrackingCode,
  generateTransactionId,
  getAccountSubscriptionInfo,
  getPreviousShipmentStatus,
  validateBenefitInput,
  validateDeliveryAgentInput,
  validateProductInput,
} from './src/lib/validation.ts';
import {
  CATEGORY_MAP,
  SHIPMENT_PIPELINE,
  type AppNotification,
  type AssignedCourier,
  type BenefitType,
  type CategoryId,
  type CustomerBenefit,
  type DeliveryAgent,
  type DeliveryMethod,
  type DeliveryVehicleType,
  type NotificationType,
  type Order,
  type PaymentMethod,
  type PaymentReceipt,
  type PaymentStatus,
  type Product,
  type ShipmentStatus,
  type SubscriptionPayment,
  type SubscriptionPaymentMethod,
  type TrackingEvent,
} from './src/types/ecommerce.ts';

const cliModeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.slice(7).toLowerCase();
const PORT = Number(process.env.PORT) || 3000;
const NETWORK_MODE: 'local' | 'lan' =
  (cliModeArg || process.env.NETWORK_MODE?.toLowerCase()) === 'local' ? 'local' : 'lan';
const BIND_HOST = NETWORK_MODE === 'local' ? '127.0.0.1' : '0.0.0.0';
const BOOTSTRAP_ADMIN_EMAIL = 'informaticaurquiza@gmail.com';

interface FirebasePublicConfig {
  apiKey: string;
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedFirebaseConfig: FirebasePublicConfig | null | undefined;
function getFirebasePublicConfig(): FirebasePublicConfig | null {
  if (cachedFirebaseConfig !== undefined) return cachedFirebaseConfig;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) {
      cachedFirebaseConfig = null;
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
      apiKey?: string;
      projectId?: string;
      firestoreDatabaseId?: string;
    };
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    const firestoreDatabaseId =
      typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
        ? parsed.firestoreDatabaseId.trim()
        : '(default)';
    cachedFirebaseConfig = { apiKey, projectId, firestoreDatabaseId };
    return cachedFirebaseConfig;
  } catch {
    cachedFirebaseConfig = null;
    return null;
  }
}

function getFirebaseWebApiKey(): string | null {
  const cfg = getFirebasePublicConfig();
  return cfg?.apiKey || null;
}

async function verifyFirebaseAdminToken(idToken: string): Promise<boolean> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey || !idToken) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean }>;
    };
    const account = data.users?.[0];
    return Boolean(
      account?.email &&
        account.emailVerified === true &&
        account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL,
    );
  } catch {
    return false;
  }
}

async function verifyFirebaseUserToken(idToken: string): Promise<boolean> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey || !idToken) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const account = data.users?.[0];
    return Boolean(account?.localId && account.emailVerified === true);
  } catch {
    return false;
  }
}

function sanitizePaymentReceipt(raw: unknown): PaymentReceipt | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const imageUrl = typeof r.imageUrl === 'string' ? r.imageUrl.trim() : '';
  if (!imageUrl || !isValidImageSource(imageUrl)) {
    throw new Error('La imagen del comprobante no tiene un formato admitido o supera el tamaño permitido.');
  }
  return {
    imageUrl,
    fileName: clampString(String(r.fileName || 'comprobante.jpg'), 120),
    operationNumber: clampString(String(r.operationNumber || ''), 80),
    bankName: clampString(String(r.bankName || ''), 80),
    amountDetected: clampString(String(r.amountDetected || ''), 40),
    payerName: clampString(String(r.payerName || ''), 100),
    transferDate: clampString(String(r.transferDate || ''), 60),
    destinationAccount: clampString(String(r.destinationAccount || ''), 100),
    summary: clampString(String(r.summary || ''), 240),
    uploadedAt: clampString(String(r.uploadedAt || new Date().toISOString()), 40),
  };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// --- Real-Time SSE Clients for Live LAN/PC Synchronization ---
const sseClients = new Set<Response>();

function broadcastDbChange(
  topic:
    | 'products'
    | 'orders'
    | 'notifications'
    | 'settings'
    | 'deliveryAgents'
    | 'benefits'
    | 'cloudflare'
    | 'all',
): void {
  const payload = `data: ${JSON.stringify({ type: topic, ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

setCloudflareStateListener(() => {
  broadcastDbChange('cloudflare');
});

function safeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function getAuthSession(req: Request): SessionPayload | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifySessionToken(token);
}

function requireAuth(req: Request, res: Response): SessionPayload | null {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ error: 'Iniciá sesión en el servidor local para realizar esta acción.' });
    return null;
  }
  return session;
}

function requireAdmin(req: Request, res: Response): SessionPayload | null {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Permisos insuficientes. Esta operación requiere rol administrador.' });
    return null;
  }
  return session;
}

async function requireAnyAdmin(
  req: Request,
  res: Response,
): Promise<{ uid: string; email: string } | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Iniciá sesión como administrador para realizar esta operación.' });
    return null;
  }

  const authProvider = String(req.headers['x-auth-provider'] || '').toLowerCase();
  if (authProvider === 'firebase') {
    const ok = await verifyFirebaseAdminToken(token);
    if (!ok) {
      res.status(403).json({ error: 'Permisos insuficientes. Requiere cuenta administradora verificada.' });
      return null;
    }
    return { uid: 'firebase-admin', email: BOOTSTRAP_ADMIN_EMAIL };
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Sesión inválida o expirada. Volvé a iniciar sesión.' });
    return null;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Permisos insuficientes. Esta operación requiere rol administrador.' });
    return null;
  }
  return { uid: session.uid, email: session.email };
}

function normalizeIsoTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const sec = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(sec)) {
      return new Date(sec * 1000).toISOString();
    }
  }
  return fallbackIso;
}

function isValidCategory(cat: unknown): cat is CategoryId {
  return typeof cat === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, cat);
}

function isLocalUserSubscriptionActive(user: StoredLocalUser | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return getAccountSubscriptionInfo(user).isActive;
}

function isProductVisibleInPublicCatalog(
  product: Product,
  usersById: Map<string, StoredLocalUser>,
): boolean {
  if (!product.active) return false;
  if (product.sellerId) {
    const owner = usersById.get(product.sellerId);
    if (owner && !isLocalUserSubscriptionActive(owner)) {
      return false;
    }
  }
  return true;
}

// --- API: Server Info & Real-Time SSE ---

app.get('/api/local/info', (_req, res) => {
  const db = loadLocalDb();
  const lanUrls = getDetectedLanUrls(PORT, BIND_HOST);
  res.json({
    available: true,
    networkMode: NETWORK_MODE,
    standalonePcMode: Boolean(cliModeArg),
    host: BIND_HOST,
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    lanUrls,
    cloudflarePublicUrl: getCloudflarePublicUrl() || '',
    cloudflarePhase: getCloudflareStatus(false).phase,
    dbFileName: getDbRelativeDisplay(),
    adminClaimed: hasClaimedLocalAdmin(db),
    envAdminConfigured: isEnvAdminConfigured(),
    counts: {
      products: db.products.length,
      orders: db.orders.length,
      notifications: db.notifications.length,
      users: db.users.length,
    },
  });
});

app.get('/api/local/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  sseClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// --- API: Local Authentication (Offline-Capable PC & LAN) ---

app.post('/api/local/auth/setup-admin', async (req, res) => {
  try {
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const displayNameRaw = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const businessNameRaw = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (isEnvAdminConfigured()) {
      res.status(409).json({
        error: 'La contraseña de administrador ya está configurada mediante LOCAL_ADMIN_PASSWORD en el servidor.',
      });
      return;
    }

    if (!emailRaw || !emailRaw.includes('@') || emailRaw.length > 120) {
      res.status(400).json({ error: 'Ingresá un correo válido para el administrador local.' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }

    const created = await withDbWriteLock((db) => {
      if (hasClaimedLocalAdmin(db)) {
        throw new Error('ADMIN_ALREADY_EXISTS');
      }
      const nowIso = new Date().toISOString();
      const adminUser: StoredLocalUser = {
        uid: 'local-admin-01',
        displayName: clampString(displayNameRaw || 'Administrador Local', 100),
        businessName: clampString(businessNameRaw, 120),
        email: clampString(emailRaw, 120),
        photoURL: '',
        phone: '',
        defaultAddress: '',
        defaultCity: '',
        defaultPostalCode: '',
        bankCbuCvu: '',
        bankAlias: '',
        bankAccountHolder: '',
        pushEnabled: false,
        role: 'admin',
        joinedAt: nowIso,
        subscriptionStatus: 'active',
        subscriptionPaidUntil: '',
        lastActivatedAt: nowIso,
        passwordHash: hashPassword(password),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.users = [adminUser, ...db.users.filter((u) => u.email.toLowerCase() !== emailRaw)];
      return adminUser;
    });

    const profile = toPublicProfile(created);
    const token = signSessionToken({ uid: profile.uid, email: profile.email, role: 'admin' });
    res.status(201).json({
      token,
      user: toAppUser(profile),
      profile,
      isAdmin: true,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'ADMIN_ALREADY_EXISTS') {
      res.status(409).json({ error: 'La cuenta administradora local ya fue configurada.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos configurar la cuenta administradora local.' });
  }
});

app.post('/api/local/auth/register', async (req, res) => {
  try {
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const displayNameRaw = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const businessNameRaw = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
    const phoneRaw = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const bankCbuCvuRaw = typeof req.body?.bankCbuCvu === 'string' ? req.body.bankCbuCvu.trim() : '';
    const bankAliasRaw = typeof req.body?.bankAlias === 'string' ? req.body.bankAlias.trim() : '';
    const bankAccountHolderRaw =
      typeof req.body?.bankAccountHolder === 'string' ? req.body.bankAccountHolder.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!emailRaw || !emailRaw.includes('@') || emailRaw.length > 120) {
      res.status(400).json({ error: 'Ingresá un correo electrónico válido.' });
      return;
    }
    if (displayNameRaw.length < 2 || displayNameRaw.length > 100) {
      res.status(400).json({ error: 'Ingresá tu nombre completo (mínimo 2 caracteres).' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }

    const created = await withDbWriteLock((db) => {
      if (db.users.some((u) => u.email.toLowerCase() === emailRaw)) {
        throw new Error('EMAIL_EXISTS');
      }
      const nowIso = new Date().toISOString();
      const customer: StoredLocalUser = {
        uid: safeId('usr'),
        displayName: clampString(displayNameRaw, 100),
        businessName: clampString(businessNameRaw, 120),
        email: clampString(emailRaw, 120),
        photoURL: '',
        phone: clampString(phoneRaw, 32),
        defaultAddress: '',
        defaultCity: '',
        defaultPostalCode: '',
        bankCbuCvu: clampString(bankCbuCvuRaw, 32),
        bankAlias: clampString(bankAliasRaw, 60),
        bankAccountHolder: clampString(bankAccountHolderRaw, 120),
        pushEnabled: false,
        role: 'customer',
        joinedAt: nowIso,
        subscriptionStatus: 'trial',
        subscriptionPaidUntil: '',
        lastActivatedAt: '',
        passwordHash: hashPassword(password),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.users.push(customer);
      return customer;
    });
    broadcastDbChange('all');

    const profile = toPublicProfile(created);
    const token = signSessionToken({ uid: profile.uid, email: profile.email, role: 'customer' });
    res.status(201).json({
      token,
      user: toAppUser(profile),
      profile,
      isAdmin: false,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({ error: 'Ya existe una cuenta local registrada con ese correo.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos registrar la cuenta local.' });
  }
});

app.post('/api/local/auth/login', async (req, res) => {
  try {
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!emailRaw || !password) {
      res.status(400).json({ error: 'Completá correo y contraseña para ingresar.' });
      return;
    }

    const db = loadLocalDb();
    const envPass = process.env.LOCAL_ADMIN_PASSWORD?.trim() || '';

    // Configured LOCAL_ADMIN_PASSWORD always overrides any fallback claimed hash
    if (envPass) {
      const existingAdmin = db.users.find((u) => u.role === 'admin');
      const expectedAdminEmail = (existingAdmin?.email || BOOTSTRAP_ADMIN_EMAIL).toLowerCase();
      if (
        (emailRaw === expectedAdminEmail || emailRaw === 'admin@local') &&
        verifyConstantTimeSecret(password, envPass)
      ) {
        const adminRecord = await withDbWriteLock((state) => {
          const found = state.users.find((u) => u.role === 'admin');
          if (found) return found;
          const nowIso = new Date().toISOString();
          const created: StoredLocalUser = {
            uid: 'local-admin-01',
            displayName: 'Administrador Local',
            businessName: '',
            email: expectedAdminEmail,
            photoURL: '',
            phone: '',
            defaultAddress: '',
            defaultCity: '',
            defaultPostalCode: '',
            pushEnabled: false,
            role: 'admin',
            joinedAt: nowIso,
            subscriptionStatus: 'active',
            subscriptionPaidUntil: '',
            lastActivatedAt: nowIso,
            passwordHash: '',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          state.users.unshift(created);
          return created;
        });

        const profile = toPublicProfile(adminRecord);
        const token = signSessionToken({ uid: profile.uid, email: profile.email, role: 'admin' });
        res.json({ token, user: toAppUser(profile), profile, isAdmin: true });
        return;
      }
    }

    const matched = db.users.find((u) => u.email.toLowerCase() === emailRaw);
    if (!matched) {
      res.status(401).json({ error: 'Credenciales inválidas.' });
      return;
    }

    // If env admin password is set, block fallback hash login for admin accounts
    if (matched.role === 'admin' && envPass) {
      res.status(401).json({ error: 'Credenciales inválidas.' });
      return;
    }

    if (!matched.passwordHash || !verifyPassword(password, matched.passwordHash)) {
      res.status(401).json({ error: 'Credenciales inválidas.' });
      return;
    }

    const profile = toPublicProfile(matched);
    const token = signSessionToken({
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
    });
    res.json({
      token,
      user: toAppUser(profile),
      profile,
      isAdmin: profile.role === 'admin',
    });
  } catch {
    res.status(500).json({ error: 'Error al validar acceso local.' });
  }
});

app.get('/api/local/auth/me', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const db = loadLocalDb();
  const found = db.users.find((u) => u.uid === session.uid);
  if (!found) {
    res.status(401).json({ error: 'Sesión no válida.' });
    return;
  }
  const profile = toPublicProfile(found);
  res.json({
    user: toAppUser(profile),
    profile,
    isAdmin: profile.role === 'admin',
  });
});

app.post('/api/local/auth/logout', (req, res) => {
  const token = extractBearerToken(req);
  if (token) {
    revokeSessionToken(token);
  }
  res.json({ ok: true });
});

app.post('/api/local/auth/change-password', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Completá la contraseña actual y la nueva contraseña.' });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.' });
      return;
    }

    const envPass = process.env.LOCAL_ADMIN_PASSWORD?.trim() || '';
    if (session.role === 'admin' && envPass) {
      res.status(400).json({
        error:
          'La contraseña del administrador local está configurada mediante la variable de entorno LOCAL_ADMIN_PASSWORD y debe modificarse desde esa configuración.',
      });
      return;
    }

    const result = await withDbWriteLock((state) => {
      const target = state.users.find((u) => u.uid === session.uid);
      if (!target) {
        return { error: 'Cuenta no encontrada.', status: 404 as const };
      }
      if (!target.passwordHash || !verifyPassword(currentPassword, target.passwordHash)) {
        return { error: 'La contraseña actual es incorrecta.', status: 401 as const };
      }
      target.passwordHash = hashPassword(newPassword);
      target.updatedAt = new Date().toISOString();
      return {
        status: 200 as const,
        user: { uid: target.uid, email: target.email, role: target.role },
      };
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const previousToken = extractBearerToken(req);
    if (previousToken) {
      revokeSessionToken(previousToken);
    }
    const freshToken = signSessionToken({
      uid: result.user.uid,
      email: result.user.email,
      role: result.user.role,
    });

    res.json({ ok: true, token: freshToken });
  } catch {
    res.status(500).json({ error: 'No pudimos actualizar la contraseña.' });
  }
});

// --- Local Password Recovery (15-min single-use hashed code, rate-limited) ---

interface LocalResetEntry {
  uid: string;
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const localPasswordResetTokens = new Map<string, LocalResetEntry>();
const resetRateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkResetRateLimit(key: string, maxPerWindow: number): boolean {
  const now = Date.now();
  const current = resetRateLimiter.get(key);
  if (!current || current.resetAt <= now) {
    resetRateLimiter.set(key, { count: 1, resetAt: now + PASSWORD_RESET_TTL_MS });
    return true;
  }
  if (current.count >= maxPerWindow) {
    return false;
  }
  current.count += 1;
  return true;
}

function normalizeResetCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashResetCode(normalizedCode: string): string {
  return crypto.createHash('sha256').update(normalizedCode).digest('hex');
}

function generateLocalRecoveryCode(uid: string, email: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i += 1) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  const normalizedEmail = email.trim().toLowerCase();
  localPasswordResetTokens.set(normalizedEmail, {
    uid,
    email: normalizedEmail,
    codeHash: hashResetCode(raw),
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
    attempts: 0,
  });
  return formatted;
}

app.post('/api/local/auth/request-password-reset', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkResetRateLimit(`req:${clientIp}`, 5)) {
    res.status(429).json({
      error: 'Realizaste demasiadas solicitudes. Esperá unos minutos e intentá nuevamente.',
    });
    return;
  }

  const email = clampString(String(req.body?.email || ''), 120).toLowerCase();
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Ingresá un correo electrónico válido.' });
    return;
  }

  const db = loadLocalDb();
  const target = db.users.find((u) => u.email.toLowerCase() === email);
  const envPass = process.env.LOCAL_ADMIN_PASSWORD?.trim() || '';

  if (target && !(target.role === 'admin' && envPass)) {
    const code = generateLocalRecoveryCode(target.uid, target.email);
    console.log(
      `\n[Infourqui Mercado] Código de recuperación de contraseña (válido 15 min) para ${target.email}: ${code}\n`,
    );
  }

  // Always return a neutral response (no account enumeration, never expose code in HTTP body)
  res.json({
    ok: true,
    message:
      'Si la cuenta existe en el servidor local, se generó un código de recuperación válido por 15 minutos en la consola de la PC o podés solicitarlo al administrador.',
  });
});

app.post('/api/local/auth/confirm-password-reset', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkResetRateLimit(`confirm:${clientIp}`, 10)) {
    res.status(429).json({
      error: 'Demasiados intentos de recuperación. Esperá unos minutos e intentá nuevamente.',
    });
    return;
  }

  try {
    const email = clampString(String(req.body?.email || ''), 120).toLowerCase();
    const rawCode = typeof req.body?.code === 'string' ? req.body.code : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Ingresá un correo electrónico válido.' });
      return;
    }
    const normalizedCode = normalizeResetCode(rawCode);
    if (normalizedCode.length !== 8) {
      res.status(400).json({ error: 'Ingresá el código de recuperación de 8 caracteres.' });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }

    const entry = localPasswordResetTokens.get(email);
    if (!entry || entry.expiresAt <= Date.now()) {
      localPasswordResetTokens.delete(email);
      res.status(400).json({
        error: 'El código de recuperación es inválido o venció. Solicitá uno nuevo.',
      });
      return;
    }

    const incomingHashBuf = Buffer.from(hashResetCode(normalizedCode), 'hex');
    const storedHashBuf = Buffer.from(entry.codeHash, 'hex');
    const validCode =
      incomingHashBuf.length === storedHashBuf.length &&
      crypto.timingSafeEqual(incomingHashBuf, storedHashBuf);

    if (!validCode) {
      entry.attempts += 1;
      if (entry.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        localPasswordResetTokens.delete(email);
        res.status(400).json({
          error: 'El código fue invalidado por demasiados intentos fallidos. Solicitá uno nuevo.',
        });
        return;
      }
      res.status(400).json({ error: 'Código de recuperación incorrecto.' });
      return;
    }

    // Consume token immediately (single-use)
    localPasswordResetTokens.delete(email);

    const envPass = process.env.LOCAL_ADMIN_PASSWORD?.trim() || '';
    const result = await withDbWriteLock((state) => {
      const target = state.users.find(
        (u) => u.uid === entry.uid && u.email.toLowerCase() === email,
      );
      if (!target) {
        return { error: 'Cuenta no encontrada.', status: 404 as const };
      }
      if (target.role === 'admin' && envPass) {
        return {
          error:
            'La contraseña del administrador local está definida por LOCAL_ADMIN_PASSWORD y debe cambiarse en esa variable de entorno.',
          status: 400 as const,
        };
      }
      target.passwordHash = hashPassword(newPassword);
      target.updatedAt = new Date().toISOString();
      return { status: 200 as const };
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'No pudimos restablecer la contraseña.' });
  }
});

// --- API: Scoped Data Bootstrap ---

app.get('/api/local/bootstrap', (req, res) => {
  const db = loadLocalDb();
  const session = getAuthSession(req);
  const isAdmin = session?.role === 'admin';
  const usersById = new Map(db.users.map((u) => [u.uid, u]));

  const enrichProductWithSellerBank = (p: Product): Product => {
    if (!p.sellerId) return p;
    const owner = usersById.get(p.sellerId);
    if (!owner) return p;
    const bankAlias = (owner.bankAlias || p.sellerBankAlias || '').trim();
    const bankCbuCvu = (owner.bankCbuCvu || p.sellerBankCbuCvu || '').trim();
    const bankAccountHolder = (
      owner.bankAccountHolder ||
      p.sellerBankAccountHolder ||
      owner.businessName ||
      owner.displayName ||
      ''
    ).trim();
    return {
      ...p,
      ...(bankAlias ? { sellerBankAlias: bankAlias } : {}),
      ...(bankCbuCvu ? { sellerBankCbuCvu: bankCbuCvu } : {}),
      ...(bankAccountHolder ? { sellerBankAccountHolder: bankAccountHolder } : {}),
    };
  };

  const products = (
    isAdmin
      ? db.products
      : db.products.filter(
          (p) =>
            isProductVisibleInPublicCatalog(p, usersById) ||
            (session !== null && p.sellerId === session.uid),
        )
  ).map(enrichProductWithSellerBank);

  const orders = !session
    ? []
    : isAdmin
      ? [...db.orders]
      : db.orders.filter((o) => o.userId === session.uid);

  const notifications = !session
    ? []
    : db.notifications.filter((n) => n.userId === session.uid || n.userId === 'all');

  const subscriptionPayments = !session
    ? []
    : isAdmin
      ? [...db.subscriptionPayments]
      : db.subscriptionPayments.filter((sp) => sp.userId === session.uid);

  const accounts = isAdmin ? db.users.map(toPublicProfile) : [];
  const deliveryAgents = isAdmin ? [...db.deliveryAgents] : [];
  const benefits = isAdmin
    ? [...db.benefits]
    : session
      ? db.benefits.filter(
          (b) =>
            b.targetUserId === 'all' ||
            b.targetUserId === session.uid ||
            b.createdBy === session.uid,
        )
      : db.benefits.filter((b) => b.targetUserId === 'all');

  const userRecord = session ? db.users.find((u) => u.uid === session.uid) : null;
  const profile = userRecord ? toPublicProfile(userRecord) : null;

  res.json({
    products,
    orders,
    notifications,
    subscriptionPayments,
    accounts,
    deliveryAgents,
    benefits,
    shippingSettings: db.shippingSettings,
    profile,
    isAdmin,
  });
});

// --- API: Products CRUD (Admin Only) ---

function parseAndValidateProductImages(
  imagesInput: unknown,
  imageUrlInput: unknown,
  category: CategoryId,
): string[] {
  const raw: string[] = [];
  if (Array.isArray(imagesInput)) {
    for (const item of imagesInput) {
      if (typeof item === 'string' && item.trim() && !raw.includes(item.trim())) {
        raw.push(item.trim());
      }
    }
  }
  if (raw.length === 0 && typeof imageUrlInput === 'string' && imageUrlInput.trim()) {
    raw.push(imageUrlInput.trim());
  }
  if (raw.length === 0) {
    raw.push(getDefaultCategoryImage(category));
  }
  const sliced = raw.slice(0, MAX_PRODUCT_IMAGES);
  for (const img of sliced) {
    if (!isValidImageSource(img)) {
      throw new Error('Formato o tamaño de imagen no permitido.');
    }
  }
  return sliced;
}

app.post('/api/local/products', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const body = req.body ?? {};
    if (!isValidCategory(body.category)) {
      res.status(400).json({ error: 'Rubro inválido.' });
      return;
    }

    const input = {
      sku: String(body.sku || '').toUpperCase(),
      name: String(body.name || ''),
      category: body.category as CategoryId,
      description: String(body.description || ''),
      price: Number(body.price),
      stock: Number(body.stock),
      minStockThreshold: Number(body.minStockThreshold),
    };
    const errMsg = validateProductInput(input);
    if (errMsg) {
      res.status(400).json({ error: errMsg });
      return;
    }

    const validImages = parseAndValidateProductImages(body.images, body.imageUrl, input.category);
    const cleanSpecs = Array.isArray(body.specs)
      ? body.specs
          .filter((s: unknown): s is string => typeof s === 'string')
          .map((s: string) => clampString(s, 120))
          .filter(Boolean)
          .slice(0, 8)
      : [];

    const created = await withDbWriteLock((db) => {
      const actor = db.users.find((u) => u.uid === session.uid);
      if (session.role !== 'admin' && !isLocalUserSubscriptionActive(actor)) {
        throw new Error('SUBSCRIPTION_INACTIVE');
      }
      const nowIso = new Date().toISOString();
      const sellerName =
        clampString(
          String(
            (session.role === 'admin' && body.sellerName) ||
              actor?.businessName ||
              actor?.displayName ||
              session.email,
          ),
          120,
        ) || 'Infourqui Mercado';
      const sellerUid =
        session.role === 'admin' && typeof body.sellerId === 'string' && body.sellerId.trim()
          ? clampString(body.sellerId.trim(), 128)
          : session.uid;
      const sellerUser = db.users.find((u) => u.uid === sellerUid) || actor;
      const sellerBankAlias = clampString(
        String(body.sellerBankAlias ?? sellerUser?.bankAlias ?? ''),
        60,
      );
      const sellerBankCbuCvu = clampString(
        String(body.sellerBankCbuCvu ?? sellerUser?.bankCbuCvu ?? ''),
        32,
      );
      const sellerBankAccountHolder = clampString(
        String(
          body.sellerBankAccountHolder ??
            sellerUser?.bankAccountHolder ??
            sellerUser?.businessName ??
            sellerUser?.displayName ??
            '',
        ),
        120,
      );
      const product: Product = {
        id: safeId('prod'),
        sku: clampString(input.sku, 32),
        name: clampString(input.name, 120),
        category: input.category,
        categoryLabel: clampString(CATEGORY_MAP[input.category].label, 48),
        description: clampString(input.description, 800),
        price: Math.round(input.price),
        compareAtPrice:
          typeof body.compareAtPrice === 'number' && body.compareAtPrice > input.price
            ? Math.round(body.compareAtPrice)
            : undefined,
        stock: Math.round(input.stock),
        minStockThreshold: Math.round(input.minStockThreshold),
        soldCount: Math.max(0, Math.round(Number(body.soldCount) || 0)),
        imageUrl: validImages[0],
        images: validImages,
        specs: cleanSpecs,
        featured: session.role === 'admin' ? Boolean(body.featured) : false,
        freeShipping: Boolean(body.freeShipping),
        benefitId:
          typeof body.benefitId === 'string' && ID_PATTERN.test(body.benefitId.trim())
            ? clampString(body.benefitId.trim(), 128)
            : '',
        benefitEnabled: Boolean(body.benefitEnabled),
        active: Boolean(body.active),
        sellerId: sellerUid,
        sellerName,
        ...(sellerBankAlias ? { sellerBankAlias } : {}),
        ...(sellerBankCbuCvu ? { sellerBankCbuCvu } : {}),
        ...(sellerBankAccountHolder ? { sellerBankAccountHolder } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.products.unshift(product);
      return product;
    });

    broadcastDbChange('products');
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof Error && err.message === 'SUBSCRIPTION_INACTIVE') {
      res.status(403).json({
        error:
          'Tu período gratuito de 30 días venció o tu cuenta está inactiva. Registrá el pago mensual de $ 5.000 para publicar o reactivar tus ventas.',
      });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error al crear producto.' });
  }
});

app.put('/api/local/products/:id', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const productId = String(req.params.id || '');
    const body = req.body ?? {};
    if (!isValidCategory(body.category)) {
      res.status(400).json({ error: 'Rubro inválido.' });
      return;
    }

    const input = {
      sku: String(body.sku || '').toUpperCase(),
      name: String(body.name || ''),
      category: body.category as CategoryId,
      description: String(body.description || ''),
      price: Number(body.price),
      stock: Number(body.stock),
      minStockThreshold: Number(body.minStockThreshold),
    };
    const errMsg = validateProductInput(input);
    if (errMsg) {
      res.status(400).json({ error: errMsg });
      return;
    }

    const validImages = parseAndValidateProductImages(body.images, body.imageUrl, input.category);
    const cleanSpecs = Array.isArray(body.specs)
      ? body.specs
          .filter((s: unknown): s is string => typeof s === 'string')
          .map((s: string) => clampString(s, 120))
          .filter(Boolean)
          .slice(0, 8)
      : [];

    const updated = await withDbWriteLock((db) => {
      const idx = db.products.findIndex((p) => p.id === productId);
      if (idx === -1) throw new Error('NOT_FOUND');
      const existing = db.products[idx];
      if (session.role !== 'admin') {
        if (existing.sellerId !== session.uid) throw new Error('FORBIDDEN');
        const actor = db.users.find((u) => u.uid === session.uid);
        if (!isLocalUserSubscriptionActive(actor)) throw new Error('SUBSCRIPTION_INACTIVE');
      }
      const ownerUser = existing.sellerId
        ? db.users.find((u) => u.uid === existing.sellerId)
        : db.users.find((u) => u.uid === session.uid);
      const nextBankAlias = clampString(
        String(body.sellerBankAlias ?? ownerUser?.bankAlias ?? existing.sellerBankAlias ?? ''),
        60,
      );
      const nextBankCbuCvu = clampString(
        String(body.sellerBankCbuCvu ?? ownerUser?.bankCbuCvu ?? existing.sellerBankCbuCvu ?? ''),
        32,
      );
      const nextBankHolder = clampString(
        String(
          body.sellerBankAccountHolder ??
            ownerUser?.bankAccountHolder ??
            existing.sellerBankAccountHolder ??
            '',
        ),
        120,
      );
      const next: Product = {
        ...existing,
        sku: clampString(input.sku, 32),
        name: clampString(input.name, 120),
        category: input.category,
        categoryLabel: clampString(CATEGORY_MAP[input.category].label, 48),
        description: clampString(input.description, 800),
        price: Math.round(input.price),
        compareAtPrice:
          typeof body.compareAtPrice === 'number' && body.compareAtPrice > input.price
            ? Math.round(body.compareAtPrice)
            : undefined,
        stock: Math.round(input.stock),
        minStockThreshold: Math.round(input.minStockThreshold),
        imageUrl: validImages[0],
        images: validImages,
        specs: cleanSpecs,
        featured: session.role === 'admin' ? Boolean(body.featured) : existing.featured,
        freeShipping: Boolean(body.freeShipping),
        benefitId:
          typeof body.benefitId === 'string' && ID_PATTERN.test(body.benefitId.trim())
            ? clampString(body.benefitId.trim(), 128)
            : '',
        benefitEnabled: Boolean(body.benefitEnabled),
        active: Boolean(body.active),
        sellerBankAlias: nextBankAlias || undefined,
        sellerBankCbuCvu: nextBankCbuCvu || undefined,
        sellerBankAccountHolder: nextBankHolder || undefined,
        updatedAt: new Date().toISOString(),
      };
      db.products[idx] = next;
      return next;
    });

    broadcastDbChange('products');
    res.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Solo podés editar tus propias publicaciones.' });
      return;
    }
    if (err instanceof Error && err.message === 'SUBSCRIPTION_INACTIVE') {
      res.status(403).json({
        error:
          'Tu período gratuito de 30 días venció o tu cuenta está inactiva. Registrá el pago mensual de $ 5.000 para reactivar tus publicaciones.',
      });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error al actualizar producto.' });
  }
});

app.patch('/api/local/products/:id/stock', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const productId = String(req.params.id || '');
  const stockNum = Math.max(0, Math.min(100000, Math.round(Number(req.body?.stock))));
  if (!Number.isFinite(stockNum)) {
    res.status(400).json({ error: 'Stock inválido.' });
    return;
  }

  try {
    await withDbWriteLock((db) => {
      const target = db.products.find((p) => p.id === productId);
      if (!target) throw new Error('NOT_FOUND');
      if (session.role !== 'admin') {
        if (target.sellerId !== session.uid) throw new Error('FORBIDDEN');
        const actor = db.users.find((u) => u.uid === session.uid);
        if (!isLocalUserSubscriptionActive(actor)) throw new Error('SUBSCRIPTION_INACTIVE');
      }
      target.stock = stockNum;
      target.updatedAt = new Date().toISOString();
    });
    broadcastDbChange('products');
    res.json({ ok: true, stock: stockNum });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'FORBIDDEN') {
      res.status(403).json({ error: 'Solo podés modificar el stock de tus propias publicaciones.' });
      return;
    }
    if (code === 'SUBSCRIPTION_INACTIVE') {
      res.status(403).json({
        error:
          'Tu cuenta está inactiva por vencimiento de los 30 días gratuitos. Registrá el pago mensual de $ 5.000.',
      });
      return;
    }
    res.status(404).json({ error: 'Producto no encontrado.' });
  }
});

app.delete('/api/local/products/:id', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const productId = String(req.params.id || '');
  try {
    await withDbWriteLock((db) => {
      const target = db.products.find((p) => p.id === productId);
      if (!target) return;
      if (session.role !== 'admin' && target.sellerId !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      db.products = db.products.filter((p) => p.id !== productId);
    });
    broadcastDbChange('products');
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Solo podés eliminar tus propias publicaciones.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos eliminar el producto.' });
  }
});

// --- API: Orders & Atomic Inventory Transaction ---

app.post('/api/local/orders', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const body = req.body ?? {};
    const cartItems = Array.isArray(body.cartItems) ? body.cartItems.slice(0, 30) : [];
    if (cartItems.length === 0) {
      res.status(400).json({ error: 'El carrito está vacío.' });
      return;
    }

    const paymentMethod = body.paymentMethod as PaymentMethod;
    if (!['card', 'wallet', 'transfer', 'cash'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Medio de pago inválido.' });
      return;
    }

    const rawDeliveryMethod = body.deliveryMethod;
    if (
      rawDeliveryMethod !== undefined &&
      rawDeliveryMethod !== 'delivery' &&
      rawDeliveryMethod !== 'pickup'
    ) {
      res.status(400).json({ error: 'Modalidad de entrega inválida.' });
      return;
    }
    const deliveryMethod: DeliveryMethod = rawDeliveryMethod === 'pickup' ? 'pickup' : 'delivery';
    const isPickup = deliveryMethod === 'pickup';

    const customerNameClean = clampString(String(body.customerName || ''), 100);
    const shippingPhoneClean = clampString(String(body.shippingPhone || ''), 32);
    if (customerNameClean.length < 2) {
      res.status(400).json({ error: 'Ingresá tu nombre completo.' });
      return;
    }
    if (shippingPhoneClean.length < 6) {
      res.status(400).json({ error: 'Ingresá un teléfono de contacto válido.' });
      return;
    }

    const resolvedShippingAddress = isPickup
      ? 'Retiro en domicilio'
      : clampString(String(body.shippingAddress || ''), 200);
    const resolvedShippingCity = isPickup
      ? 'Retiro personal'
      : clampString(String(body.shippingCity || ''), 80);
    const resolvedShippingPostalCode = isPickup
      ? 'RET'
      : clampString(String(body.shippingPostalCode || ''), 20);

    if (
      !isPickup &&
      (resolvedShippingAddress.length < 4 ||
        resolvedShippingCity.length < 2 ||
        resolvedShippingPostalCode.length < 3)
    ) {
      res.status(400).json({
        error: 'Completá dirección, ciudad y código postal para coordinar el envío a domicilio.',
      });
      return;
    }

    const sanitizedReceipt =
      paymentMethod === 'transfer' && body.paymentReceipt
        ? sanitizePaymentReceipt(body.paymentReceipt)
        : undefined;

    const createdOrder = await withDbWriteLock((db) => {
      const verifiedItems: {
        product: Product;
        qty: number;
        thumb: string;
      }[] = [];

      for (const item of cartItems) {
        const qty = Math.round(Number(item?.quantity));
        const prodId = String(item?.productId || '');
        if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
          throw new Error('Cantidad inválida en el carrito.');
        }
        const product = db.products.find((p) => p.id === prodId);
        if (!product) {
          throw new Error(`El producto "${String(item?.name || prodId)}" ya no se encuentra disponible.`);
        }
        if (!product.active) {
          throw new Error(`El producto "${product.name}" no está activo para la venta.`);
        }
        if (product.sellerId) {
          const owner = db.users.find((u) => u.uid === product.sellerId);
          if (owner && !isLocalUserSubscriptionActive(owner)) {
            throw new Error(`La publicación "${product.name}" se encuentra pausada temporalmente.`);
          }
        }
        if (product.stock < qty) {
          throw new Error(`Stock insuficiente para "${product.name}" (disponible: ${product.stock} u.).`);
        }
        const rawThumb = typeof item?.imageUrl === 'string' && isValidImageSource(item.imageUrl)
          ? item.imageUrl
          : product.imageUrl;
        verifiedItems.push({ product, qty, thumb: rawThumb });
      }

      for (const entry of verifiedItems) {
        entry.product.stock -= entry.qty;
        entry.product.soldCount += entry.qty;
        entry.product.updatedAt = new Date().toISOString();
      }

      const orderId = safeId('ord');
      const notifId = safeId('ntf');
      const orderNumber = generateOrderNumber();
      const trackingCode = generateTrackingCode();
      const txPrefix =
        paymentMethod === 'card'
          ? 'PAY'
          : paymentMethod === 'wallet'
            ? 'WLT'
            : paymentMethod === 'cash'
              ? 'CSH'
              : 'TRF';
      const transactionId = generateTransactionId(txPrefix);
      const nowIso = new Date().toISOString();
      const installments = Math.max(1, Math.min(12, Math.round(Number(body.installments) || 1)));
      const paymentBrand = clampString(
        String(
          body.paymentBrand ||
            (paymentMethod === 'cash'
              ? 'Efectivo'
              : paymentMethod === 'transfer'
                ? 'Transferencia CBU'
                : 'Pago local'),
        ),
        32,
      );
      const paymentStatus: PaymentStatus =
        paymentMethod === 'transfer'
          ? 'pending_transfer'
          : paymentMethod === 'cash'
            ? 'pending_cash'
            : 'approved';

      const initialEvent: TrackingEvent = {
        status: 'confirmed',
        label: 'Pedido confirmado',
        location: 'Plataforma Infourqui Mercado (PC Local)',
        note:
          paymentMethod === 'transfer'
            ? sanitizedReceipt
              ? `Transferencia registrada con comprobante adjunto${sanitizedReceipt.operationNumber ? ` (Op. ${sanitizedReceipt.operationNumber})` : ''}. ${isPickup ? 'Modalidad: retiro en domicilio.' : 'Reserva de inventario confirmada.'}`
              : `Transferencia registrada. ${isPickup ? 'Modalidad: retiro en domicilio.' : 'Reserva de inventario confirmada.'}`
            : paymentMethod === 'cash'
              ? isPickup
                ? 'Pago en efectivo al retirar en domicilio. Reserva de inventario confirmada.'
                : 'Pago en efectivo al recibir el pedido en domicilio. Reserva de inventario confirmada.'
              : `Pago aprobado (${paymentBrand}${installments > 1 ? ` · ${installments} cuotas` : ''}).`,
        timestampIso: nowIso,
      };

      const serverSubtotal = verifiedItems.reduce(
        (sum, entry) => sum + entry.product.price * entry.qty,
        0,
      );
      const maxPromoDiscount = Math.round(serverSubtotal * 0.1);
      const maxTransferDiscount =
        paymentMethod === 'transfer'
          ? Math.round((serverSubtotal - maxPromoDiscount) * 0.05)
          : 0;
      const maxAllowedDiscount = maxPromoDiscount + maxTransferDiscount;
      const requestedDiscount = Math.max(0, Math.round(Number(body.discount) || 0));
      const serverDiscount = Math.min(requestedDiscount, maxAllowedDiscount, serverSubtotal);
      const hasFreeShippingProduct = verifiedItems.some(({ product }) => Boolean(product.freeShipping));
      const threshold = Math.max(0, db.shippingSettings.freeShippingThreshold);
      const baseShippingCost = Math.max(0, db.shippingSettings.standardShippingCost);
      const serverShippingCost =
        isPickup ||
        hasFreeShippingProduct ||
        threshold === 0 ||
        serverSubtotal - serverDiscount >= threshold
          ? 0
          : baseShippingCost;
      const serverTotal = Math.max(1, serverSubtotal - serverDiscount + serverShippingCost);

      const order: Order = {
        id: orderId,
        orderNumber,
        trackingCode,
        userId: session.uid,
        customerName: customerNameClean,
        customerEmail: clampString(session.email, 120),
        shippingPhone: shippingPhoneClean,
        shippingAddress: resolvedShippingAddress,
        shippingCity: resolvedShippingCity,
        shippingPostalCode: resolvedShippingPostalCode,
        shippingNotes: clampString(String(body.shippingNotes || 'Sin indicaciones adicionales'), 240),
        deliveryMethod,
        items: verifiedItems.map(({ product, qty, thumb }) => ({
          productId: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          quantity: qty,
          imageUrl: thumb,
        })),
        subtotal: serverSubtotal,
        discount: serverDiscount,
        shippingCost: serverShippingCost,
        total: serverTotal,
        paymentMethod,
        paymentBrand,
        paymentLast4: clampString(String(body.paymentLast4 || ''), 4),
        installments,
        transactionId,
        paymentStatus,
        ...(sanitizedReceipt ? { paymentReceipt: sanitizedReceipt } : {}),
        shipmentStatus: 'confirmed',
        carrier: isPickup ? 'Retiro en domicilio' : 'Infourqui Express Logística',
        estimatedDelivery: isPickup ? 'A coordinar por contacto' : '3 a 5 días hábiles',
        currentLocation: isPickup
          ? 'Listo para coordinar retiro en domicilio'
          : 'Depósito Central — Reserva confirmada',
        trackingEvents: [initialEvent],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const notif: AppNotification = {
        id: notifId,
        userId: session.uid,
        title: `Pedido ${orderNumber} confirmado`,
        message: isPickup
          ? `Tu compra con retiro en domicilio fue confirmada. Código: ${trackingCode}.`
          : `Tu compra fue procesada correctamente. Código de seguimiento: ${trackingCode}.`,
        type: 'order',
        orderId,
        read: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      db.orders.unshift(order);
      db.notifications.unshift(notif);
      return order;
    });

    broadcastDbChange('all');
    res.status(201).json(createdOrder);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'No pudimos registrar el pedido.' });
  }
});

app.get('/api/local/orders/lookup', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) {
    res.json({ order: null });
    return;
  }

  const db = loadLocalDb();
  const found = db.orders.find((o) => {
    const matchesCode = o.trackingCode.toUpperCase() === code || o.orderNumber.toUpperCase() === code;
    if (!matchesCode) return false;
    return session.role === 'admin' || o.userId === session.uid;
  });

  res.json({ order: found || null });
});

function sanitizeAssignedCourier(raw: unknown): AssignedCourier | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const agentId = clampString(String(obj.agentId || ''), 128);
  const fullName = clampString(String(obj.fullName || ''), 100);
  const vehicleType = String(obj.vehicleType || '').toLowerCase() as DeliveryVehicleType;
  const licensePlate = clampString(String(obj.licensePlate || '').toUpperCase(), 16);
  if (!agentId || !/^[a-zA-Z0-9_-]+$/.test(agentId)) return undefined;
  const err = validateDeliveryAgentInput({ vehicleType, licensePlate, fullName });
  if (err) return undefined;
  return { agentId, fullName, vehicleType, licensePlate };
}

// --- API: Delivery Agents (Medios de Envío) ABM (Admin Only) ---

app.post('/api/local/delivery-agents', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const body = req.body ?? {};
  const vehicleType = String(body.vehicleType || '').toLowerCase() as DeliveryVehicleType;
  const licensePlate = clampString(String(body.licensePlate || '').toUpperCase(), 16);
  const fullName = clampString(String(body.fullName || ''), 100);
  const active = body.active !== false;

  const errMsg = validateDeliveryAgentInput({ vehicleType, licensePlate, fullName });
  if (errMsg) {
    res.status(400).json({ error: errMsg });
    return;
  }

  const nowIso = new Date().toISOString();
  const created: DeliveryAgent = {
    id: safeId('drv'),
    vehicleType,
    licensePlate,
    fullName,
    active,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await withDbWriteLock((db) => {
    db.deliveryAgents.unshift(created);
  });

  broadcastDbChange('deliveryAgents');
  res.status(201).json(created);
});

app.put('/api/local/delivery-agents/:id', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const agentId = String(req.params.id || '').trim();
  const body = req.body ?? {};
  const vehicleType = String(body.vehicleType || '').toLowerCase() as DeliveryVehicleType;
  const licensePlate = clampString(String(body.licensePlate || '').toUpperCase(), 16);
  const fullName = clampString(String(body.fullName || ''), 100);
  const active = body.active !== false;

  const errMsg = validateDeliveryAgentInput({ vehicleType, licensePlate, fullName });
  if (errMsg) {
    res.status(400).json({ error: errMsg });
    return;
  }

  try {
    const updated = await withDbWriteLock((db) => {
      const idx = db.deliveryAgents.findIndex((a) => a.id === agentId);
      if (idx === -1) throw new Error('NOT_FOUND');
      const next: DeliveryAgent = {
        ...db.deliveryAgents[idx],
        vehicleType,
        licensePlate,
        fullName,
        active,
        updatedAt: new Date().toISOString(),
      };
      db.deliveryAgents[idx] = next;
      return next;
    });

    broadcastDbChange('deliveryAgents');
    res.json(updated);
  } catch {
    res.status(404).json({ error: 'Medio de envío no encontrado.' });
  }
});

app.delete('/api/local/delivery-agents/:id', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const agentId = String(req.params.id || '').trim();
  await withDbWriteLock((db) => {
    db.deliveryAgents = db.deliveryAgents.filter((a) => a.id !== agentId);
  });

  broadcastDbChange('deliveryAgents');
  res.json({ ok: true });
});

// --- API: Customer Benefits ABM (Admins & Authenticated Client Owners) ---

function normalizeBenefitBody(
  body: Record<string, unknown>,
  dbUsers: StoredLocalUser[],
  session: { uid: string; role: 'customer' | 'admin' },
) {
  const type = String(body.type || '').trim() as BenefitType;
  const title = clampString(String(body.title || ''), 100);
  const description = clampString(String(body.description || ''), 240);
  const rawTargetUserId = clampString(String(body.targetUserId || 'all'), 128) || 'all';
  if (
    session.role !== 'admin' &&
    rawTargetUserId !== 'all' &&
    rawTargetUserId !== session.uid
  ) {
    return {
      errMsg: 'Solo podés asignar descuentos a todos los clientes o a tu propia cuenta.',
      normalized: null,
    };
  }
  const targetUserId = rawTargetUserId;
  let targetUserName = clampString(String(body.targetUserName || ''), 120);
  if (targetUserId === 'all') {
    targetUserName = 'Todos los clientes';
  } else if (!targetUserName || session.role !== 'admin') {
    const matchedUser = dbUsers.find((u) => u.uid === targetUserId);
    targetUserName = clampString(
      matchedUser?.displayName || matchedUser?.email || targetUserName || 'Cliente registrado',
      120,
    );
  }
  const promoCode =
    type === 'promo_code' ? clampString(String(body.promoCode || '').toUpperCase(), 24) : '';
  const discountPercent =
    type === 'installments' ? 0 : Math.round(Number(body.discountPercent ?? 0));
  const minOrderAmount = Math.max(0, Math.round(Number(body.minOrderAmount ?? 0)));
  const maxInstallments =
    type === 'installments' ? Math.round(Number(body.maxInstallments ?? 3)) : 1;
  const expiresAt = clampString(String(body.expiresAt || ''), 20);
  const active = body.active !== false;

  const errMsg = validateBenefitInput({
    title,
    description,
    type,
    targetUserId,
    targetUserName,
    promoCode,
    discountPercent,
    minOrderAmount,
    maxInstallments,
    expiresAt,
  });

  return {
    errMsg,
    normalized: {
      title,
      description,
      type,
      targetUserId,
      targetUserName,
      promoCode,
      discountPercent,
      minOrderAmount,
      maxInstallments,
      expiresAt,
      active,
    },
  };
}

app.post('/api/local/benefits', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const db = loadLocalDb();
  const { errMsg, normalized } = normalizeBenefitBody(
    (req.body ?? {}) as Record<string, unknown>,
    db.users,
    session,
  );
  if (errMsg || !normalized) {
    res.status(400).json({ error: errMsg || 'Datos de beneficio inválidos.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const created: CustomerBenefit = {
    id: safeId('ben'),
    ...normalized,
    createdBy: session.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await withDbWriteLock((lockedDb) => {
    lockedDb.benefits.unshift(created);
  });

  broadcastDbChange('benefits');
  res.status(201).json(created);
});

app.put('/api/local/benefits/:id', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const benefitId = String(req.params.id || '').trim();
  const db = loadLocalDb();
  const { errMsg, normalized } = normalizeBenefitBody(
    (req.body ?? {}) as Record<string, unknown>,
    db.users,
    session,
  );
  if (errMsg || !normalized) {
    res.status(400).json({ error: errMsg || 'Datos de beneficio inválidos.' });
    return;
  }

  try {
    const updated = await withDbWriteLock((lockedDb) => {
      const idx = lockedDb.benefits.findIndex((b) => b.id === benefitId);
      if (idx === -1) throw new Error('NOT_FOUND');
      const existing = lockedDb.benefits[idx];
      if (session.role !== 'admin' && existing.createdBy !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      const next: CustomerBenefit = {
        ...existing,
        ...normalized,
        createdBy: existing.createdBy,
        updatedAt: new Date().toISOString(),
      };
      lockedDb.benefits[idx] = next;
      return next;
    });

    broadcastDbChange('benefits');
    res.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Solo podés editar tus propios descuentos y beneficios.' });
      return;
    }
    res.status(404).json({ error: 'Beneficio no encontrado.' });
  }
});

app.delete('/api/local/benefits/:id', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const benefitId = String(req.params.id || '').trim();
  try {
    await withDbWriteLock((lockedDb) => {
      const target = lockedDb.benefits.find((b) => b.id === benefitId);
      if (!target) throw new Error('NOT_FOUND');
      if (session.role !== 'admin' && target.createdBy !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      lockedDb.benefits = lockedDb.benefits.filter((b) => b.id !== benefitId);
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Solo podés eliminar tus propios descuentos y beneficios.' });
      return;
    }
    res.status(404).json({ error: 'Beneficio no encontrado.' });
    return;
  }

  broadcastDbChange('benefits');
  res.json({ ok: true });
});

app.patch('/api/local/orders/:id/advance', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const orderId = String(req.params.id || '');
  const nextStatus = req.body?.nextStatus as ShipmentStatus;
  if (
    !['confirmed', 'preparing', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'].includes(
      nextStatus,
    )
  ) {
    res.status(400).json({ error: 'Estado logístico inválido.' });
    return;
  }

  const assignedCourier = sanitizeAssignedCourier(req.body?.assignedCourier);

  try {
    await withDbWriteLock((db) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) throw new Error('NOT_FOUND');

      const stageMeta = SHIPMENT_PIPELINE.find((s) => s.status === nextStatus);
      const label =
        stageMeta?.label || (nextStatus === 'cancelled' ? 'Pedido cancelado' : nextStatus);
      const location = clampString(String(req.body?.location || order.currentLocation), 120);
      const note = clampString(
        String(req.body?.note || stageMeta?.description || 'Actualización logística.'),
        200,
      );
      const nowIso = new Date().toISOString();

      order.shipmentStatus = nextStatus;
      order.currentLocation = location;
      if (assignedCourier) {
        order.assignedCourier = assignedCourier;
      }
      order.estimatedDelivery =
        nextStatus === 'delivered'
          ? 'Entregado'
          : nextStatus === 'out_for_delivery'
            ? 'Hoy antes de las 20:00 hs'
            : nextStatus === 'in_transit'
              ? 'Mañana antes de las 18:00 hs'
              : order.estimatedDelivery;
      order.trackingEvents = [
        ...order.trackingEvents,
        { status: nextStatus, label, location, note, timestampIso: nowIso },
      ].slice(-15);
      order.updatedAt = nowIso;

      db.notifications.unshift({
        id: safeId('ntf'),
        userId: order.userId,
        title: `Envío ${order.orderNumber}: ${label}`,
        message: `${clampString(note, 220)} (${clampString(location, 80)})`,
        type: 'shipment',
        orderId: order.id,
        read: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });

    broadcastDbChange('orders');
    broadcastDbChange('notifications');
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Pedido no encontrado.' });
  }
});

app.patch('/api/local/orders/:id/revert', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const orderId = String(req.params.id || '');
  try {
    await withDbWriteLock((db) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) throw new Error('NOT_FOUND');

      const previousStatus = getPreviousShipmentStatus(order.shipmentStatus);
      if (!previousStatus) throw new Error('CANNOT_REVERT');

      const currentStatus = order.shipmentStatus;
      const trimmedEvents = [...order.trackingEvents];
      while (
        trimmedEvents.length > 1 &&
        trimmedEvents[trimmedEvents.length - 1]?.status === currentStatus
      ) {
        trimmedEvents.pop();
      }
      const lastEvent = trimmedEvents[trimmedEvents.length - 1];
      const isPickup =
        order.deliveryMethod === 'pickup' || order.carrier === 'Retiro en domicilio';

      order.shipmentStatus = previousStatus;
      order.trackingEvents = trimmedEvents;
      order.currentLocation = clampString(
        lastEvent?.location ||
          (isPickup
            ? 'Listo para coordinar retiro en domicilio'
            : 'Depósito Central — Reserva confirmada'),
        120,
      );
      order.estimatedDelivery =
        previousStatus === 'out_for_delivery'
          ? 'Hoy antes de las 20:00 hs'
          : previousStatus === 'in_transit'
            ? 'Mañana antes de las 18:00 hs'
            : isPickup
              ? 'A coordinar por contacto'
              : '3 a 5 días hábiles';
      if (previousStatus === 'confirmed') {
        delete order.assignedCourier;
      }
      order.updatedAt = new Date().toISOString();
    });

    broadcastDbChange('orders');
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'CANNOT_REVERT') {
      res.status(400).json({
        error: 'Este pedido ya se encuentra en su etapa inicial y no puede retroceder más.',
      });
      return;
    }
    res.status(404).json({ error: 'Pedido no encontrado.' });
  }
});

app.patch('/api/local/orders/:id/cancel', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const orderId = String(req.params.id || '');
  try {
    await withDbWriteLock((db) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) throw new Error('NOT_FOUND');
      if (session.role !== 'admin' && order.userId !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      if (session.role !== 'admin' && order.shipmentStatus !== 'confirmed') {
        throw new Error('INVALID_STATE');
      }
      const nowIso = new Date().toISOString();
      order.shipmentStatus = 'cancelled';
      order.trackingEvents = [
        ...order.trackingEvents,
        {
          status: 'cancelled' as const,
          label: 'Pedido cancelado por el cliente',
          location: 'Plataforma Infourqui Mercado',
          note: 'Cancelación solicitada antes del despacho.',
          timestampIso: nowIso,
        },
      ].slice(-15);
      order.updatedAt = nowIso;
    });
    broadcastDbChange('orders');
    res.json({ ok: true });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'FORBIDDEN') {
      res.status(403).json({ error: 'No tenés permiso para cancelar este pedido.' });
      return;
    }
    if (code === 'INVALID_STATE') {
      res.status(400).json({ error: 'Solo se pueden cancelar pedidos antes del despacho.' });
      return;
    }
    res.status(404).json({ error: 'Pedido no encontrado.' });
  }
});

// --- API: Notifications ---

app.post('/api/local/notifications', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const title = clampString(String(req.body?.title || ''), 100);
  const message = clampString(String(req.body?.message || ''), 320);
  const type = req.body?.type as NotificationType;
  if (title.length < 2 || message.length < 2) {
    res.status(400).json({ error: 'Completá título y mensaje de la notificación.' });
    return;
  }
  if (!['order', 'shipment', 'promo', 'inventory'].includes(type)) {
    res.status(400).json({ error: 'Tipo de notificación inválido.' });
    return;
  }

  await withDbWriteLock((db) => {
    const nowIso = new Date().toISOString();
    db.notifications.unshift({
      id: safeId('ntf'),
      userId: clampString(String(req.body?.targetUserId || 'all'), 128) || 'all',
      title,
      message,
      type,
      orderId: clampString(String(req.body?.orderId || ''), 128),
      read: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  broadcastDbChange('notifications');
  res.status(201).json({ ok: true });
});

app.patch('/api/local/notifications/:id/read', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const notifId = String(req.params.id || '');
  try {
    await withDbWriteLock((db) => {
      const target = db.notifications.find((n) => n.id === notifId);
      if (!target) throw new Error('NOT_FOUND');
      if (session.role !== 'admin' && target.userId !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      target.read = true;
      target.updatedAt = new Date().toISOString();
    });
    broadcastDbChange('notifications');
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Sin permisos.' });
      return;
    }
    res.status(404).json({ error: 'Notificación no encontrada.' });
  }
});

app.delete('/api/local/notifications/:id', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const notifId = String(req.params.id || '');
  try {
    await withDbWriteLock((db) => {
      const target = db.notifications.find((n) => n.id === notifId);
      if (!target) throw new Error('NOT_FOUND');
      if (session.role !== 'admin' && target.userId !== session.uid) {
        throw new Error('FORBIDDEN');
      }
      db.notifications = db.notifications.filter((n) => n.id !== notifId);
    });
    broadcastDbChange('notifications');
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      res.status(403).json({ error: 'Sin permisos.' });
      return;
    }
    res.status(404).json({ error: 'Notificación no encontrada.' });
  }
});

// --- API: Own User Profile ---

app.patch('/api/local/profile', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const body = req.body ?? {};
  try {
    const updated = await withDbWriteLock((db) => {
      const user = db.users.find((u) => u.uid === session.uid);
      if (!user) throw new Error('NOT_FOUND');
      if (typeof body.displayName === 'string') user.displayName = clampString(body.displayName, 100);
      if (typeof body.businessName === 'string') user.businessName = clampString(body.businessName, 120);
      if (typeof body.phone === 'string') user.phone = clampString(body.phone, 32);
      if (typeof body.defaultAddress === 'string') user.defaultAddress = clampString(body.defaultAddress, 200);
      if (typeof body.defaultCity === 'string') user.defaultCity = clampString(body.defaultCity, 80);
      if (typeof body.defaultPostalCode === 'string')
        user.defaultPostalCode = clampString(body.defaultPostalCode, 20);
      if (typeof body.bankCbuCvu === 'string')
        user.bankCbuCvu = clampString(body.bankCbuCvu, 32);
      if (typeof body.bankAlias === 'string')
        user.bankAlias = clampString(body.bankAlias, 60);
      if (typeof body.bankAccountHolder === 'string')
        user.bankAccountHolder = clampString(body.bankAccountHolder, 120);
      if (typeof body.pushEnabled === 'boolean') user.pushEnabled = body.pushEnabled;
      const nowIso = new Date().toISOString();
      user.updatedAt = nowIso;

      // Keep seller's published products synchronized with updated banking details
      for (const prod of db.products) {
        if (prod.sellerId === user.uid) {
          prod.sellerBankAlias = user.bankAlias || undefined;
          prod.sellerBankCbuCvu = user.bankCbuCvu || undefined;
          prod.sellerBankAccountHolder =
            user.bankAccountHolder || user.businessName || user.displayName || undefined;
          prod.updatedAt = nowIso;
        }
      }
      return toPublicProfile(user);
    });
    broadcastDbChange('products');
    res.json({ profile: updated, user: toAppUser(updated) });
  } catch {
    res.status(404).json({ error: 'Perfil no encontrado.' });
  }
});

// --- API: Shipping Tariff Settings (Admin Only) ---

app.put('/api/local/settings/shipping', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const freeShippingThreshold = Math.round(Number(req.body?.freeShippingThreshold));
  const standardShippingCost = Math.round(Number(req.body?.standardShippingCost));

  if (
    !Number.isFinite(freeShippingThreshold) ||
    freeShippingThreshold < 0 ||
    freeShippingThreshold > 100000000
  ) {
    res.status(400).json({ error: 'Monto de envío gratis inválido.' });
    return;
  }
  if (
    !Number.isFinite(standardShippingCost) ||
    standardShippingCost < 0 ||
    standardShippingCost > 10000000
  ) {
    res.status(400).json({ error: 'Costo de envío estándar inválido.' });
    return;
  }

  const nextSettings = await withDbWriteLock((db) => {
    db.shippingSettings = {
      freeShippingThreshold,
      standardShippingCost,
      updatedBy: session.uid,
      updatedAt: new Date().toISOString(),
    };
    return db.shippingSettings;
  });

  broadcastDbChange('settings');
  res.json(nextSettings);
});

// --- API: Monthly Seller Subscription Payments & Admin Accounts ---

app.get('/api/local/subscription-payments', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const db = loadLocalDb();
  const payments =
    session.role === 'admin'
      ? [...db.subscriptionPayments]
      : db.subscriptionPayments.filter((p) => p.userId === session.uid);
  res.json({ payments });
});

app.post('/api/local/subscription-payments', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const body = req.body ?? {};
    const paymentMethod = body.paymentMethod as SubscriptionPaymentMethod;
    if (paymentMethod !== 'cash' && paymentMethod !== 'transfer') {
      res.status(400).json({ error: 'Seleccioná Efectivo o Transferencia como medio de pago.' });
      return;
    }

    const sanitizedReceipt =
      paymentMethod === 'transfer' && body.paymentReceipt
        ? sanitizePaymentReceipt(body.paymentReceipt)
        : undefined;

    if (paymentMethod === 'transfer' && !sanitizedReceipt) {
      res.status(400).json({ error: 'Adjuntá la imagen del comprobante de transferencia.' });
      return;
    }

    const note = clampString(String(body.note || ''), 300);

    const created = await withDbWriteLock((db) => {
      const user = db.users.find((u) => u.uid === session.uid);
      const nowIso = new Date().toISOString();
      const payment: SubscriptionPayment = {
        id: safeId('sub'),
        userId: session.uid,
        userName: clampString(user?.displayName || session.email, 100),
        userEmail: clampString(user?.email || session.email, 120),
        businessName: clampString(user?.businessName || '', 120),
        amount: MONTHLY_SUBSCRIPTION_COST,
        paymentMethod,
        status: 'pending',
        note,
        ...(sanitizedReceipt ? { paymentReceipt: sanitizedReceipt } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.subscriptionPayments.unshift(payment);

      db.notifications.unshift({
        id: safeId('ntf'),
        userId: session.uid,
        title: 'Pago mensual registrado ($ 5.000)',
        message:
          paymentMethod === 'transfer'
            ? 'Recibimos tu comprobante de transferencia para el abono mensual. El administrador revisará y activará tu cuenta a la brevedad.'
            : 'Registramos tu aviso de pago mensual en efectivo ($ 5.000). El administrador confirmará la activación de tu cuenta.',
        type: 'order',
        orderId: '',
        read: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      return payment;
    });

    broadcastDbChange('all');
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'No pudimos registrar el pago mensual.',
    });
  }
});

app.get('/api/local/admin/accounts', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;
  const db = loadLocalDb();
  res.json({ accounts: db.users.map(toPublicProfile) });
});

app.post('/api/local/admin/accounts', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const displayNameRaw = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const businessNameRaw = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
    const phoneRaw = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const bankCbuCvuRaw = typeof req.body?.bankCbuCvu === 'string' ? req.body.bankCbuCvu.trim() : '';
    const bankAliasRaw = typeof req.body?.bankAlias === 'string' ? req.body.bankAlias.trim() : '';
    const bankAccountHolderRaw =
      typeof req.body?.bankAccountHolder === 'string' ? req.body.bankAccountHolder.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!emailRaw || !emailRaw.includes('@') || emailRaw.length > 120) {
      res.status(400).json({ error: 'Ingresá un correo electrónico válido para el cliente.' });
      return;
    }
    if (displayNameRaw.length < 2 || displayNameRaw.length > 100) {
      res.status(400).json({ error: 'Ingresá el nombre completo del cliente (mínimo 2 caracteres).' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }

    const created = await withDbWriteLock((db) => {
      if (db.users.some((u) => u.email.toLowerCase() === emailRaw)) {
        throw new Error('EMAIL_EXISTS');
      }
      const nowIso = new Date().toISOString();
      const customer: StoredLocalUser = {
        uid: safeId('usr'),
        displayName: clampString(displayNameRaw, 100),
        businessName: clampString(businessNameRaw, 120),
        email: clampString(emailRaw, 120),
        photoURL: '',
        phone: clampString(phoneRaw, 32),
        defaultAddress: '',
        defaultCity: '',
        defaultPostalCode: '',
        bankCbuCvu: clampString(bankCbuCvuRaw, 32),
        bankAlias: clampString(bankAliasRaw, 60),
        bankAccountHolder: clampString(bankAccountHolderRaw, 120),
        pushEnabled: false,
        role: 'customer',
        joinedAt: nowIso,
        subscriptionStatus: 'trial',
        subscriptionPaidUntil: '',
        lastActivatedAt: '',
        passwordHash: hashPassword(password),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.users.push(customer);
      return customer;
    });

    broadcastDbChange('all');
    res.status(201).json({ account: toPublicProfile(created) });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({ error: 'Ya existe un cliente registrado con ese correo.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos crear la cuenta del cliente.' });
  }
});

app.post('/api/local/admin/accounts/:uid/recovery-code', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const targetUid = String(req.params.uid || '').trim();
  const db = loadLocalDb();
  const target = db.users.find((u) => u.uid === targetUid);
  if (!target) {
    res.status(404).json({ error: 'Cuenta no encontrada.' });
    return;
  }

  const envPass = process.env.LOCAL_ADMIN_PASSWORD?.trim() || '';
  if (target.role === 'admin' && envPass) {
    res.status(400).json({
      error:
        'La contraseña del administrador local está configurada mediante LOCAL_ADMIN_PASSWORD.',
    });
    return;
  }

  const code = generateLocalRecoveryCode(target.uid, target.email);
  res.json({
    ok: true,
    code,
    email: target.email,
    expiresInMinutes: 15,
  });
});

app.patch('/api/local/admin/accounts/:uid/status', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const targetUid = String(req.params.uid || '').trim();
  const action = String(req.body?.action || '').trim();
  const paymentId = typeof req.body?.paymentId === 'string' ? req.body.paymentId.trim() : '';

  if (action !== 'activate' && action !== 'deactivate') {
    res.status(400).json({ error: 'Acción de estado de cuenta inválida.' });
    return;
  }

  try {
    const updatedProfile = await withDbWriteLock((db) => {
      const target = db.users.find((u) => u.uid === targetUid);
      if (!target) throw new Error('NOT_FOUND');

      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      if (action === 'activate') {
        const currentPaidUntilMs = target.subscriptionPaidUntil
          ? new Date(target.subscriptionPaidUntil).getTime()
          : 0;
        const baseMs = Number.isFinite(currentPaidUntilMs) && currentPaidUntilMs > now ? currentPaidUntilMs : now;
        const nextPaidUntilIso = new Date(baseMs + 30 * 24 * 60 * 60 * 1000).toISOString();

        target.subscriptionStatus = 'active';
        target.subscriptionPaidUntil = nextPaidUntilIso;
        target.lastActivatedAt = nowIso;
        target.updatedAt = nowIso;

        for (const p of db.subscriptionPayments) {
          if (p.userId === target.uid && (paymentId ? p.id === paymentId : p.status === 'pending')) {
            p.status = 'approved';
            p.reviewedBy = session.email;
            p.reviewedAt = nowIso;
            p.updatedAt = nowIso;
          }
        }

        for (const prod of db.products) {
          if (prod.sellerId === target.uid) {
            prod.active = true;
            prod.updatedAt = nowIso;
          }
        }

        db.notifications.unshift({
          id: safeId('ntf'),
          userId: target.uid,
          title: 'Cuenta de vendedor activada',
          message:
            'Tu pago mensual fue verificado. Tu cuenta y tus publicaciones de venta quedaron activas por 30 días.',
          type: 'order',
          orderId: '',
          read: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else {
        target.subscriptionStatus = 'inactive';
        target.updatedAt = nowIso;

        for (const prod of db.products) {
          if (prod.sellerId === target.uid) {
            prod.active = false;
            prod.updatedAt = nowIso;
          }
        }

        db.notifications.unshift({
          id: safeId('ntf'),
          userId: target.uid,
          title: 'Publicaciones pausadas',
          message:
            'Tu cuenta pasó a estado inactivo. Registrá tu pago mensual de $ 5.000 desde el Panel de control para reactivar tus publicaciones.',
          type: 'inventory',
          orderId: '',
          read: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      return toPublicProfile(target);
    });

    broadcastDbChange('all');
    res.json({ ok: true, profile: updatedProfile });
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Cuenta no encontrada.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos actualizar el estado de la cuenta.' });
  }
});

app.patch('/api/local/admin/subscription-payments/:id/reject', async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const paymentId = String(req.params.id || '').trim();
  try {
    await withDbWriteLock((db) => {
      const payment = db.subscriptionPayments.find((p) => p.id === paymentId);
      if (!payment) throw new Error('NOT_FOUND');
      const nowIso = new Date().toISOString();
      payment.status = 'rejected';
      payment.reviewedBy = session.email;
      payment.reviewedAt = nowIso;
      payment.updatedAt = nowIso;

      db.notifications.unshift({
        id: safeId('ntf'),
        userId: payment.userId,
        title: 'Comprobante de abono rechazado',
        message:
          'No pudimos validar tu comprobante de pago mensual ($ 5.000). Por favor volvé a cargar un comprobante legible desde el Panel de control.',
        type: 'order',
        orderId: '',
        read: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });

    broadcastDbChange('all');
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Comprobante de pago no encontrado.' });
      return;
    }
    res.status(500).json({ error: 'No pudimos rechazar el comprobante.' });
  }
});

// --- API: Database Backup & Restore (Local & LAN — Admin Only) ---

function sanitizeBackupPayloadForLocalRestore(
  rawBody: unknown,
  actorUid: string,
): {
  products: Product[];
  hasProducts: boolean;
  orders: Order[];
  hasOrders: boolean;
  notifications: AppNotification[];
  hasNotifications: boolean;
  shippingSettings?: {
    freeShippingThreshold: number;
    standardShippingCost: number;
    updatedBy: string;
    updatedAt: string;
  };
} {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();

  const hasProducts = Array.isArray(body.products);
  const sanitizedProducts: Product[] = [];
  if (Array.isArray(body.products)) {
    for (const raw of body.products.slice(0, 1000)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (!isValidCategory(item.category)) continue;
      const price = Math.round(Number(item.price));
      const stock = Math.max(0, Math.min(100000, Math.round(Number(item.stock) || 0)));
      const minStockThreshold = Math.max(
        0,
        Math.min(1000, Math.round(Number(item.minStockThreshold) || 0)),
      );
      if (!Number.isFinite(price) || price <= 0 || price > 100000000) continue;
      const validImages = parseAndValidateProductImages(
        item.images,
        item.imageUrl,
        item.category,
      );
      const rawSku = clampString(String(item.sku || 'SKU-001').toUpperCase(), 32)
        .replace(/[^A-Z0-9-]/g, '');
      sanitizedProducts.push({
        id:
          clampString(String(item.id || safeId('prod')), 64).replace(/[^a-zA-Z0-9_-]/g, '') ||
          safeId('prod'),
        sku: rawSku.length >= 3 ? rawSku : `SKU-${Math.floor(100 + Math.random() * 900)}`,
        name: clampString(String(item.name || 'Producto'), 120),
        category: item.category,
        categoryLabel: clampString(CATEGORY_MAP[item.category].label, 48),
        description: clampString(String(item.description || 'Producto restaurado.'), 800),
        price,
        compareAtPrice:
          typeof item.compareAtPrice === 'number' && item.compareAtPrice > price
            ? Math.round(item.compareAtPrice)
            : undefined,
        stock,
        minStockThreshold,
        soldCount: Math.max(0, Math.round(Number(item.soldCount) || 0)),
        imageUrl: validImages[0],
        images: validImages,
        specs: Array.isArray(item.specs)
          ? item.specs
              .filter((s): s is string => typeof s === 'string')
              .map((s) => clampString(s, 120))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        featured: Boolean(item.featured),
        freeShipping: Boolean(item.freeShipping),
        active: item.active !== false,
        createdAt: normalizeIsoTimestamp(item.createdAt, nowIso),
        updatedAt: normalizeIsoTimestamp(item.updatedAt, nowIso),
      });
    }
  }

  const hasOrders = Array.isArray(body.orders);
  const sanitizedOrders: Order[] = [];
  if (Array.isArray(body.orders)) {
    for (const raw of body.orders.slice(0, 5000)) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.orderNumber !== 'string' || typeof o.total !== 'number' || !Number.isFinite(o.total)) {
        continue;
      }
      const methodRaw = String(o.paymentMethod || 'card') as PaymentMethod;
      const paymentMethod: PaymentMethod = ['card', 'wallet', 'transfer', 'cash'].includes(methodRaw)
        ? methodRaw
        : 'card';
      const statusRaw = String(o.paymentStatus || 'approved') as PaymentStatus;
      const paymentStatus: PaymentStatus = [
        'approved',
        'pending_transfer',
        'pending_cash',
        'refunded',
      ].includes(statusRaw)
        ? statusRaw
        : 'approved';
      const shipRaw = String(o.shipmentStatus || 'confirmed') as ShipmentStatus;
      const shipmentStatus: ShipmentStatus = [
        'confirmed',
        'preparing',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'cancelled',
      ].includes(shipRaw)
        ? shipRaw
        : 'confirmed';

      let cleanReceipt: PaymentReceipt | undefined;
      if (o.paymentReceipt && typeof o.paymentReceipt === 'object') {
        try {
          cleanReceipt = sanitizePaymentReceipt(o.paymentReceipt);
        } catch {
          cleanReceipt = undefined;
        }
      }

      const rawItems = Array.isArray(o.items) ? o.items.slice(0, 30) : [];
      const items = rawItems
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
        .map((i) => {
          const cat: CategoryId = isValidCategory(i.category) ? i.category : 'tecnologia';
          const thumb =
            typeof i.imageUrl === 'string' && isValidImageSource(i.imageUrl)
              ? i.imageUrl
              : getDefaultCategoryImage(cat);
          return {
            productId: clampString(String(i.productId || 'prod'), 64),
            name: clampString(String(i.name || 'Producto'), 120),
            category: cat,
            price: Math.max(0, Math.round(Number(i.price) || 0)),
            quantity: Math.max(1, Math.min(1000, Math.round(Number(i.quantity) || 1))),
            imageUrl: thumb,
          };
        });
      if (items.length === 0) continue;

      const rawEvents = Array.isArray(o.trackingEvents) ? o.trackingEvents.slice(-15) : [];
      const trackingEvents: TrackingEvent[] =
        rawEvents.length > 0
          ? rawEvents
              .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
              .map((e) => ({
                status: [
                  'confirmed',
                  'preparing',
                  'in_transit',
                  'out_for_delivery',
                  'delivered',
                  'cancelled',
                ].includes(String(e.status))
                  ? (String(e.status) as ShipmentStatus)
                  : shipmentStatus,
                label: clampString(String(e.label || 'Actualización'), 80),
                location: clampString(String(e.location || 'Infourqui Mercado'), 120),
                note: clampString(String(e.note || 'Registro restaurado.'), 200),
                timestampIso: normalizeIsoTimestamp(e.timestampIso, nowIso),
              }))
          : [
              {
                status: shipmentStatus,
                label: 'Pedido restaurado',
                location: 'Plataforma Infourqui Mercado',
                note: 'Historial restaurado desde copia de seguridad.',
                timestampIso: nowIso,
              },
            ];

      sanitizedOrders.push({
        id:
          clampString(String(o.id || safeId('ord')), 64).replace(/[^a-zA-Z0-9_-]/g, '') ||
          safeId('ord'),
        orderNumber: clampString(String(o.orderNumber), 24),
        trackingCode: clampString(String(o.trackingCode || generateTrackingCode()), 24),
        userId:
          clampString(String(o.userId || actorUid), 128).replace(/[^a-zA-Z0-9_-]/g, '') || actorUid,
        customerName: clampString(String(o.customerName || 'Cliente'), 100),
        customerEmail: clampString(String(o.customerEmail || 'cliente@local'), 120),
        shippingPhone: clampString(String(o.shippingPhone || '000000'), 32),
        shippingAddress: clampString(String(o.shippingAddress || 'Sin dirección'), 200),
        shippingCity: clampString(String(o.shippingCity || 'Local'), 80),
        shippingPostalCode: clampString(String(o.shippingPostalCode || '0000'), 20),
        shippingNotes: clampString(String(o.shippingNotes || ''), 240),
        ...(o.deliveryMethod === 'pickup' || o.deliveryMethod === 'delivery'
          ? { deliveryMethod: o.deliveryMethod }
          : {}),
        items,
        subtotal: Math.max(0, Math.round(Number(o.subtotal) || Number(o.total))),
        discount: Math.max(0, Math.round(Number(o.discount) || 0)),
        shippingCost: Math.max(0, Math.round(Number(o.shippingCost) || 0)),
        total: Math.max(1, Math.round(Number(o.total))),
        paymentMethod,
        paymentBrand: clampString(String(o.paymentBrand || 'Pago'), 32),
        paymentLast4: clampString(String(o.paymentLast4 || ''), 4),
        installments: Math.max(1, Math.min(12, Math.round(Number(o.installments) || 1))),
        transactionId: clampString(String(o.transactionId || generateTransactionId('RST')), 40),
        paymentStatus,
        ...(cleanReceipt ? { paymentReceipt: cleanReceipt } : {}),
        shipmentStatus,
        carrier: clampString(String(o.carrier || 'Infourqui Express Logística'), 60),
        estimatedDelivery: clampString(String(o.estimatedDelivery || '3 a 5 días hábiles'), 40),
        currentLocation: clampString(String(o.currentLocation || 'Depósito Central'), 120),
        trackingEvents,
        createdAt: normalizeIsoTimestamp(o.createdAt, nowIso),
        updatedAt: normalizeIsoTimestamp(o.updatedAt, nowIso),
      });
    }
  }

  const hasNotifications = Array.isArray(body.notifications);
  const sanitizedNotifications: AppNotification[] = [];
  if (Array.isArray(body.notifications)) {
    for (const raw of body.notifications.slice(0, 2000)) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as Record<string, unknown>;
      const title = clampString(String(n.title || ''), 100);
      const message = clampString(String(n.message || ''), 320);
      if (title.length < 2 || message.length < 2) continue;
      const typeRaw = String(n.type || 'order') as NotificationType;
      const type: NotificationType = ['order', 'shipment', 'promo', 'inventory'].includes(typeRaw)
        ? typeRaw
        : 'order';
      sanitizedNotifications.push({
        id:
          clampString(String(n.id || safeId('ntf')), 64).replace(/[^a-zA-Z0-9_-]/g, '') ||
          safeId('ntf'),
        userId:
          clampString(String(n.userId || 'all'), 128).replace(/[^a-zA-Z0-9_-]/g, '') || 'all',
        title,
        message,
        type,
        orderId: clampString(String(n.orderId || ''), 128),
        read: Boolean(n.read),
        createdAt: normalizeIsoTimestamp(n.createdAt, nowIso),
        updatedAt: normalizeIsoTimestamp(n.updatedAt, nowIso),
      });
    }
  }

  let shippingSettings:
    | {
        freeShippingThreshold: number;
        standardShippingCost: number;
        updatedBy: string;
        updatedAt: string;
      }
    | undefined;
  const rawSettings = body.shippingSettings as Record<string, unknown> | undefined;
  if (
    rawSettings &&
    typeof rawSettings === 'object' &&
    typeof rawSettings.freeShippingThreshold === 'number' &&
    typeof rawSettings.standardShippingCost === 'number' &&
    Number.isFinite(rawSettings.freeShippingThreshold) &&
    Number.isFinite(rawSettings.standardShippingCost)
  ) {
    shippingSettings = {
      freeShippingThreshold: Math.max(
        0,
        Math.min(100000000, Math.round(rawSettings.freeShippingThreshold)),
      ),
      standardShippingCost: Math.max(
        0,
        Math.min(10000000, Math.round(rawSettings.standardShippingCost)),
      ),
      updatedBy: actorUid,
      updatedAt: nowIso,
    };
  }

  return {
    products: sanitizedProducts,
    hasProducts,
    orders: sanitizedOrders,
    hasOrders,
    notifications: sanitizedNotifications,
    hasNotifications,
    shippingSettings,
  };
}

async function applyLocalBackupRestore(
  rawBackup: unknown,
  actorUid: string,
  mode: 'replace' | 'merge',
) {
  const sanitized = sanitizeBackupPayloadForLocalRestore(rawBackup, actorUid);
  if (
    !sanitized.hasProducts &&
    !sanitized.hasOrders &&
    !sanitized.hasNotifications &&
    !sanitized.shippingSettings
  ) {
    throw new Error(
      'El archivo de respaldo no contiene datos válidos de Infourqui Mercado (productos, pedidos o configuración).',
    );
  }

  let safetyBackupFile: string | undefined;
  try {
    const snap = saveLocalBackupSnapshot(NETWORK_MODE, 'pre-restore');
    safetyBackupFile = snap.fileName;
  } catch {
    // Non-blocking if disk backup folder fails
  }

  await withDbWriteLock((db) => {
    if (sanitized.hasProducts) {
      if (mode === 'merge') {
        const map = new Map(db.products.map((p) => [p.id, p]));
        for (const p of sanitized.products) map.set(p.id, p);
        db.products = Array.from(map.values());
      } else {
        db.products = sanitized.products;
      }
    }
    if (sanitized.hasOrders) {
      if (mode === 'merge') {
        const map = new Map(db.orders.map((o) => [o.id, o]));
        for (const o of sanitized.orders) map.set(o.id, o);
        db.orders = Array.from(map.values());
      } else {
        db.orders = sanitized.orders;
      }
    }
    if (sanitized.hasNotifications) {
      if (mode === 'merge') {
        const map = new Map(db.notifications.map((n) => [n.id, n]));
        for (const n of sanitized.notifications) map.set(n.id, n);
        db.notifications = Array.from(map.values());
      } else {
        db.notifications = sanitized.notifications;
      }
    }
    if (sanitized.shippingSettings) {
      db.shippingSettings = sanitized.shippingSettings;
    }
  });

  broadcastDbChange('all');
  return {
    products: sanitized.products.length,
    orders: sanitized.orders.length,
    notifications: sanitized.notifications.length,
    shippingSettings: Boolean(sanitized.shippingSettings),
    safetyBackupFile,
  };
}

app.get('/api/local/backup', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const safeBackup = buildLocalBackupObject(NETWORK_MODE);
  const modeSuffix = NETWORK_MODE === 'lan' ? 'red-lan' : 'pc-local';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="infourqui-mercado-backup-${modeSuffix}-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.send(JSON.stringify(safeBackup, null, 2));
});

app.post('/api/local/restore', express.json({ limit: '25mb' }), async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const mode = String(req.query.mode || req.body?.restoreMode || 'replace').toLowerCase() === 'merge'
    ? 'merge'
    : 'replace';

  try {
    const restored = await applyLocalBackupRestore(req.body, admin.uid, mode);
    res.json({ ok: true, restored });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'No pudimos restaurar el archivo de respaldo.',
    });
  }
});

app.get('/api/local/backups', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    res.json({ backups: listLocalBackups() });
  } catch {
    res.status(500).json({ error: 'No pudimos listar las copias guardadas en el servidor.' });
  }
});

app.post('/api/local/backups/create', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    const snapshot = saveLocalBackupSnapshot(NETWORK_MODE, 'manual');
    res.status(201).json({ snapshot });
  } catch {
    res.status(500).json({ error: 'No pudimos guardar la copia de seguridad en disco.' });
  }
});

app.get('/api/local/backups/:fileName', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    const fileName = String(req.params.fileName || '');
    const content = readLocalBackupSnapshot(fileName);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${path.basename(fileName)}"`,
    );
    res.send(content);
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : 'Copia de seguridad no encontrada.',
    });
  }
});

app.post('/api/local/backups/:fileName/restore', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const mode = String(req.body?.mode || 'replace').toLowerCase() === 'merge' ? 'merge' : 'replace';
  try {
    const content = readLocalBackupSnapshot(String(req.params.fileName || ''));
    const parsed = JSON.parse(content) as unknown;
    const restored = await applyLocalBackupRestore(parsed, admin.uid, mode);
    res.json({ ok: true, restored });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'No pudimos restaurar la copia seleccionada.',
    });
  }
});

app.delete('/api/local/backups/:fileName', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    deleteLocalBackupSnapshot(String(req.params.fileName || ''));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'No pudimos eliminar la copia de seguridad.',
    });
  }
});

// --- API: Cloudflare Account Activation & Tunnel for Local Network / Mobile Access (Admin Only) ---

app.get('/api/local/cloudflare/status', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;
  res.json({ cloudflare: getCloudflareStatus(true) });
});

app.post('/api/local/cloudflare/activate', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    const forceRelogin = Boolean(req.body?.forceRelogin);
    const status = await activateCloudflareAccountInBrowser(PORT, forceRelogin);
    res.json({ cloudflare: status });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'No pudimos iniciar la activación de Cloudflare en el navegador.',
      cloudflare: getCloudflareStatus(true),
    });
  }
});

app.post('/api/local/cloudflare/start-tunnel', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  try {
    const status = await startCloudflareTunnel(PORT);
    res.json({ cloudflare: status });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'No pudimos generar la dirección web de Cloudflare.',
      cloudflare: getCloudflareStatus(true),
    });
  }
});

app.post('/api/local/cloudflare/open-chrome', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const rawTarget = typeof req.body?.target === 'string' ? req.body.target.toLowerCase() : 'auth';
  const target: 'auth' | 'public' = rawTarget === 'public' ? 'public' : 'auth';
  const result = openCloudflareUrlInChrome(target);
  res.json({
    opened: result.opened,
    chromeDetected: result.chromeDetected,
    cloudflare: result.status,
  });
});

app.post('/api/local/cloudflare/open-default-browser', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const rawTarget = typeof req.body?.target === 'string' ? req.body.target.toLowerCase() : 'public';
  const target: 'public' | 'auth' = rawTarget === 'auth' ? 'auth' : 'public';
  const result = openCloudflareUrlInDefaultBrowser(target);
  res.json({
    opened: result.opened,
    cloudflare: result.status,
  });
});

app.post('/api/local/cloudflare/stop', async (req, res) => {
  const admin = await requireAnyAdmin(req, res);
  if (!admin) return;

  const status = stopCloudflareTunnel();
  res.json({ cloudflare: status });
});

// --- API: Download Standalone PC Local & Red (LAN) App Bundle (Admin Only) ---

app.get('/api/local/download-app', async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Iniciá sesión como administrador para descargar el paquete de PC.' });
    return;
  }

  let authorizedAdmin = false;
  const authProvider = String(req.headers['x-auth-provider'] || '').toLowerCase();

  if (authProvider === 'firebase') {
    authorizedAdmin = await verifyFirebaseAdminToken(token);
  } else {
    const session = verifySessionToken(token);
    if (session) {
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Solo administradores pueden descargar el paquete de PC.' });
        return;
      }
      authorizedAdmin = true;
    }
  }

  if (!authorizedAdmin) {
    res.status(403).json({ error: 'Permisos insuficientes. Iniciá sesión con la cuenta administradora.' });
    return;
  }

  try {
    const platform: DownloadPlatform =
      String(req.query.platform || '').toLowerCase() === 'all' ? 'all' : 'windows';
    const zipBuffer = buildPcAppBundle(platform);
    const filename =
      platform === 'windows' ? 'infourqui-mercado-windows.zip' : 'infourqui-mercado-pc-local-red.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  } catch {
    res.status(500).json({ error: 'No pudimos empaquetar la aplicación para PC en este momento.' });
  }
});

// --- API: Transfer Receipt OCR / Payment Info Extraction (Authenticated Users) ---

app.post('/api/receipts/parse', async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Iniciá sesión para leer comprobantes de transferencia.' });
    return;
  }

  let authorizedUser = false;
  const authProvider = String(req.headers['x-auth-provider'] || '').toLowerCase();
  if (authProvider === 'firebase') {
    authorizedUser = await verifyFirebaseUserToken(token);
  } else {
    authorizedUser = Boolean(verifySessionToken(token));
  }

  if (!authorizedUser) {
    res.status(401).json({ error: 'Sesión inválida o expirada. Volvé a iniciar sesión.' });
    return;
  }

  const imageDataUrl = typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl.trim() : '';
  const dataUrlMatch = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!dataUrlMatch || imageDataUrl.length > 250000) {
    res.status(400).json({
      error: 'Subí una imagen válida (JPG, PNG o WebP) del comprobante de transferencia.',
    });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error:
        'La lectura automática de comprobantes no está configurada en este servidor. Podés completar los datos manualmente y guardar igual el comprobante.',
    });
    return;
  }

  const [, mimeType, base64Data] = dataUrlMatch;

  try {
    const { GoogleGenAI, Type } = await import('@google/genai');
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text:
              'Analizá esta imagen de un comprobante de transferencia bancaria o billetera virtual (en español/Argentina u otro país) y extraé con precisión los datos de pago visibles. Si un campo no aparece claramente legible en la imagen, devolvé una cadena vacía "". No inventes datos que no estén en el comprobante. Para summary, redactá un resumen breve en español (máximo 180 caracteres) indicando si el comprobante parece válido y el estado de la transferencia.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            operationNumber: {
              type: Type.STRING,
              description: 'Número de operación, referencia, COELSA ID o código de comprobante',
            },
            bankName: {
              type: Type.STRING,
              description: 'Banco o billetera virtual emisora (ej. Mercado Pago, Banco Galicia, Brubank, Ualá)',
            },
            amountDetected: {
              type: Type.STRING,
              description: 'Monto transferido tal como figura en el comprobante (ej. $ 45.900,00)',
            },
            payerName: {
              type: Type.STRING,
              description: 'Nombre y apellido o razón social de quien realiza el pago',
            },
            transferDate: {
              type: Type.STRING,
              description: 'Fecha y hora de la transferencia si figura',
            },
            destinationAccount: {
              type: Type.STRING,
              description: 'Destinatario, alias, CBU o CVU destino',
            },
            summary: {
              type: Type.STRING,
              description: 'Resumen breve en español de la lectura del comprobante',
            },
          },
          required: [
            'operationNumber',
            'bankName',
            'amountDetected',
            'payerName',
            'transferDate',
            'destinationAccount',
            'summary',
          ],
        },
      },
    });

    const rawText = response.text?.trim() || '';
    if (!rawText) {
      res.status(502).json({
        error: 'No pudimos interpretar texto legible en la imagen. Verificá que la foto sea nítida.',
      });
      return;
    }

    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    res.json({
      receiptInfo: {
        operationNumber: clampString(String(parsed.operationNumber || ''), 80),
        bankName: clampString(String(parsed.bankName || ''), 80),
        amountDetected: clampString(String(parsed.amountDetected || ''), 40),
        payerName: clampString(String(parsed.payerName || ''), 100),
        transferDate: clampString(String(parsed.transferDate || ''), 60),
        destinationAccount: clampString(String(parsed.destinationAccount || ''), 100),
        summary: clampString(String(parsed.summary || ''), 240),
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    console.error('[receipts/parse] Error al leer comprobante:', detail);
    res.status(502).json({
      error:
        'No pudimos leer automáticamente el comprobante en este momento. El archivo sigue adjunto y podés completar los campos manualmente.',
    });
  }
});

// --- Social Share Card (OpenGraph + Product Photo) for Facebook / WhatsApp ---

interface PublicShareProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: CategoryId;
  categoryLabel: string;
  price: number;
  stock: number;
  freeShipping: boolean;
  imageUrl: string;
  images: string[];
  updatedAt: string;
}

const VALID_SHARE_PRODUCT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const SAFE_HOST_HEADER_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const SOCIAL_CRAWLER_UA_RE =
  /facebookexternalhit|facebot|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|pinterest|embedly/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^fc00:|^fd[0-9a-f]{2}:|^fe80:/i.test(host)
  );
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (!parsed.hostname || isPrivateHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function resolveSharePublicOrigin(req: Request): string {
  const rawForwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const rawHost = rawForwardedHost || String(req.headers.host || '').trim();
  const safeHost = SAFE_HOST_HEADER_RE.test(rawHost) ? rawHost : '';
  const hostnameOnly = safeHost.split(':')[0] || '';

  if (hostnameOnly && isPrivateHostname(hostnameOnly)) {
    const cfPublic = getCloudflarePublicUrl();
    if (cfPublic && isSafePublicHttpUrl(cfPublic)) {
      return cfPublic.replace(/\/+$/, '');
    }
  }

  if (safeHost) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto =
      forwardedProto === 'https' || forwardedProto === 'http'
        ? forwardedProto
        : hostnameOnly && !isPrivateHostname(hostnameOnly)
          ? 'https'
          : req.protocol === 'https'
            ? 'https'
            : 'http';
    return `${proto}://${safeHost}`;
  }

  const envAppUrl = (process.env.APP_URL || '').trim();
  if (envAppUrl && isSafePublicHttpUrl(envAppUrl)) {
    return envAppUrl.replace(/\/+$/, '');
  }

  return `http://localhost:${PORT}`;
}

function resolveSafeStaticImagePath(relPath: string): { filePath: string; mimeType: string } | null {
  const cleanPath = relPath.split('?')[0].split('#')[0].trim();
  if (!cleanPath.startsWith('/') || cleanPath.includes('\0')) return null;

  const trimmedRel = cleanPath.replace(/^\/+/, '');
  const rootDir = process.cwd();
  const allowedBases = [
    path.resolve(rootDir, 'src', 'assets', 'images'),
    path.resolve(rootDir, 'public'),
    path.resolve(rootDir, 'dist'),
  ];

  const candidatePaths = [
    path.resolve(rootDir, trimmedRel),
    path.resolve(rootDir, 'public', trimmedRel),
    path.resolve(rootDir, 'dist', trimmedRel),
  ];

  for (const candidate of candidatePaths) {
    const isAllowed = allowedBases.some((base) => candidate.startsWith(base + path.sep));
    if (!isAllowed) continue;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;

    const ext = path.extname(candidate).toLowerCase();
    const mimeType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : '';
    if (!mimeType) continue;
    return { filePath: candidate, mimeType };
  }

  return null;
}

function decodeBase64ProductImage(
  dataUrl: string,
): { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; buffer: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1] as 'image/jpeg' | 'image/png' | 'image/webp';
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function toPublicShareProduct(p: Product): PublicShareProduct {
  const gallery = getProductGallery(p);
  const category = (p.category in CATEGORY_MAP ? p.category : 'tecnologia') as CategoryId;
  return {
    id: p.id,
    sku: p.sku || '',
    name: p.name || 'Producto Infourqui Mercado',
    description: p.description || '',
    category,
    categoryLabel: p.categoryLabel || CATEGORY_MAP[category]?.label || 'Catálogo',
    price: Number.isFinite(p.price) ? p.price : 0,
    stock: Number.isFinite(p.stock) ? p.stock : 0,
    freeShipping: Boolean(p.freeShipping),
    imageUrl: gallery[0] || getDefaultCategoryImage(category),
    images: gallery.length > 0 ? gallery : [getDefaultCategoryImage(category)],
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : '',
  };
}

function readFirestoreString(fields: Record<string, unknown>, key: string): string {
  const f = fields[key] as { stringValue?: string } | undefined;
  return typeof f?.stringValue === 'string' ? f.stringValue : '';
}

function readFirestoreNumber(fields: Record<string, unknown>, key: string): number {
  const f = fields[key] as { integerValue?: string; doubleValue?: number } | undefined;
  if (typeof f?.doubleValue === 'number' && Number.isFinite(f.doubleValue)) return f.doubleValue;
  if (typeof f?.integerValue === 'string') {
    const parsed = Number(f.integerValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readFirestoreBool(fields: Record<string, unknown>, key: string): boolean {
  const f = fields[key] as { booleanValue?: boolean } | undefined;
  return f?.booleanValue === true;
}

function readFirestoreStringArray(fields: Record<string, unknown>, key: string): string[] {
  const f = fields[key] as { arrayValue?: { values?: Array<{ stringValue?: string }> } } | undefined;
  const vals = f?.arrayValue?.values;
  if (!Array.isArray(vals)) return [];
  return vals
    .map((v) => (typeof v?.stringValue === 'string' ? v.stringValue.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_PRODUCT_IMAGES);
}

async function findPublicShareProductById(productId: string): Promise<PublicShareProduct | null> {
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) return null;

  try {
    const db = loadLocalDb();
    const localMatch = db.products.find((p) => p.id === productId);
    if (localMatch && localMatch.active !== false) {
      return toPublicShareProduct(localMatch);
    }
  } catch {
    // Continue to Firestore fallback
  }

  const fb = getFirebasePublicConfig();
  if (!fb?.projectId || !fb.firestoreDatabaseId) return null;

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      fb.projectId,
    )}/databases/${encodeURIComponent(
      fb.firestoreDatabaseId,
    )}/documents/products/${encodeURIComponent(productId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const doc = (await response.json()) as { fields?: Record<string, unknown> };
      const fields = doc.fields;
      if (!fields || typeof fields !== 'object') return null;
      if (fields.active && !readFirestoreBool(fields, 'active')) return null;

      const rawCategory = readFirestoreString(fields, 'category');
      const category = (rawCategory in CATEGORY_MAP ? rawCategory : 'tecnologia') as CategoryId;
      const imageUrl = readFirestoreString(fields, 'imageUrl');
      const images = readFirestoreStringArray(fields, 'images');
      const gallery = getProductGallery({ imageUrl, images });

      return {
        id: productId,
        sku: readFirestoreString(fields, 'sku'),
        name: readFirestoreString(fields, 'name') || 'Producto Infourqui Mercado',
        description: readFirestoreString(fields, 'description'),
        category,
        categoryLabel:
          readFirestoreString(fields, 'categoryLabel') || CATEGORY_MAP[category]?.label || 'Catálogo',
        price: readFirestoreNumber(fields, 'price'),
        stock: readFirestoreNumber(fields, 'stock'),
        freeShipping: readFirestoreBool(fields, 'freeShipping'),
        imageUrl: gallery[0] || getDefaultCategoryImage(category),
        images: gallery.length > 0 ? gallery : [getDefaultCategoryImage(category)],
        updatedAt: readFirestoreString(fields, 'updatedAt'),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

app.get('/share/producto/:id/imagen', async (req: Request, res: Response) => {
  const productId = String(req.params.id || '').trim();
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) {
    res.status(400).send('Identificador de producto inválido.');
    return;
  }

  const product = await findPublicShareProductById(productId);
  const rawIdx = Number.parseInt(String(req.query.foto ?? req.query.index ?? '0'), 10);
  const photoIndex = Number.isFinite(rawIdx) ? Math.max(0, Math.min(MAX_PRODUCT_IMAGES - 1, rawIdx)) : 0;

  const fallbackRel = getDefaultCategoryImage(product?.category || 'tecnologia');
  const selectedSrc =
    (product && (product.images[photoIndex] || product.imageUrl)) || fallbackRel;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (selectedSrc.startsWith('data:image/')) {
    const decoded = decodeBase64ProductImage(selectedSrc);
    if (decoded) {
      res.setHeader('Content-Type', decoded.mimeType);
      res.send(decoded.buffer);
      return;
    }
  }

  if (selectedSrc.startsWith('/')) {
    const safeFile = resolveSafeStaticImagePath(selectedSrc);
    if (safeFile) {
      res.setHeader('Content-Type', safeFile.mimeType);
      res.sendFile(safeFile.filePath);
      return;
    }
  }

  if (isSafePublicHttpUrl(selectedSrc)) {
    res.redirect(302, selectedSrc);
    return;
  }

  const fallbackFile = resolveSafeStaticImagePath(fallbackRel);
  if (fallbackFile) {
    res.setHeader('Content-Type', fallbackFile.mimeType);
    res.sendFile(fallbackFile.filePath);
    return;
  }

  res.status(404).send('Imagen no disponible.');
});

app.get('/share/producto/:id', async (req: Request, res: Response) => {
  const productId = String(req.params.id || '').trim();
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) {
    res.redirect(302, '/');
    return;
  }

  const rawIdx = Number.parseInt(String(req.query.foto ?? '0'), 10);
  const photoIndex = Number.isFinite(rawIdx) ? Math.max(0, Math.min(MAX_PRODUCT_IMAGES - 1, rawIdx)) : 0;

  const publicOrigin = resolveSharePublicOrigin(req);
  const product = await findPublicShareProductById(productId);
  const destinationUrl = `${publicOrigin}/?producto=${encodeURIComponent(productId)}`;

  if (!product) {
    res.redirect(302, destinationUrl);
    return;
  }

  const clampedIndex = Math.min(photoIndex, Math.max(0, product.images.length - 1));
  const selectedPhoto = product.images[clampedIndex] || product.imageUrl;
  const photoFingerprint = crypto
    .createHash('sha1')
    .update(`${product.updatedAt}|${clampedIndex}|${selectedPhoto.slice(0, 128)}`)
    .digest('hex')
    .slice(0, 10);

  const sharePageUrl = `${publicOrigin}/share/producto/${encodeURIComponent(
    product.id,
  )}?foto=${clampedIndex}`;
  const ogImageUrl = `${publicOrigin}/share/producto/${encodeURIComponent(
    product.id,
  )}/imagen?foto=${clampedIndex}&v=${photoFingerprint}`;

  const titleText = `${product.name} — ${formatCurrency(product.price)} | Infourqui Mercado`;
  const shortDesc = product.description.trim();
  const descriptionParts = [
    shortDesc.length > 140 ? `${shortDesc.slice(0, 137).trimEnd()}...` : shortDesc,
    product.freeShipping ? 'Envío gratis' : '',
    product.stock > 0 ? 'Stock disponible' : 'Consultar stock',
    `SKU ${product.sku}`,
  ].filter(Boolean);
  const descriptionText =
    descriptionParts.join(' · ') || 'Comprá online en Infourqui Mercado.';

  const userAgent = String(req.headers['user-agent'] || '');
  const isSocialCrawler = SOCIAL_CRAWLER_UA_RE.test(userAgent);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    category: product.categoryLabel,
    description: descriptionText,
    image: [ogImageUrl],
    offers: {
      '@type': 'Offer',
      priceCurrency: 'ARS',
      price: String(product.price),
      availability:
        product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: destinationUrl,
    },
  };

  const redirectMeta = isSocialCrawler
    ? ''
    : `<meta http-equiv="refresh" content="0;url=${escapeHtml(destinationUrl)}" />`;

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(titleText)}</title>
    <meta name="description" content="${escapeHtml(descriptionText)}" />
    <link rel="canonical" href="${escapeHtml(sharePageUrl)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="Infourqui Mercado" />
    <meta property="og:locale" content="es_AR" />
    <meta property="og:title" content="${escapeHtml(titleText)}" />
    <meta property="og:description" content="${escapeHtml(descriptionText)}" />
    <meta property="og:url" content="${escapeHtml(sharePageUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    ${ogImageUrl.startsWith('https://') ? `<meta property="og:image:secure_url" content="${escapeHtml(ogImageUrl)}" />` : ''}
    <meta property="og:image:alt" content="${escapeHtml(product.name)}" />
    <meta property="product:price:amount" content="${escapeHtml(String(product.price))}" />
    <meta property="product:price:currency" content="ARS" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(titleText)}" />
    <meta name="twitter:description" content="${escapeHtml(descriptionText)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    ${redirectMeta}
    <script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#fafafa;color:#09090b;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
    <main style="max-width:420px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;text-align:center;">
      <img src="${escapeHtml(ogImageUrl)}" alt="${escapeHtml(product.name)}" style="width:100%;max-height:280px;object-fit:cover;display:block;background:#f4f4f5;" />
      <div style="padding:20px;">
        <p style="margin:0 0 6px;font-size:12px;color:#71717a;">Infourqui Mercado</p>
        <h1 style="margin:0 0 8px;font-size:18px;line-height:1.3;">${escapeHtml(product.name)}</h1>
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1d4ed8;">${escapeHtml(formatCurrency(product.price))}</p>
        <a href="${escapeHtml(destinationUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Ver artículo en la tienda</a>
      </div>
    </main>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).send(html);
});

// --- Frontend Serving (Vite Middleware in Dev / Dist in Prod) ---

async function startServer() {
  loadLocalDb();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: ['.trycloudflare.com', '.local', '.app.github.dev', '.githubpreview.dev'],
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Aplicación no compilada. Ejecutá npm run build.');
      }
    });
  }

  app.listen(PORT, BIND_HOST, () => {
    const lanUrls = getDetectedLanUrls(PORT, BIND_HOST);
    console.log('');
    console.log('====================================================');
    console.log('  Infourqui Mercado — Servidor PC Local y Red (LAN)');
    console.log('====================================================');
    console.log(`  Modo de red : ${NETWORK_MODE === 'local' ? 'Solo esta PC (127.0.0.1)' : 'Red Local LAN (0.0.0.0)'}`);
    console.log(`  Base local  : ${getDbRelativeDisplay()}`);
    console.log(`  URL Local   : http://localhost:${PORT}`);
    if (process.env.CODESPACES === 'true' && process.env.CODESPACE_NAME) {
      const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
      console.log(`  Codespaces  : https://${process.env.CODESPACE_NAME}-${PORT}.${domain}`);
    }
    if (lanUrls.length > 0) {
      for (const url of lanUrls) {
        console.log(`  URL en Red  : ${url}`);
      }
    }
    console.log('====================================================');
    console.log('');

    if (cliModeArg === 'lan') {
      console.log(
        '[Cloudflare] Activando cuenta Cloudflare en Google Chrome para Modo Red Local y Celulares...',
      );
      void activateCloudflareAccountInBrowser(PORT, false)
        .then((cf) => {
          if (cf.phase === 'awaiting_browser_auth' && cf.authUrl) {
            console.log(
              cf.chromeOpened
                ? '[Cloudflare] Google Chrome abierto. Habilita tu cuenta y la direccion web generada aparecera automaticamente.'
                : '[Cloudflare] Abri el enlace en Google Chrome para habilitar tu cuenta Cloudflare.',
            );
          } else if (cf.phase === 'active' && cf.publicUrl) {
            console.log(`[Cloudflare] Direccion web activa: ${cf.publicUrl}`);
          }
        })
        .catch((err) => {
          console.warn(
            '[Cloudflare] Activacion automatica pendiente:',
            err instanceof Error ? err.message : 'Verifica conexion a internet.',
          );
        });
    }
  });
}

void startServer();
