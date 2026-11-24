import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import type {
  AppUser,
  AssignedCourier,
  CartItem,
  CategoryId,
  DatabaseMode,
  DeliveryAgent,
  DeliveryMethod,
  DeliveryVehicleType,
  NotificationType,
  Order,
  PaymentMethod,
  PaymentReceipt,
  Product,
  ShipmentStatus,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  UserProfile,
} from '../types/ecommerce';
import {
  adjustProductStock as cloudAdjustProductStock,
  adminRejectCloudSubscriptionPayment,
  adminSetCloudAccountStatus,
  advanceOrderShipmentStatus as cloudAdvanceOrderShipmentStatus,
  cancelCustomerOrder as cloudCancelCustomerOrder,
  createOrUpdateDeliveryAgent as cloudCreateOrUpdateDeliveryAgent,
  createOrUpdateProduct as cloudCreateOrUpdateProduct,
  createOrderWithInventoryUpdate as cloudCreateOrderWithInventoryUpdate,
  deleteDeliveryAgentById as cloudDeleteDeliveryAgentById,
  deleteNotificationById as cloudDeleteNotificationById,
  deleteProductById as cloudDeleteProductById,
  lookupOrderByCode as cloudLookupOrderByCode,
  markNotificationRead as cloudMarkNotificationRead,
  revertOrderShipmentStatus as cloudRevertOrderShipmentStatus,
  saveShippingSettings as cloudSaveShippingSettings,
  sendAdminPushNotification as cloudSendAdminPushNotification,
  submitCloudSubscriptionPayment,
  updateUserProfile as cloudUpdateUserProfile,
} from './firestoreService';
import {
  localAdjustProductStock,
  localAdminRejectSubscriptionPayment,
  localAdminSetAccountStatus,
  localAdvanceOrderShipmentStatus,
  localCancelOrder,
  localChangePassword,
  localCreateOrUpdateDeliveryAgent,
  localCreateOrUpdateProduct,
  localCreateOrder,
  localDeleteDeliveryAgent,
  localDeleteNotification,
  localDeleteProduct,
  localLookupOrderByCode,
  localMarkNotificationRead,
  localRevertOrderShipmentStatus,
  localSaveShippingSettings,
  localSendPushNotification,
  localSubmitSubscriptionPayment,
  localUpdateUserProfile,
  parseTransferReceiptImage,
  type ParsedReceiptInfo,
} from './localApiService';

let currentDbMode: DatabaseMode = 'cloud';
let onLocalProfileUpdated: ((payload: { profile: UserProfile; user: AppUser }) => void) | null = null;

export function setActiveDatabaseMode(mode: DatabaseMode): void {
  currentDbMode = mode;
}

export function getActiveDatabaseMode(): DatabaseMode {
  return currentDbMode;
}

export function registerLocalProfileSyncCallback(
  cb: ((payload: { profile: UserProfile; user: AppUser }) => void) | null,
): void {
  onLocalProfileUpdated = cb;
}

export interface UnifiedCheckoutOrderInput {
  user: AppUser;
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
}

export async function updateUserProfile(
  uid: string,
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
): Promise<void> {
  if (currentDbMode === 'local') {
    const updated = await localUpdateUserProfile(updates);
    onLocalProfileUpdated?.(updated);
    return;
  }
  await cloudUpdateUserProfile(uid, updates);
}

export function canCurrentCloudUserChangePassword(): boolean {
  const currentUser = auth.currentUser;
  if (!currentUser) return false;
  return currentUser.providerData.some((p) => p.providerId === 'password');
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (currentDbMode === 'local') {
    await localChangePassword({ currentPassword, newPassword });
    return;
  }

  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('Iniciá sesión nuevamente para cambiar tu contraseña.');
  }

  const hasPasswordProvider = currentUser.providerData.some((p) => p.providerId === 'password');
  if (!hasPasswordProvider) {
    throw new Error(
      'Esta cuenta ingresó con Google. Para cambiar la contraseña, administrá tu clave directamente desde tu cuenta de Google.',
    );
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('La contraseña actual es incorrecta.');
    }
    if (code === 'auth/weak-password') {
      throw new Error('La nueva contraseña es demasiado débil. Usá al menos 8 caracteres.');
    }
    if (code === 'auth/requires-recent-login') {
      throw new Error('Por seguridad, cerrá sesión e ingresá nuevamente antes de cambiar la contraseña.');
    }
    throw new Error(
      err instanceof Error ? err.message : 'No pudimos actualizar la contraseña.',
    );
  }
}

export async function createOrderWithInventoryUpdate(
  input: UnifiedCheckoutOrderInput,
): Promise<Order> {
  if (currentDbMode === 'local') {
    return localCreateOrder(input);
  }
  return cloudCreateOrderWithInventoryUpdate(input);
}

