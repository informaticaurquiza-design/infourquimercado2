import { auth } from '../lib/firebase';
import { createCompactThumbnail } from '../lib/imageTools';
import { getDefaultCategoryImage } from '../lib/categoryAssets';
import type {
  AppNotification,
  AppUser,
  CartItem,
  CategoryId,
  CloudflareTunnelStatus,
  DatabaseMode,
  DeliveryMethod,
  LocalBackupSnapshotMeta,
  LocalServerInfo,
  NotificationType,
  Order,
  PaymentMethod,
  PaymentReceipt,
  Product,
  RestoreMode,
  RestoreSummary,
  ShipmentStatus,
  StoreSettings,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  UserProfile,
} from '../types/ecommerce';

// Held strictly in JS memory (never written to localStorage/sessionStorage)
let memoryAuthToken: string | null = null;

export function getLocalAuthToken(): string | null {
  return memoryAuthToken;
}

export function setLocalAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryAuthToken) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Error del servidor local (${response.status}).`;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchLocalServerInfo(): Promise<LocalServerInfo | null> {
  try {
    return await apiRequest<LocalServerInfo>('/api/local/info');
  } catch {
    return null;
  }
}

export interface LocalBootstrapPayload {
  products: Product[];
  orders: Order[];
  notifications: AppNotification[];
  subscriptionPayments: SubscriptionPayment[];
  accounts: UserProfile[];
  shippingSettings: StoreSettings;
  profile: UserProfile | null;
  isAdmin: boolean;
}

export function fetchLocalBootstrap(): Promise<LocalBootstrapPayload> {
  return apiRequest<LocalBootstrapPayload>('/api/local/bootstrap');
}

export interface LocalAuthResponse {
  token: string;
  user: AppUser;
  profile: UserProfile;
  isAdmin: boolean;
}

export async function setupLocalAdmin(input: {
  email: string;
  displayName: string;
  businessName?: string;
  password: string;
}): Promise<LocalAuthResponse> {
  const res = await apiRequest<LocalAuthResponse>('/api/local/auth/setup-admin', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setLocalAuthToken(res.token);
  return res;
}

export async function loginLocalAccount(input: {
  email: string;
  password: string;
}): Promise<LocalAuthResponse> {
  const res = await apiRequest<LocalAuthResponse>('/api/local/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setLocalAuthToken(res.token);
  return res;
}

export async function registerLocalCustomer(input: {
  email: string;
  displayName: string;
  businessName?: string;
  phone?: string;
  bankCbuCvu?: string;
  bankAlias?: string;
  bankAccountHolder?: string;
  password: string;
}): Promise<LocalAuthResponse> {
  const res = await apiRequest<LocalAuthResponse>('/api/local/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setLocalAuthToken(res.token);
  return res;
}

export async function localAdminCreateCustomer(input: {
  email: string;
  displayName: string;
  businessName?: string;
  phone?: string;
  bankCbuCvu?: string;
  bankAlias?: string;
  bankAccountHolder?: string;
  password: string;
}): Promise<UserProfile> {
  const res = await apiRequest<{ account: UserProfile }>('/api/local/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.account;
}

export async function logoutLocalAccount(): Promise<void> {
  try {
    if (memoryAuthToken) {
      await apiRequest<{ ok: boolean }>('/api/local/auth/logout', { method: 'POST' });
    }
  } finally {
    setLocalAuthToken(null);
  }
}

export async function localChangePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const res = await apiRequest<{ ok: boolean; token?: string }>('/api/local/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (res.token) {
    setLocalAuthToken(res.token);
  }
}

export async function localCreateOrUpdateProduct(productInput: {
  id?: string;
  sku: string;
  name: string;
  category: CategoryId;
  description: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  minStockThreshold: number;
  soldCount?: number;
  imageUrl?: string;
  images?: string[];
  specs: string[];
  featured: boolean;
  freeShipping?: boolean;
  active: boolean;
  sellerId?: string;
  sellerName?: string;
  sellerBankAlias?: string;
  sellerBankCbuCvu?: string;
  sellerBankAccountHolder?: string;
}): Promise<void> {
  if (productInput.id) {
    await apiRequest(`/api/local/products/${encodeURIComponent(productInput.id)}`, {
      method: 'PUT',
      body: JSON.stringify(productInput),
    });
  } else {
    await apiRequest('/api/local/products', {
      method: 'POST',
      body: JSON.stringify(productInput),
    });
  }
}

export async function localAdjustProductStock(productId: string, newStock: number): Promise<void> {
  await apiRequest(`/api/local/products/${encodeURIComponent(productId)}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: newStock }),
  });
}

