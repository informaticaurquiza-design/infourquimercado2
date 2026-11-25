import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import type {
  AppUser,
  AssignedCourier,
  BenefitType,
  CartItem,
  CategoryDefinition,
  CategoryId,
  CustomerBenefit,
  DeliveryAgent,
  DeliveryMethod,
  DeliveryVehicleType,
  NotificationType,
  Order,
  PaymentMethod,
  PaymentReceipt,
  Product,
  ProductCondition,
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
  createOrUpdateBenefit as cloudCreateOrUpdateBenefit,
  createOrUpdateCategory as cloudCreateOrUpdateCategory,
  createOrUpdateDeliveryAgent as cloudCreateOrUpdateDeliveryAgent,
  createOrUpdateProduct as cloudCreateOrUpdateProduct,
  createOrderWithInventoryUpdate as cloudCreateOrderWithInventoryUpdate,
  deleteBenefitById as cloudDeleteBenefitById,
  deleteCategoryById as cloudDeleteCategoryById,
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

export interface ParsedReceiptInfo {
  operationNumber: string;
  bankName: string;
  amountDetected: string;
  payerName: string;
  transferDate: string;
  destinationAccount: string;
  summary: string;
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
      throw new Error(
        'Por seguridad, cerrá sesión e ingresá nuevamente antes de cambiar la contraseña.',
      );
    }
    throw new Error(
      err instanceof Error ? err.message : 'No pudimos actualizar la contraseña.',
    );
  }
}

export async function createOrderWithInventoryUpdate(
  input: UnifiedCheckoutOrderInput,
): Promise<Order> {
  return cloudCreateOrderWithInventoryUpdate(input);
}

export async function createOrUpdateProduct(productInput: {
  id?: string;
  sku: string;
  name: string;
  category: CategoryId;
  categoryLabel?: string;
  condition?: ProductCondition;
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
  benefitId?: string;
  benefitEnabled?: boolean;
  active: boolean;
  sellerId?: string;
  sellerName?: string;
  sellerBankAlias?: string;
  sellerBankCbuCvu?: string;
  sellerBankAccountHolder?: string;
}): Promise<void> {
  await cloudCreateOrUpdateProduct(productInput);
}

export async function adjustProductStock(productId: string, newStock: number): Promise<void> {
  await cloudAdjustProductStock(productId, newStock);
}

export async function deleteProductById(productId: string): Promise<void> {
  await cloudDeleteProductById(productId);
}

export async function advanceOrderShipmentStatus(
  order: Order,
  nextStatus: ShipmentStatus,
  location: string,
  note: string,
  assignedCourier?: AssignedCourier,
): Promise<void> {
  await cloudAdvanceOrderShipmentStatus(order, nextStatus, location, note, assignedCourier);
}

export async function revertOrderShipmentStatus(order: Order): Promise<void> {
  await cloudRevertOrderShipmentStatus(order);
}

export async function createOrUpdateDeliveryAgent(input: {
  id?: string;
  vehicleType: DeliveryVehicleType;
  licensePlate: string;
  fullName: string;
  active: boolean;
}): Promise<DeliveryAgent> {
  return cloudCreateOrUpdateDeliveryAgent(input);
}

export async function deleteDeliveryAgentById(agentId: string): Promise<void> {
  await cloudDeleteDeliveryAgentById(agentId);
}

export async function createOrUpdateBenefit(input: {
  id?: string;
  title: string;
  description: string;
  type: BenefitType;
  targetUserId: string;
  targetUserName: string;
  promoCode: string;
  discountPercent: number;
  minOrderAmount: number;
  maxInstallments: number;
  expiresAt?: string;
  active: boolean;
}): Promise<CustomerBenefit> {
  return cloudCreateOrUpdateBenefit(input);
}

export async function deleteBenefitById(benefitId: string): Promise<void> {
  await cloudDeleteBenefitById(benefitId);
}

export async function createOrUpdateCategory(input: {
  id?: string;
  isEditing?: boolean;
  label: string;
  shortLabel: string;
  description: string;
  active: boolean;
  sortOrder: number;
}): Promise<CategoryDefinition> {
  return cloudCreateOrUpdateCategory(input);
}

export async function deleteCategoryById(categoryId: string): Promise<void> {
  await cloudDeleteCategoryById(categoryId);
}

export async function cancelCustomerOrder(order: Order): Promise<void> {
  await cloudCancelCustomerOrder(order);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await cloudMarkNotificationRead(notificationId);
}

export async function deleteNotificationById(notificationId: string): Promise<void> {
  await cloudDeleteNotificationById(notificationId);
}

export async function sendAdminPushNotification(input: {
  targetUserId: string;
  title: string;
  message: string;
  type: NotificationType;
  orderId?: string;
}): Promise<void> {
  await cloudSendAdminPushNotification(input);
}

export async function lookupOrderByCode(
  code: string,
  userId: string,
  isAdmin: boolean,
): Promise<Order | null> {
  return cloudLookupOrderByCode(code, userId, isAdmin);
}

export async function saveShippingSettings(
  user: AppUser,
  input: { freeShippingThreshold: number; standardShippingCost: number },
): Promise<void> {
  await cloudSaveShippingSettings(user, input);
}

export async function parseTransferReceipt(imageDataUrl: string): Promise<ParsedReceiptInfo> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Iniciá sesión para leer la información del comprobante.');
  }
  const idToken = await currentUser.getIdToken();

  const response = await fetch('/api/receipts/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'X-Auth-Provider': 'firebase',
    },
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

export async function submitSubscriptionPayment(input: {
  user: AppUser;
  profile: UserProfile | null;
  paymentMethod: SubscriptionPaymentMethod;
  note?: string;
  paymentReceipt?: PaymentReceipt;
}): Promise<SubscriptionPayment> {
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
  await adminSetCloudAccountStatus(input);
}

export async function adminRejectSubscriptionPayment(
  payment: SubscriptionPayment,
  adminUser: AppUser,
): Promise<void> {
  await adminRejectCloudSubscriptionPayment(payment, adminUser);
}