export async function createOrUpdateProduct(productInput: {
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
  if (currentDbMode === 'local') {
    await localCreateOrUpdateProduct(productInput);
    return;
  }
  await cloudCreateOrUpdateProduct(productInput);
}

export async function adjustProductStock(productId: string, newStock: number): Promise<void> {
  if (currentDbMode === 'local') {
    await localAdjustProductStock(productId, newStock);
    return;
  }
  await cloudAdjustProductStock(productId, newStock);
}

export async function deleteProductById(productId: string): Promise<void> {
  if (currentDbMode === 'local') {
    await localDeleteProduct(productId);
    return;
  }
  await cloudDeleteProductById(productId);
}

export async function advanceOrderShipmentStatus(
  order: Order,
  nextStatus: ShipmentStatus,
  location: string,
  note: string,
  assignedCourier?: AssignedCourier,
): Promise<void> {
  if (currentDbMode === 'local') {
    await localAdvanceOrderShipmentStatus(
      order.id,
      nextStatus,
      location,
      note,
      assignedCourier,
    );
    return;
  }
  await cloudAdvanceOrderShipmentStatus(order, nextStatus, location, note, assignedCourier);
}

export async function revertOrderShipmentStatus(order: Order): Promise<void> {
  if (currentDbMode === 'local') {
    await localRevertOrderShipmentStatus(order.id);
    return;
  }
  await cloudRevertOrderShipmentStatus(order);
}

export async function createOrUpdateDeliveryAgent(input: {
  id?: string;
  vehicleType: DeliveryVehicleType;
  licensePlate: string;
  fullName: string;
  active: boolean;
}): Promise<DeliveryAgent> {
  if (currentDbMode === 'local') {
    return localCreateOrUpdateDeliveryAgent(input);
  }
  return cloudCreateOrUpdateDeliveryAgent(input);
}

export async function deleteDeliveryAgentById(agentId: string): Promise<void> {
  if (currentDbMode === 'local') {
    await localDeleteDeliveryAgent(agentId);
    return;
  }
  await cloudDeleteDeliveryAgentById(agentId);
}

export async function cancelCustomerOrder(order: Order): Promise<void> {
  if (currentDbMode === 'local') {
    await localCancelOrder(order.id);
    return;
  }
  await cloudCancelCustomerOrder(order);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (currentDbMode === 'local') {
    await localMarkNotificationRead(notificationId);
    return;
  }
  await cloudMarkNotificationRead(notificationId);
}

export async function deleteNotificationById(notificationId: string): Promise<void> {
  if (currentDbMode === 'local') {
    await localDeleteNotification(notificationId);
    return;
  }
  await cloudDeleteNotificationById(notificationId);
}

export async function sendAdminPushNotification(input: {
  targetUserId: string;
  title: string;
  message: string;
  type: NotificationType;
  orderId?: string;
}): Promise<void> {
  if (currentDbMode === 'local') {
    await localSendPushNotification(input);
    return;
  }
  await cloudSendAdminPushNotification(input);
}

export async function lookupOrderByCode(
  code: string,
  userId: string,
  isAdmin: boolean,
): Promise<Order | null> {
  if (currentDbMode === 'local') {
    return localLookupOrderByCode(code);
  }
  return cloudLookupOrderByCode(code, userId, isAdmin);
}

export async function saveShippingSettings(
  user: AppUser,
  input: { freeShippingThreshold: number; standardShippingCost: number },
): Promise<void> {
  if (currentDbMode === 'local') {
    await localSaveShippingSettings(input);
    return;
  }
  await cloudSaveShippingSettings(user, input);
}

export type { ParsedReceiptInfo };

export async function parseTransferReceipt(imageDataUrl: string): Promise<ParsedReceiptInfo> {
  return parseTransferReceiptImage(imageDataUrl, currentDbMode);
}

export async function submitSubscriptionPayment(input: {
  user: AppUser;
  profile: UserProfile | null;
  paymentMethod: SubscriptionPaymentMethod;
  note?: string;
  paymentReceipt?: PaymentReceipt;
}): Promise<SubscriptionPayment> {
  if (currentDbMode === 'local') {
    return localSubmitSubscriptionPayment({
      paymentMethod: input.paymentMethod,
      note: input.note,
      paymentReceipt: input.paymentReceipt,
    });
  }
  return submitCloudSubscriptionPayment(input);
}

export async function adminSetAccountStatus(input: {
  targetUser: UserProfile;
  action: 'activate' | 'deactivate';
  adminUser: AppUser;
  paymentId?: string;
  allPayments: SubscriptionPayment[];
  allProducts: Product[];
}): Promise<void> {
  if (currentDbMode === 'local') {
    await localAdminSetAccountStatus({
      uid: input.targetUser.uid,
      action: input.action,
      paymentId: input.paymentId,
    });
    return;
  }
  await adminSetCloudAccountStatus(input);
}

export async function adminRejectSubscriptionPayment(
  payment: SubscriptionPayment,
  adminUser: AppUser,
): Promise<void> {
  if (currentDbMode === 'local') {
    await localAdminRejectSubscriptionPayment(payment.id);
    return;
  }
  await adminRejectCloudSubscriptionPayment(payment, adminUser);
}