export async function localDeleteProduct(productId: string): Promise<void> {
  await apiRequest(`/api/local/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
}

export async function localCreateOrder(input: {
  cartItems: CartItem[];
  customerName: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPostalCode: string;
  shippingNotes: string;
  deliveryMethod?: DeliveryMethod;
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentBrand: string;
  paymentLast4: string;
  installments: number;
  paymentReceipt?: PaymentReceipt;
}): Promise<Order> {
  const compactItems = await Promise.all(
    input.cartItems.slice(0, 30).map(async (item) => ({
      ...item,
      imageUrl: await createCompactThumbnail(item.imageUrl, getDefaultCategoryImage(item.category)),
    })),
  );
  return apiRequest<Order>('/api/local/orders', {
    method: 'POST',
    body: JSON.stringify({ ...input, cartItems: compactItems }),
  });
}

export async function localLookupOrderByCode(code: string): Promise<Order | null> {
  const res = await apiRequest<{ order: Order | null }>(
    `/api/local/orders/lookup?code=${encodeURIComponent(code)}`,
  );
  return res.order;
}

export async function localAdvanceOrderShipmentStatus(
  orderId: string,
  nextStatus: ShipmentStatus,
  location: string,
  note: string,
): Promise<void> {
  await apiRequest(`/api/local/orders/${encodeURIComponent(orderId)}/advance`, {
    method: 'PATCH',
    body: JSON.stringify({ nextStatus, location, note }),
  });
}

export async function localCancelOrder(orderId: string): Promise<void> {
  await apiRequest(`/api/local/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'PATCH',
  });
}

export async function localSendPushNotification(input: {
  targetUserId: string;
  title: string;
  message: string;
  type: NotificationType;
  orderId?: string;
}): Promise<void> {
  await apiRequest('/api/local/notifications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function localMarkNotificationRead(notificationId: string): Promise<void> {
  await apiRequest(`/api/local/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'PATCH',
  });
}

export async function localDeleteNotification(notificationId: string): Promise<void> {
  await apiRequest(`/api/local/notifications/${encodeURIComponent(notificationId)}`, {
    method: 'DELETE',
  });
}

export async function localUpdateUserProfile(
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'businessName'
      | 'phone'
      | 'defaultAddress'
      | 'defaultCity'
      | 'defaultPostalCode'
      | 'bankCbuCvu'
      | 'bankAlias'
      | 'bankAccountHolder'
      | 'pushEnabled'
    >
  >,
): Promise<{ profile: UserProfile; user: AppUser }> {
  return apiRequest<{ profile: UserProfile; user: AppUser }>('/api/local/profile', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function localSaveShippingSettings(input: {
  freeShippingThreshold: number;
  standardShippingCost: number;
}): Promise<void> {
  await apiRequest('/api/local/settings/shipping', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function localSubmitSubscriptionPayment(input: {
  paymentMethod: SubscriptionPaymentMethod;
  note?: string;
  paymentReceipt?: PaymentReceipt;
}): Promise<SubscriptionPayment> {
  return apiRequest<SubscriptionPayment>('/api/local/subscription-payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function localAdminSetAccountStatus(input: {
  uid: string;
  action: 'activate' | 'deactivate';
  paymentId?: string;
}): Promise<{ ok: boolean; profile: UserProfile }> {
  return apiRequest<{ ok: boolean; profile: UserProfile }>(
    `/api/local/admin/accounts/${encodeURIComponent(input.uid)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: input.action, paymentId: input.paymentId }),
    },
  );
}

export async function localAdminRejectSubscriptionPayment(paymentId: string): Promise<void> {
  await apiRequest(`/api/local/admin/subscription-payments/${encodeURIComponent(paymentId)}/reject`, {
    method: 'PATCH',
  });
}

