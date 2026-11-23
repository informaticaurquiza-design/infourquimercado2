import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDefaultCategoryImage } from '../lib/categoryAssets';
import { BOOTSTRAPPED_ADMIN_EMAIL, OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  MAX_PRODUCT_IMAGES,
  createCompactThumbnail,
  isValidImageSource,
} from '../lib/imageTools';
import {
  FREE_SHIPPING_THRESHOLD,
  ID_PATTERN,
  MONTHLY_SUBSCRIPTION_COST,
  ORDER_NUMBER_PATTERN,
  SKU_PATTERN,
  STANDARD_SHIPPING_COST,
  TRACKING_CODE_PATTERN,
  clampString,
  generateOrderNumber,
  generateTrackingCode,
  generateTransactionId,
  validateProductInput,
} from '../lib/validation';
import type {
  AppNotification,
  AppUser,
  CartItem,
  CategoryId,
  DatabaseBackupPayload,
  NotificationType,
  Order,
  PaymentMethod,
  PaymentReceipt,
  PaymentStatus,
  Product,
  RestoreMode,
  RestoreSummary,
  ShipmentStatus,
  StoreSettings,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  TrackingEvent,
  UserProfile,
} from '../types/ecommerce';
import { CATEGORY_MAP, SHIPMENT_PIPELINE } from '../types/ecommerce';

function safeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const isBootstrapped =
      user.emailVerified && user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    const nowIso = new Date().toISOString();
    const profilePayload = {
      uid: user.uid,
      displayName: clampString(user.displayName || 'Cliente Infourqui', 100),
      businessName: '',
      email: clampString(user.email || '', 120),
      photoURL: clampString(user.photoURL || '', 300),
      phone: '',
      defaultAddress: '',
      defaultCity: '',
      defaultPostalCode: '',
      bankCbuCvu: '',
      bankAlias: '',
      bankAccountHolder: '',
      joinedAt: nowIso,
      subscriptionStatus: isBootstrapped ? ('active' as const) : ('trial' as const),
      subscriptionPaidUntil: '',
      lastActivatedAt: isBootstrapped ? nowIso : '',
      pushEnabled: typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted',
      role: isBootstrapped ? ('admin' as const) : ('customer' as const),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profilePayload);
    return {
      ...profilePayload,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
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
  const userPath = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) clean.displayName = clampString(updates.displayName, 100);
    if (updates.businessName !== undefined)
      clean.businessName = clampString(updates.businessName, 120);
    if (updates.phone !== undefined) clean.phone = clampString(updates.phone, 32);
    if (updates.defaultAddress !== undefined)
      clean.defaultAddress = clampString(updates.defaultAddress, 200);
    if (updates.defaultCity !== undefined) clean.defaultCity = clampString(updates.defaultCity, 80);
    if (updates.defaultPostalCode !== undefined)
      clean.defaultPostalCode = clampString(updates.defaultPostalCode, 20);
    if (updates.bankCbuCvu !== undefined)
      clean.bankCbuCvu = clampString(updates.bankCbuCvu, 32);
    if (updates.bankAlias !== undefined)
      clean.bankAlias = clampString(updates.bankAlias, 60);
    if (updates.bankAccountHolder !== undefined)
      clean.bankAccountHolder = clampString(updates.bankAccountHolder, 120);
    if (updates.pushEnabled !== undefined) clean.pushEnabled = Boolean(updates.pushEnabled);
    await updateDoc(ref, clean);

    // Best-effort sync of banking fields to the seller's own products so buyers see up-to-date transfer data
    if (
      updates.bankCbuCvu !== undefined ||
      updates.bankAlias !== undefined ||
      updates.bankAccountHolder !== undefined
    ) {
      try {
        const ownSnap = await getDocs(
          query(collection(db, 'products'), where('sellerId', '==', uid)),
        );
        if (!ownSnap.empty) {
          const batch = writeBatch(db);
          const bankPatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
          if (updates.bankAlias !== undefined) {
            bankPatch.sellerBankAlias = clampString(updates.bankAlias, 60);
          }
          if (updates.bankCbuCvu !== undefined) {
            bankPatch.sellerBankCbuCvu = clampString(updates.bankCbuCvu, 32);
          }
          if (updates.bankAccountHolder !== undefined) {
            bankPatch.sellerBankAccountHolder = clampString(updates.bankAccountHolder, 120);
          }
          ownSnap.docs.forEach((docSnap) => {
            batch.update(docSnap.ref, bankPatch);
          });
          await batch.commit();
        }
      } catch {
        // Ignore if user has no active seller subscription or no products
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function checkIsAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function seedInitialStoreData(_adminUser: User): Promise<boolean> {
  return false;
}

export interface CheckoutOrderInput {
  user: AppUser;
  cartItems: CartItem[];
  customerName: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPostalCode: string;
  shippingNotes: string;
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

function sanitizePaymentReceiptForFirestore(receipt?: PaymentReceipt): PaymentReceipt | undefined {
  if (!receipt) return undefined;
  const imageUrl = receipt.imageUrl.trim();
  if (!imageUrl || !isValidImageSource(imageUrl)) {
    throw new Error(
      'La imagen del comprobante no tiene un formato admitido o supera el tamaño permitido.',
    );
  }
  return {
    imageUrl,
    fileName: clampString(receipt.fileName || 'comprobante.jpg', 120),
    operationNumber: clampString(receipt.operationNumber || '', 80),
    bankName: clampString(receipt.bankName || '', 80),
    amountDetected: clampString(receipt.amountDetected || '', 40),
    payerName: clampString(receipt.payerName || '', 100),
    transferDate: clampString(receipt.transferDate || '', 60),
    destinationAccount: clampString(receipt.destinationAccount || '', 100),
    summary: clampString(receipt.summary || '', 240),
    uploadedAt: clampString(receipt.uploadedAt || new Date().toISOString(), 40),
  };
}

export async function createOrderWithInventoryUpdate(input: CheckoutOrderInput): Promise<Order> {
  const orderId = safeId('ord');
  const notifId = safeId('ntf');
  const orderNumber = generateOrderNumber();
  const trackingCode = generateTrackingCode();
  const txPrefix =
    input.paymentMethod === 'card'
      ? 'PAY'
      : input.paymentMethod === 'wallet'
        ? 'WLT'
        : input.paymentMethod === 'cash'
          ? 'CSH'
          : 'TRF';
  const transactionId = generateTransactionId(txPrefix);
  const nowIso = new Date().toISOString();
  const cleanReceipt =
    input.paymentMethod === 'transfer'
      ? sanitizePaymentReceiptForFirestore(input.paymentReceipt)
      : undefined;

  const paymentStatus: PaymentStatus =
    input.paymentMethod === 'transfer'
      ? 'pending_transfer'
      : input.paymentMethod === 'cash'
        ? 'pending_cash'
        : 'approved';

  const initialEvent: TrackingEvent = {
    status: 'confirmed',
    label: 'Pedido confirmado',
    location: 'Plataforma Infourqui Mercado',
    note:
      input.paymentMethod === 'transfer'
        ? cleanReceipt
          ? `Transferencia registrada con comprobante adjunto${cleanReceipt.operationNumber ? ` (Op. ${cleanReceipt.operationNumber})` : ''}. Reserva de inventario confirmada.`
          : 'Transferencia registrada. Reserva de inventario confirmada.'
        : input.paymentMethod === 'cash'
          ? 'Pago en efectivo al recibir / retirar el pedido. Reserva de inventario confirmada.'
          : `Pago aprobado (${input.paymentBrand}${input.installments > 1 ? ` · ${input.installments} cuotas` : ''}).`,
    timestampIso: nowIso,
  };

  const compactOrderItems = await Promise.all(
    input.cartItems.slice(0, 30).map(async (item) => ({
      productId: item.productId,
      name: clampString(item.name, 120),
      category: item.category,
      price: item.price,
      quantity: item.quantity,
      imageUrl: await createCompactThumbnail(item.imageUrl, getDefaultCategoryImage(item.category)),
    })),
  );

  const orderData = {
    orderNumber,
    trackingCode,
    userId: input.user.uid,
    customerName: clampString(input.customerName, 100),
    customerEmail: clampString(input.user.email || '', 120),
    shippingPhone: clampString(input.shippingPhone, 32),
    shippingAddress: clampString(input.shippingAddress, 200),
    shippingCity: clampString(input.shippingCity, 80),
    shippingPostalCode: clampString(input.shippingPostalCode, 20),
    shippingNotes: clampString(input.shippingNotes || 'Sin indicaciones adicionales', 240),
    items: compactOrderItems,
    subtotal: Math.round(input.subtotal),
    discount: Math.round(input.discount),
    shippingCost: Math.round(input.shippingCost),
    total: Math.round(input.total),
    paymentMethod: input.paymentMethod,
    paymentBrand: clampString(input.paymentBrand, 32),
    paymentLast4: clampString(input.paymentLast4, 4),
    installments: Math.max(1, Math.min(12, Math.round(input.installments))),
    transactionId,
    paymentStatus,
    ...(cleanReceipt ? { paymentReceipt: cleanReceipt } : {}),
    shipmentStatus: 'confirmed' as ShipmentStatus,
    carrier: 'Infourqui Express Logística',
    estimatedDelivery: '3 a 5 días hábiles',
    currentLocation: 'Depósito Central — Reserva confirmada',
    trackingEvents: [initialEvent],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const notificationData = {
    userId: input.user.uid,
    title: `Pedido ${orderNumber} confirmado`,
    message: `Tu compra fue procesada correctamente. Código de seguimiento: ${trackingCode}.`,
    type: 'order' as NotificationType,
    orderId,
    read: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await runTransaction(db, async (transaction) => {
      const productSnapshots: { ref: ReturnType<typeof doc>; currentStock: number; currentSold: number; qty: number; name: string }[] = [];

      for (const item of input.cartItems) {
        const productRef = doc(db, 'products', item.productId);
        const snap = await transaction.get(productRef);
        if (!snap.exists()) {
          throw new Error(`El producto "${item.name}" ya no se encuentra disponible.`);
        }
        const data = snap.data() as Product;
        if (!data.active) {
          throw new Error(`El producto "${data.name}" no está activo para la venta.`);
        }
        if (data.stock < item.quantity) {
          throw new Error(
            `Stock insuficiente para "${data.name}" (disponible: ${data.stock} u.).`,
          );
        }
        productSnapshots.push({
          ref: productRef,
          currentStock: data.stock,
          currentSold: data.soldCount,
          qty: item.quantity,
          name: data.name,
        });
      }

      for (const entry of productSnapshots) {
        transaction.update(entry.ref, {
          stock: entry.currentStock - entry.qty,
          soldCount: entry.currentSold + entry.qty,
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(doc(db, 'orders', orderId), orderData);
      transaction.set(doc(db, 'notifications', notifId), notificationData);
    });

    return {
      id: orderId,
      ...orderData,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Stock insuficiente') || error.message.includes('no se encuentra disponible'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

export async function createOrUpdateProduct(
  productInput: {
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
  },
): Promise<void> {
  const validationError = validateProductInput(productInput);
  if (validationError) {
    throw new Error(validationError);
  }

  const productId = productInput.id || safeId('prod');
  const productPath = `products/${productId}`;
  const ref = doc(db, 'products', productId);
  const categoryDef = CATEGORY_MAP[productInput.category];
  const cleanSpecs = productInput.specs
    .map((s) => clampString(s, 120))
    .filter((s) => s.length > 0)
    .slice(0, 8);

  const rawImages: string[] = [];
  if (Array.isArray(productInput.images)) {
    for (const img of productInput.images) {
      const trimmed = img.trim();
      if (trimmed && !rawImages.includes(trimmed)) {
        rawImages.push(trimmed);
      }
    }
  }
  if (rawImages.length === 0 && productInput.imageUrl?.trim()) {
    rawImages.push(productInput.imageUrl.trim());
  }
  if (rawImages.length === 0) {
    rawImages.push(getDefaultCategoryImage(productInput.category));
  }

  const validImages = rawImages.slice(0, MAX_PRODUCT_IMAGES);
  for (const img of validImages) {
    if (!isValidImageSource(img)) {
      throw new Error(
        'Una de las imágenes tiene un formato no admitido o supera el tamaño permitido. Recortala nuevamente o usá una URL válida (https://).',
      );
    }
  }

  const commonFields: Record<string, unknown> = {
    sku: clampString(productInput.sku.toUpperCase(), 32),
    name: clampString(productInput.name, 120),
    category: productInput.category,
    categoryLabel: clampString(categoryDef.label, 48),
    description: clampString(productInput.description, 800),
    price: Math.round(productInput.price),
    stock: Math.round(productInput.stock),
    minStockThreshold: Math.round(productInput.minStockThreshold),
    imageUrl: validImages[0],
    images: validImages,
    specs: cleanSpecs,
    featured: Boolean(productInput.featured),
    freeShipping: Boolean(productInput.freeShipping),
    active: Boolean(productInput.active),
    updatedAt: serverTimestamp(),
  };

  if (productInput.compareAtPrice && productInput.compareAtPrice > productInput.price) {
    commonFields.compareAtPrice = Math.round(productInput.compareAtPrice);
  }
  if (productInput.sellerBankAlias !== undefined) {
    commonFields.sellerBankAlias = clampString(productInput.sellerBankAlias, 60);
  }
  if (productInput.sellerBankCbuCvu !== undefined) {
    commonFields.sellerBankCbuCvu = clampString(productInput.sellerBankCbuCvu, 32);
  }
  if (productInput.sellerBankAccountHolder !== undefined) {
    commonFields.sellerBankAccountHolder = clampString(productInput.sellerBankAccountHolder, 120);
  }

  try {
    if (productInput.id) {
      await updateDoc(ref, commonFields);
    } else {
      await setDoc(ref, {
        ...commonFields,
        ...(productInput.sellerId ? { sellerId: clampString(productInput.sellerId, 128) } : {}),
        ...(productInput.sellerName
          ? { sellerName: clampString(productInput.sellerName, 120) }
          : {}),
        soldCount: Math.max(0, Math.round(productInput.soldCount ?? 0)),
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, productInput.id ? OperationType.UPDATE : OperationType.CREATE, productPath);
  }
}

export async function adjustProductStock(productId: string, newStock: number): Promise<void> {
  const safeStock = Math.max(0, Math.min(100000, Math.round(newStock)));
  const productPath = `products/${productId}`;
  try {
    await updateDoc(doc(db, 'products', productId), {
      stock: safeStock,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, productPath);
  }
}

export async function deleteProductById(productId: string): Promise<void> {
  const productPath = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, productPath);
  }
}

export async function advanceOrderShipmentStatus(
  order: Order,
  nextStatus: ShipmentStatus,
  location: string,
  note: string,
): Promise<void> {
  const orderPath = `orders/${order.id}`;
  const notifId = safeId('ntf');
  const stageMeta = SHIPMENT_PIPELINE.find((s) => s.status === nextStatus);
  const label = stageMeta ? stageMeta.label : nextStatus === 'cancelled' ? 'Pedido cancelado' : nextStatus;

  const newEvent: TrackingEvent = {
    status: nextStatus,
    label,
    location: clampString(location || order.currentLocation, 120),
    note: clampString(note || stageMeta?.description || 'Actualización de estado logístico.', 200),
    timestampIso: new Date().toISOString(),
  };

  const updatedEvents = [...order.trackingEvents, newEvent].slice(-15);
  const estimatedDelivery =
    nextStatus === 'delivered'
      ? 'Entregado'
      : nextStatus === 'out_for_delivery'
        ? 'Hoy antes de las 20:00 hs'
        : nextStatus === 'in_transit'
          ? 'Mañana antes de las 18:00 hs'
          : order.estimatedDelivery;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      shipmentStatus: nextStatus,
      currentLocation: clampString(location || order.currentLocation, 120),
      estimatedDelivery,
      trackingEvents: updatedEvents,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', notifId), {
      userId: order.userId,
      title: `Envío ${order.orderNumber}: ${label}`,
      message: `${clampString(note || stageMeta?.description || 'Tu envío avanzó de etapa.', 220)} (${clampString(location || order.currentLocation, 80)})`,
      type: 'shipment',
      orderId: order.id,
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, orderPath);
  }
}

export async function cancelCustomerOrder(order: Order): Promise<void> {
  const orderPath = `orders/${order.id}`;
  const cancelEvent: TrackingEvent = {
    status: 'cancelled',
    label: 'Pedido cancelado por el cliente',
    location: 'Plataforma Infourqui Mercado',
    note: 'Cancelación solicitada antes del despacho.',
    timestampIso: new Date().toISOString(),
  };
  try {
    await updateDoc(doc(db, 'orders', order.id), {
      shipmentStatus: 'cancelled',
      trackingEvents: [...order.trackingEvents, cancelEvent].slice(-15),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, orderPath);
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const path = `notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteNotificationById(notificationId: string): Promise<void> {
  const path = `notifications/${notificationId}`;
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function sendAdminPushNotification(input: {
  targetUserId: string;
  title: string;
  message: string;
  type: NotificationType;
  orderId?: string;
}): Promise<void> {
  const notifId = safeId('ntf');
  const path = `notifications/${notifId}`;
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      userId: clampString(input.targetUserId || 'all', 128),
      title: clampString(input.title, 100),
      message: clampString(input.message, 320),
      type: input.type,
      orderId: clampString(input.orderId || '', 128),
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function lookupOrderByCode(code: string, userId: string, isAdmin: boolean): Promise<Order | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const field = clean.startsWith('TRK-') ? 'trackingCode' : 'orderNumber';
  try {
    const constraints = isAdmin
      ? [where(field, '==', clean), limit(1)]
      : [where('userId', '==', userId), where(field, '==', clean), limit(1)];
    const snap = await getDocs(query(collection(db, 'orders'), ...constraints));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...(d.data() as Omit<Order, 'id'>) };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders');
  }
}

export async function saveShippingSettings(
  user: AppUser,
  input: { freeShippingThreshold: number; standardShippingCost: number },
): Promise<void> {
  const freeShippingThreshold = Math.round(input.freeShippingThreshold);
  const standardShippingCost = Math.round(input.standardShippingCost);

  if (
    !Number.isFinite(freeShippingThreshold) ||
    freeShippingThreshold < 0 ||
    freeShippingThreshold > 100000000
  ) {
    throw new Error('El monto mínimo para envío gratis debe estar entre $0 y $100.000.000.');
  }
  if (
    !Number.isFinite(standardShippingCost) ||
    standardShippingCost < 0 ||
    standardShippingCost > 10000000
  ) {
    throw new Error('El costo de envío debe estar entre $0 y $10.000.000.');
  }

  const settingsPath = 'settings/shipping';
  try {
    await setDoc(doc(db, 'settings', 'shipping'), {
      freeShippingThreshold,
      standardShippingCost,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, settingsPath);
  }
}

function serializeFirestoreDate(value: unknown, fallbackIso: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const sec = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  }
  return fallbackIso;
}

export async function exportCloudDatabaseBackup(): Promise<DatabaseBackupPayload> {
  const nowIso = new Date().toISOString();
  try {
    const [productsSnap, ordersSnap, notificationsSnap, shippingSnap] = await Promise.all([
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'notifications')),
      getDoc(doc(db, 'settings', 'shipping')),
    ]);

    const products: Product[] = productsSnap.docs.map((d) => {
      const data = d.data() as Omit<Product, 'id'>;
      return {
        ...data,
        id: d.id,
        createdAt: serializeFirestoreDate(data.createdAt, nowIso),
        updatedAt: serializeFirestoreDate(data.updatedAt, nowIso),
      };
    });

    const orders: Order[] = ordersSnap.docs.map((d) => {
      const data = d.data() as Omit<Order, 'id'>;
      return {
        ...data,
        id: d.id,
        createdAt: serializeFirestoreDate(data.createdAt, nowIso),
        updatedAt: serializeFirestoreDate(data.updatedAt, nowIso),
      };
    });

    const notifications: AppNotification[] = notificationsSnap.docs.map((d) => {
      const data = d.data() as Omit<AppNotification, 'id'>;
      return {
        ...data,
        id: d.id,
        createdAt: serializeFirestoreDate(data.createdAt, nowIso),
        updatedAt: serializeFirestoreDate(data.updatedAt, nowIso),
      };
    });

    const rawShipping = shippingSnap.exists() ? (shippingSnap.data() as StoreSettings) : null;
    const shippingSettings: StoreSettings = {
      freeShippingThreshold:
        typeof rawShipping?.freeShippingThreshold === 'number'
          ? rawShipping.freeShippingThreshold
          : FREE_SHIPPING_THRESHOLD,
      standardShippingCost:
        typeof rawShipping?.standardShippingCost === 'number'
          ? rawShipping.standardShippingCost
          : STANDARD_SHIPPING_COST,
      updatedBy: rawShipping?.updatedBy || 'system',
      updatedAt: serializeFirestoreDate(rawShipping?.updatedAt, nowIso),
    };

    return {
      version: 1,
      exportedAt: nowIso,
      sourceMode: 'cloud',
      products,
      orders,
      notifications,
      shippingSettings,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'backup/cloud');
  }
}

export async function restoreCloudDatabaseBackup(
  rawBackup: unknown,
  adminUser: AppUser,
  mode: RestoreMode = 'replace',
): Promise<RestoreSummary> {
  if (!rawBackup || typeof rawBackup !== 'object') {
    throw new Error('El archivo de respaldo no tiene un formato JSON válido.');
  }

  const body = rawBackup as Record<string, unknown>;
  const hasProducts = Array.isArray(body.products);
  const hasOrders = Array.isArray(body.orders);
  const hasNotifications = Array.isArray(body.notifications);
  const rawSettings = body.shippingSettings as Record<string, unknown> | undefined;
  const hasSettings =
    Boolean(rawSettings) &&
    typeof rawSettings === 'object' &&
    typeof rawSettings.freeShippingThreshold === 'number' &&
    typeof rawSettings.standardShippingCost === 'number';

  if (!hasProducts && !hasOrders && !hasNotifications && !hasSettings) {
    throw new Error('El archivo no contiene datos válidos de Infourqui Mercado para restaurar.');
  }

  const nowIso = new Date().toISOString();

  type BatchOp =
    | { kind: 'delete'; col: 'products' | 'orders' | 'notifications'; id: string }
    | { kind: 'set'; col: 'products' | 'orders' | 'notifications' | 'settings'; id: string; data: Record<string, unknown> };

  const operations: BatchOp[] = [];

  try {
    const [existingProductsSnap, existingOrdersSnap, existingNotifsSnap] = await Promise.all([
      hasProducts ? getDocs(collection(db, 'products')) : Promise.resolve(null),
      hasOrders ? getDocs(collection(db, 'orders')) : Promise.resolve(null),
      hasNotifications ? getDocs(collection(db, 'notifications')) : Promise.resolve(null),
    ]);

    const existingProductCreated = new Map<string, unknown>();
    if (existingProductsSnap) {
      for (const d of existingProductsSnap.docs) {
        existingProductCreated.set(d.id, d.data().createdAt);
        if (mode === 'replace') {
          operations.push({ kind: 'delete', col: 'products', id: d.id });
        }
      }
    }

    const existingOrderMeta = new Map<string, { createdAt: unknown; userId: string }>();
    if (existingOrdersSnap) {
      for (const d of existingOrdersSnap.docs) {
        existingOrderMeta.set(d.id, {
          createdAt: d.data().createdAt,
          userId: String(d.data().userId || adminUser.uid),
        });
        if (mode === 'replace') {
          operations.push({ kind: 'delete', col: 'orders', id: d.id });
        }
      }
    }

    const existingNotifMeta = new Map<string, { createdAt: unknown; userId: string }>();
    if (existingNotifsSnap) {
      for (const d of existingNotifsSnap.docs) {
        existingNotifMeta.set(d.id, {
          createdAt: d.data().createdAt,
          userId: String(d.data().userId || 'all'),
        });
        if (mode === 'replace') {
          operations.push({ kind: 'delete', col: 'notifications', id: d.id });
        }
      }
    }

    let restoredProducts = 0;
    if (Array.isArray(body.products)) {
      for (const raw of body.products.slice(0, 1000)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const cat = String(item.category || '') as CategoryId;
        if (!Object.prototype.hasOwnProperty.call(CATEGORY_MAP, cat)) continue;
        const price = Math.round(Number(item.price));
        if (!Number.isFinite(price) || price <= 0 || price > 100000000) continue;

        const cleanId =
          typeof item.id === 'string' && ID_PATTERN.test(item.id.trim()) && item.id.trim().length <= 128
            ? item.id.trim()
            : safeId('prod');
        const rawSku = clampString(String(item.sku || 'SKU-001').toUpperCase(), 32).replace(
          /[^A-Z0-9-]/g,
          '',
        );
        const sku = rawSku.length >= 3 && SKU_PATTERN.test(rawSku) ? rawSku : `ALB-${Math.floor(100 + Math.random() * 900)}`;
        const name = clampString(String(item.name || 'Producto'), 120);
        const description = clampString(String(item.description || 'Producto restaurado.'), 800);
        if (name.length < 2 || description.length < 5) continue;

        const rawImages: string[] = [];
        if (Array.isArray(item.images)) {
          for (const img of item.images) {
            if (typeof img === 'string' && isValidImageSource(img.trim()) && !rawImages.includes(img.trim())) {
              rawImages.push(img.trim());
            }
          }
        }
        if (rawImages.length === 0 && typeof item.imageUrl === 'string' && isValidImageSource(item.imageUrl.trim())) {
          rawImages.push(item.imageUrl.trim());
        }
        if (rawImages.length === 0) {
          rawImages.push(getDefaultCategoryImage(cat));
        }
        const validImages = rawImages.slice(0, MAX_PRODUCT_IMAGES);
        const specs = Array.isArray(item.specs)
          ? item.specs
              .filter((s): s is string => typeof s === 'string')
              .map((s) => clampString(s, 120))
              .filter(Boolean)
              .slice(0, 8)
          : [];

        const createdAtVal =
          mode === 'merge' && existingProductCreated.has(cleanId)
            ? existingProductCreated.get(cleanId)
            : serverTimestamp();

        const prodDoc: Record<string, unknown> = {
          sku,
          name,
          category: cat,
          categoryLabel: clampString(CATEGORY_MAP[cat].label, 48),
          description,
          price,
          stock: Math.max(0, Math.min(100000, Math.round(Number(item.stock) || 0))),
          minStockThreshold: Math.max(0, Math.min(1000, Math.round(Number(item.minStockThreshold) || 0))),
          soldCount: Math.max(0, Math.min(1000000, Math.round(Number(item.soldCount) || 0))),
          imageUrl: validImages[0],
          images: validImages,
          specs,
          featured: Boolean(item.featured),
          freeShipping: Boolean(item.freeShipping),
          active: item.active !== false,
          createdAt: createdAtVal,
          updatedAt: serverTimestamp(),
        };
        if (typeof item.compareAtPrice === 'number' && item.compareAtPrice > price) {
          prodDoc.compareAtPrice = Math.min(100000000, Math.round(item.compareAtPrice));
        }

        operations.push({ kind: 'set', col: 'products', id: cleanId, data: prodDoc });
        restoredProducts += 1;
      }
    }

    let restoredOrders = 0;
    if (Array.isArray(body.orders)) {
      for (const raw of body.orders.slice(0, 2000)) {
        if (!raw || typeof raw !== 'object') continue;
        const o = raw as Record<string, unknown>;
        const total = Math.round(Number(o.total));
        if (!Number.isFinite(total) || total <= 0 || total > 500000000) continue;

        const cleanId =
          typeof o.id === 'string' && ID_PATTERN.test(o.id.trim()) && o.id.trim().length <= 128
            ? o.id.trim()
            : safeId('ord');
        const orderNumber =
          typeof o.orderNumber === 'string' && ORDER_NUMBER_PATTERN.test(o.orderNumber.trim())
            ? o.orderNumber.trim()
            : generateOrderNumber();
        const trackingCode =
          typeof o.trackingCode === 'string' && TRACKING_CODE_PATTERN.test(o.trackingCode.trim())
            ? o.trackingCode.trim()
            : generateTrackingCode();
        const rawUserId =
          typeof o.userId === 'string' && ID_PATTERN.test(o.userId.trim()) && o.userId.trim().length <= 128
            ? o.userId.trim()
            : adminUser.uid;
        const existingMeta = mode === 'merge' ? existingOrderMeta.get(cleanId) : undefined;
        const finalUserId = existingMeta ? existingMeta.userId : rawUserId;

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

        const rawItems = Array.isArray(o.items) ? o.items.slice(0, 30) : [];
        const items = rawItems
          .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
          .map((i) => {
            const cat = (Object.prototype.hasOwnProperty.call(CATEGORY_MAP, String(i.category))
              ? String(i.category)
              : 'tecnologia') as CategoryId;
            return {
              productId: clampString(String(i.productId || 'prod'), 64),
              name: clampString(String(i.name || 'Producto'), 120),
              category: cat,
              price: Math.max(0, Math.round(Number(i.price) || 0)),
              quantity: Math.max(1, Math.min(1000, Math.round(Number(i.quantity) || 1))),
              imageUrl:
                typeof i.imageUrl === 'string' && isValidImageSource(i.imageUrl)
                  ? i.imageUrl
                  : getDefaultCategoryImage(cat),
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
                  timestampIso: serializeFirestoreDate(e.timestampIso, nowIso),
                }))
            : [
                {
                  status: shipmentStatus,
                  label: 'Pedido restaurado',
                  location: 'Plataforma Infourqui Mercado',
                  note: 'Restaurado desde respaldo JSON.',
                  timestampIso: nowIso,
                },
              ];

        let cleanReceipt: PaymentReceipt | undefined;
        if (o.paymentReceipt && typeof o.paymentReceipt === 'object') {
          try {
            cleanReceipt = sanitizePaymentReceiptForFirestore(o.paymentReceipt as PaymentReceipt);
          } catch {
            cleanReceipt = undefined;
          }
        }

        const customerName = clampString(String(o.customerName || 'Cliente'), 100);
        const customerEmail = clampString(String(o.customerEmail || adminUser.email || 'cliente@local'), 120);
        const shippingPhone = clampString(String(o.shippingPhone || '000000'), 32);
        const shippingAddress = clampString(String(o.shippingAddress || 'Sin dirección'), 200);
        const shippingCity = clampString(String(o.shippingCity || 'Local'), 80);
        const shippingPostalCode = clampString(String(o.shippingPostalCode || '0000'), 20);
        const paymentBrand = clampString(String(o.paymentBrand || 'Pago'), 32) || 'Pago';
        const txIdRaw = clampString(String(o.transactionId || generateTransactionId('RST')), 40);

        const orderDoc: Record<string, unknown> = {
          orderNumber,
          trackingCode,
          userId: finalUserId,
          customerName: customerName.length >= 2 ? customerName : 'Cliente',
          customerEmail: customerEmail.length >= 3 ? customerEmail : 'cliente@local',
          shippingPhone: shippingPhone.length >= 6 ? shippingPhone : '000000',
          shippingAddress: shippingAddress.length >= 4 ? shippingAddress : 'Domicilio registrado',
          shippingCity: shippingCity.length >= 2 ? shippingCity : 'Ciudad',
          shippingPostalCode: shippingPostalCode.length >= 3 ? shippingPostalCode : '0000',
          shippingNotes: clampString(String(o.shippingNotes || ''), 240),
          items,
          subtotal: Math.max(0, Math.min(500000000, Math.round(Number(o.subtotal) || total))),
          discount: Math.max(0, Math.min(500000000, Math.round(Number(o.discount) || 0))),
          shippingCost: Math.max(0, Math.min(10000000, Math.round(Number(o.shippingCost) || 0))),
          total,
          paymentMethod,
          paymentBrand,
          paymentLast4: clampString(String(o.paymentLast4 || ''), 4),
          installments: Math.max(1, Math.min(12, Math.round(Number(o.installments) || 1))),
          transactionId: txIdRaw.length >= 4 ? txIdRaw : generateTransactionId('RST'),
          paymentStatus,
          ...(cleanReceipt ? { paymentReceipt: cleanReceipt } : {}),
          shipmentStatus,
          carrier: clampString(String(o.carrier || 'Infourqui Express Logística'), 60) || 'Infourqui Express',
          estimatedDelivery: clampString(String(o.estimatedDelivery || '3 a 5 días hábiles'), 40) || '3 a 5 días',
          currentLocation: clampString(String(o.currentLocation || 'Depósito Central'), 120) || 'Depósito',
          trackingEvents,
          createdAt: existingMeta ? existingMeta.createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        operations.push({ kind: 'set', col: 'orders', id: cleanId, data: orderDoc });
        restoredOrders += 1;
      }
    }

    let restoredNotifications = 0;
    if (Array.isArray(body.notifications)) {
      for (const raw of body.notifications.slice(0, 1000)) {
        if (!raw || typeof raw !== 'object') continue;
        const n = raw as Record<string, unknown>;
        const title = clampString(String(n.title || ''), 100);
        const message = clampString(String(n.message || ''), 320);
        if (title.length < 2 || message.length < 2) continue;

        const cleanId =
          typeof n.id === 'string' && ID_PATTERN.test(n.id.trim()) && n.id.trim().length <= 128
            ? n.id.trim()
            : safeId('ntf');
        const rawUserId =
          typeof n.userId === 'string' && ID_PATTERN.test(n.userId.trim()) && n.userId.trim().length <= 128
            ? n.userId.trim()
            : 'all';
        const existingMeta = mode === 'merge' ? existingNotifMeta.get(cleanId) : undefined;
        const typeRaw = String(n.type || 'order') as NotificationType;
        const type: NotificationType = ['order', 'shipment', 'promo', 'inventory'].includes(typeRaw)
          ? typeRaw
          : 'order';

        operations.push({
          kind: 'set',
          col: 'notifications',
          id: cleanId,
          data: {
            userId: existingMeta ? existingMeta.userId : rawUserId,
            title,
            message,
            type,
            orderId: clampString(String(n.orderId || ''), 128),
            read: Boolean(n.read),
            createdAt: existingMeta ? existingMeta.createdAt : serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
        restoredNotifications += 1;
      }
    }

    if (hasSettings && rawSettings) {
      operations.push({
        kind: 'set',
        col: 'settings',
        id: 'shipping',
        data: {
          freeShippingThreshold: Math.max(
            0,
            Math.min(100000000, Math.round(Number(rawSettings.freeShippingThreshold))),
          ),
          standardShippingCost: Math.max(
            0,
            Math.min(10000000, Math.round(Number(rawSettings.standardShippingCost))),
          ),
          updatedBy: adminUser.uid,
          updatedAt: serverTimestamp(),
        },
      });
    }

    // Commit operations in batches of 400 (Firestore limit is 500 per batch)
    const BATCH_LIMIT = 400;
    for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
      const chunk = operations.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const ref = doc(db, op.col, op.id);
        if (op.kind === 'delete') {
          batch.delete(ref);
        } else {
          batch.set(ref, op.data);
        }
      }
      await batch.commit();
    }

    return {
      products: restoredProducts,
      orders: restoredOrders,
      notifications: restoredNotifications,
      shippingSettings: hasSettings,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'restore/cloud');
  }
}

export async function submitCloudSubscriptionPayment(input: {
  user: AppUser;
  profile: UserProfile | null;
  paymentMethod: SubscriptionPaymentMethod;
  note?: string;
  paymentReceipt?: PaymentReceipt;
}): Promise<SubscriptionPayment> {
  const paymentId = safeId('sub');
  const path = `subscriptionPayments/${paymentId}`;
  const nowIso = new Date().toISOString();

  const cleanReceipt =
    input.paymentMethod === 'transfer'
      ? sanitizePaymentReceiptForFirestore(input.paymentReceipt)
      : undefined;

  if (input.paymentMethod === 'transfer' && !cleanReceipt) {
    throw new Error('Adjuntá la imagen del comprobante de transferencia.');
  }

  const userName = clampString(
    input.profile?.displayName || input.user.displayName || input.user.email || 'Cliente',
    100,
  );
  const userEmail = clampString(input.profile?.email || input.user.email || 'cliente@infourqui', 120);
  const businessName = clampString(input.profile?.businessName || '', 120);
  const note = clampString(input.note || '', 240);

  const payload = {
    userId: input.user.uid,
    userName: userName.length >= 1 ? userName : 'Cliente',
    businessName,
    userEmail: userEmail.length >= 3 ? userEmail : 'cliente@infourqui',
    amount: MONTHLY_SUBSCRIPTION_COST,
    paymentMethod: input.paymentMethod,
    note,
    ...(cleanReceipt ? { paymentReceipt: cleanReceipt } : {}),
    status: 'pending' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'subscriptionPayments', paymentId), payload);
    return {
      id: paymentId,
      userId: payload.userId,
      userName: payload.userName,
      businessName: payload.businessName,
      userEmail: payload.userEmail,
      amount: payload.amount,
      paymentMethod: payload.paymentMethod,
      note: payload.note,
      ...(cleanReceipt ? { paymentReceipt: cleanReceipt } : {}),
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminSetCloudAccountStatus(input: {
  targetUser: UserProfile;
  action: 'activate' | 'deactivate';
  adminUser: AppUser;
  paymentId?: string;
  allPayments: SubscriptionPayment[];
  allProducts: Product[];
}): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const notifId = safeId('ntf');
  const userRef = doc(db, 'users', input.targetUser.uid);

  try {
    const batch = writeBatch(db);
    if (input.action === 'activate') {
      const existingPaidMs = input.targetUser.subscriptionPaidUntil
        ? new Date(input.targetUser.subscriptionPaidUntil).getTime()
        : 0;
      const baseMs = Number.isFinite(existingPaidMs) && existingPaidMs > now ? existingPaidMs : now;
      const nextPaidUntilIso = new Date(baseMs + 30 * 24 * 60 * 60 * 1000).toISOString();

      batch.update(userRef, {
        subscriptionStatus: 'active',
        subscriptionPaidUntil: nextPaidUntilIso,
        lastActivatedAt: nowIso,
        updatedAt: serverTimestamp(),
      });

      const paymentsToApprove = input.allPayments.filter(
        (p) =>
          p.userId === input.targetUser.uid &&
          (input.paymentId ? p.id === input.paymentId : p.status === 'pending'),
      );
      for (const p of paymentsToApprove) {
        batch.update(doc(db, 'subscriptionPayments', p.id), {
          status: 'approved',
          reviewedBy: clampString(input.adminUser.email || input.adminUser.uid, 128),
          reviewedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      }

      const sellerProducts = input.allProducts.filter((p) => p.sellerId === input.targetUser.uid);
      for (const prod of sellerProducts) {
        batch.update(doc(db, 'products', prod.id), {
          active: true,
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(doc(db, 'notifications', notifId), {
        userId: input.targetUser.uid,
        title: 'Cuenta de vendedor activada',
        message:
          'Tu pago mensual fue verificado. Tu cuenta y tus publicaciones de venta quedaron activas por 30 días.',
        type: 'order',
        orderId: '',
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(userRef, {
        subscriptionStatus: 'inactive',
        updatedAt: serverTimestamp(),
      });

      const sellerProducts = input.allProducts.filter((p) => p.sellerId === input.targetUser.uid);
      for (const prod of sellerProducts) {
        batch.update(doc(db, 'products', prod.id), {
          active: false,
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(doc(db, 'notifications', notifId), {
        userId: input.targetUser.uid,
        title: 'Publicaciones pausadas',
        message:
          'Tu cuenta pasó a estado inactivo. Registrá tu pago mensual de $ 5.000 desde el Panel de control para reactivar tus publicaciones.',
        type: 'inventory',
        orderId: '',
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${input.targetUser.uid}`);
  }
}

export async function adminRejectCloudSubscriptionPayment(
  payment: SubscriptionPayment,
  adminUser: AppUser,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const notifId = safeId('ntf');
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'subscriptionPayments', payment.id), {
      status: 'rejected',
      reviewedBy: clampString(adminUser.email || adminUser.uid, 128),
      reviewedAt: nowIso,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', notifId), {
      userId: payment.userId,
      title: 'Comprobante de abono rechazado',
      message:
        'No pudimos validar tu comprobante de pago mensual ($ 5.000). Por favor volvé a cargar un comprobante legible desde el Panel de control.',
      type: 'order',
      orderId: '',
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `subscriptionPayments/${payment.id}`);
  }
}