async function buildAdminAuthHeaders(dbMode: DatabaseMode, withJson = false): Promise<Headers> {
  const headers = new Headers();
  if (withJson) {
    headers.set('Content-Type', 'application/json');
  }
  if (dbMode === 'local') {
    if (!memoryAuthToken) {
      throw new Error('Iniciá sesión como administrador local para realizar esta operación.');
    }
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  } else {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Iniciá sesión con tu cuenta administradora para realizar esta operación.');
    }
    const idToken = await currentUser.getIdToken();
    headers.set('Authorization', `Bearer ${idToken}`);
    headers.set('X-Auth-Provider', 'firebase');
  }
  return headers;
}

export function triggerJsonDownload(jsonContent: string, fileName: string): void {
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadLocalDatabaseBackup(dbMode: DatabaseMode = 'local'): Promise<void> {
  const headers = await buildAdminAuthHeaders(dbMode);
  const response = await fetch('/api/local/backup', { headers });
  if (!response.ok) {
    let message = 'No pudimos generar la copia de seguridad. Verificá tu sesión de administrador.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName =
    match?.[1] || `infourqui-mercado-backup-local-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function restoreLocalDatabaseBackup(
  jsonContent: string,
  dbMode: DatabaseMode = 'local',
  restoreMode: RestoreMode = 'replace',
): Promise<RestoreSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error('El archivo seleccionado no es un JSON válido.');
  }
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch(`/api/local/restore?mode=${encodeURIComponent(restoreMode)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(parsed),
  });
  if (!response.ok) {
    let message = 'No pudimos restaurar la base de datos local.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { ok: boolean; restored: RestoreSummary };
  return data.restored;
}

export async function listServerBackupSnapshots(
  dbMode: DatabaseMode,
): Promise<LocalBackupSnapshotMeta[]> {
  const headers = await buildAdminAuthHeaders(dbMode);
  const response = await fetch('/api/local/backups', { headers });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { backups?: LocalBackupSnapshotMeta[] };
  return Array.isArray(data.backups) ? data.backups : [];
}

export async function createServerBackupSnapshot(
  dbMode: DatabaseMode,
): Promise<LocalBackupSnapshotMeta> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/backups/create', {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (!response.ok) {
    let message = 'No pudimos guardar la copia en el servidor PC.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { snapshot: LocalBackupSnapshotMeta };
  return data.snapshot;
}

export async function downloadServerBackupSnapshot(
  fileName: string,
  dbMode: DatabaseMode,
): Promise<void> {
  const headers = await buildAdminAuthHeaders(dbMode);
  const response = await fetch(`/api/local/backups/${encodeURIComponent(fileName)}`, { headers });
  if (!response.ok) {
    throw new Error('No pudimos descargar la copia de seguridad seleccionada.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function restoreServerBackupSnapshot(
  fileName: string,
  dbMode: DatabaseMode,
  restoreMode: RestoreMode = 'replace',
): Promise<RestoreSummary> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch(`/api/local/backups/${encodeURIComponent(fileName)}/restore`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: restoreMode }),
  });
  if (!response.ok) {
    let message = 'No pudimos restaurar la copia seleccionada.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { ok: boolean; restored: RestoreSummary };
  return data.restored;
}

export async function deleteServerBackupSnapshot(
  fileName: string,
  dbMode: DatabaseMode,
): Promise<void> {
  const headers = await buildAdminAuthHeaders(dbMode);
  const response = await fetch(`/api/local/backups/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    throw new Error('No pudimos eliminar la copia de seguridad.');
  }
}

export async function fetchCloudflareStatus(
  dbMode: DatabaseMode,
): Promise<CloudflareTunnelStatus> {
  const headers = await buildAdminAuthHeaders(dbMode);
  const response = await fetch('/api/local/cloudflare/status', { headers });
  if (!response.ok) {
    let message = 'No pudimos consultar el estado de Cloudflare.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { cloudflare: CloudflareTunnelStatus };
  return data.cloudflare;
}

export async function activateCloudflareAccount(
  dbMode: DatabaseMode,
  forceRelogin = false,
): Promise<CloudflareTunnelStatus> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/cloudflare/activate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ forceRelogin }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    cloudflare?: CloudflareTunnelStatus;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || 'No pudimos activar la cuenta Cloudflare.');
  }
  if (!data.cloudflare) {
    throw new Error('Respuesta incompleta del servidor al activar Cloudflare.');
  }
  return data.cloudflare;
}

export async function startCloudflarePublicTunnel(
  dbMode: DatabaseMode,
): Promise<CloudflareTunnelStatus> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/cloudflare/start-tunnel', {
    method: 'POST',
    headers,
    body: '{}',
  });
  const data = (await response.json().catch(() => ({}))) as {
    cloudflare?: CloudflareTunnelStatus;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || 'No pudimos iniciar el túnel Cloudflare.');
  }
  if (!data.cloudflare) {
    throw new Error('Respuesta incompleta del servidor al iniciar el túnel Cloudflare.');
  }
  return data.cloudflare;
}

export async function stopCloudflarePublicTunnel(
  dbMode: DatabaseMode,
): Promise<CloudflareTunnelStatus> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/cloudflare/stop', {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (!response.ok) {
    throw new Error('No pudimos detener el túnel Cloudflare.');
  }
  const data = (await response.json()) as { cloudflare: CloudflareTunnelStatus };
  return data.cloudflare;
}

export async function openCloudflareInGoogleChrome(
  dbMode: DatabaseMode,
  target: 'auth' | 'public' = 'auth',
): Promise<{ opened: boolean; chromeDetected: boolean; cloudflare: CloudflareTunnelStatus }> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/cloudflare/open-chrome', {
    method: 'POST',
    headers,
    body: JSON.stringify({ target }),
  });
  if (!response.ok) {
    throw new Error('No pudimos abrir el enlace de Cloudflare en Google Chrome.');
  }
  return (await response.json()) as {
    opened: boolean;
    chromeDetected: boolean;
    cloudflare: CloudflareTunnelStatus;
  };
}

export async function openCloudflareInDefaultBrowser(
  dbMode: DatabaseMode,
  target: 'public' | 'auth' = 'public',
): Promise<{ opened: boolean; cloudflare: CloudflareTunnelStatus }> {
  const headers = await buildAdminAuthHeaders(dbMode, true);
  const response = await fetch('/api/local/cloudflare/open-default-browser', {
    method: 'POST',
    headers,
    body: JSON.stringify({ target }),
  });
  if (!response.ok) {
    throw new Error('No pudimos abrir la dirección web en el navegador predeterminado.');
  }
  return (await response.json()) as {
    opened: boolean;
    cloudflare: CloudflareTunnelStatus;
  };
}

export async function downloadPcLocalNetworkApp(
  dbMode: DatabaseMode,
  platform: 'windows' | 'all' = 'windows',
): Promise<void> {
  const headers = new Headers();

  if (dbMode === 'local') {
    if (!memoryAuthToken) {
      throw new Error('Iniciá sesión como administrador local para descargar la aplicación.');
    }
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  } else {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Iniciá sesión con tu cuenta administradora para descargar la aplicación.');
    }
    const idToken = await currentUser.getIdToken();
    headers.set('Authorization', `Bearer ${idToken}`);
    headers.set('X-Auth-Provider', 'firebase');
  }

  const response = await fetch(`/api/local/download-app?platform=${encodeURIComponent(platform)}`, {
    headers,
  });
  if (!response.ok) {
    let message = 'No pudimos generar el paquete descargable para Windows.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    platform === 'windows' ? 'infourqui-mercado-windows.zip' : 'infourqui-mercado-pc-local-red.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ParsedReceiptInfo {
  operationNumber: string;
  bankName: string;
  amountDetected: string;
  payerName: string;
  transferDate: string;
  destinationAccount: string;
  summary: string;
}

export async function parseTransferReceiptImage(
  imageDataUrl: string,
  dbMode: DatabaseMode,
): Promise<ParsedReceiptInfo> {
  const headers = new Headers({ 'Content-Type': 'application/json' });

  if (dbMode === 'local') {
    if (!memoryAuthToken) {
      throw new Error('Iniciá sesión para leer la información del comprobante.');
    }
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  } else {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Iniciá sesión para leer la información del comprobante.');
    }
    const idToken = await currentUser.getIdToken();
    headers.set('Authorization', `Bearer ${idToken}`);
    headers.set('X-Auth-Provider', 'firebase');
  }

  const response = await fetch('/api/receipts/parse', {
    method: 'POST',
    headers,
    body: JSON.stringify({ imageDataUrl }),
  });

  if (!response.ok) {
    let message = 'No pudimos leer automáticamente el comprobante.';
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  const data = (await response.json()) as { receiptInfo: ParsedReceiptInfo };
  return data.receiptInfo;
}


