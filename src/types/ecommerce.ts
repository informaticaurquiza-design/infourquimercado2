import type { Timestamp } from 'firebase/firestore';

export type CategoryId =
  | 'tecnologia'
  | 'hogar'
  | 'indumentaria'
  | 'relojeria'
  | 'deportes'
  | 'gourmet';

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  shortLabel: string;
  description: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'tecnologia',
    label: 'Tecnología & Audio',
    shortLabel: 'Tecnología',
    description: 'Auriculares de estudio, parlantes y periféricos de precisión.',
  },
  {
    id: 'hogar',
    label: 'Hogar & Diseño',
    shortLabel: 'Hogar',
    description: 'Iluminación arquitectónica y objetos funcionales para espacios modernos.',
  },
  {
    id: 'indumentaria',
    label: 'Indumentaria Urbana',
    shortLabel: 'Indumentaria',
    description: 'Prendas técnicas impermeables y básicos de sastrería contemporánea.',
  },
  {
    id: 'relojeria',
    label: 'Relojería & Accesorios',
    shortLabel: 'Relojería',
    description: 'Cronógrafos automáticos, marroquinería y piezas de acero cepillado.',
  },
  {
    id: 'deportes',
    label: 'Deportes & Outdoor',
    shortLabel: 'Deportes',
    description: 'Mochilas técnicas, equipamiento urbano y accesorios de expedición.',
  },
  {
    id: 'gourmet',
    label: 'Café & Gourmet',
    shortLabel: 'Gourmet',
    description: 'Pavas de cuello de cisne, métodos de filtrado y selección barista.',
  },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryDefinition> = CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<CategoryId, CategoryDefinition>,
);

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: CategoryId;
  categoryLabel: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  minStockThreshold: number;
  soldCount: number;
  imageUrl: string;
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
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  category: CategoryId;
  categoryLabel: string;
  price: number;
  quantity: number;
  imageUrl: string;
  maxStock: number;
  freeShipping?: boolean;
  sellerId?: string;
  sellerName?: string;
  sellerBankAlias?: string;
  sellerBankCbuCvu?: string;
  sellerBankAccountHolder?: string;
}

export type DeliveryMethod = 'delivery' | 'pickup';
export type DeliveryVehicleType = 'moto' | 'auto' | 'utilitario';

export const DELIVERY_VEHICLE_OPTIONS: {
  value: DeliveryVehicleType;
  label: string;
}[] = [
  { value: 'moto', label: 'Moto' },
  { value: 'auto', label: 'Auto' },
  { value: 'utilitario', label: 'Utilitario' },
];

export interface DeliveryAgent {
  id: string;
  ownerId?: string;
  vehicleType: DeliveryVehicleType;
  licensePlate: string;
  fullName: string;
  active: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface AssignedCourier {
  agentId: string;
  fullName: string;
  vehicleType: DeliveryVehicleType;
  licensePlate: string;
}

export type BenefitType = 'installments' | 'promo_code' | 'min_amount_discount';

export const BENEFIT_TYPE_OPTIONS: {
  value: BenefitType;
  label: string;
  description: string;
}[] = [
  {
    value: 'installments',
    label: 'Cuotas sin interés',
    description: 'Define la cantidad máxima de cuotas sin interés habilitadas.',
  },
  {
    value: 'promo_code',
    label: 'Código de descuento',
    description: 'Cupón promocional con un porcentaje de descuento al ingresarlo.',
  },
  {
    value: 'min_amount_discount',
    label: 'Descuento por monto',
    description: 'Porcentaje de descuento automático en compras mayores a un monto.',
  },
];

export interface CustomerBenefit {
  id: string;
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
  createdBy?: string;
  active: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export type PaymentMethod = 'card' | 'wallet' | 'transfer' | 'cash';
export type PaymentStatus = 'approved' | 'pending_transfer' | 'pending_cash' | 'refunded';
export type ShipmentStatus =
  | 'confirmed'
  | 'preparing'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface PaymentReceipt {
  imageUrl: string;
  fileName: string;
  operationNumber: string;
  bankName: string;
  amountDetected: string;
  payerName: string;
  transferDate: string;
  destinationAccount: string;
  summary: string;
  uploadedAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  category: CategoryId;
  price: number;
  quantity: number;
  imageUrl: string;
}

export interface TrackingEvent {
  status: ShipmentStatus;
  label: string;
  location: string;
  note: string;
  timestampIso: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  trackingCode: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPostalCode: string;
  shippingNotes: string;
  deliveryMethod?: DeliveryMethod;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentBrand: string;
  paymentLast4: string;
  installments: number;
  transactionId: string;
  paymentStatus: PaymentStatus;
  paymentReceipt?: PaymentReceipt;
  shipmentStatus: ShipmentStatus;
  carrier: string;
  assignedCourier?: AssignedCourier;
  estimatedDelivery: string;
  currentLocation: string;
  trackingEvents: TrackingEvent[];
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export type NotificationType = 'order' | 'shipment' | 'promo' | 'inventory';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  orderId: string;
  read: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  businessName?: string;
  email: string;
  photoURL: string;
  phone: string;
  defaultAddress: string;
  defaultCity: string;
  defaultPostalCode: string;
  bankCbuCvu?: string;
  bankAlias?: string;
  bankAccountHolder?: string;
  joinedAt?: string;
  subscriptionStatus?: 'trial' | 'active' | 'inactive';
  subscriptionPaidUntil?: string;
  lastActivatedAt?: string;
  pushEnabled: boolean;
  role: 'customer' | 'admin';
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export type SubscriptionPaymentMethod = 'cash' | 'transfer';
export type SubscriptionPaymentStatus = 'pending' | 'approved' | 'rejected';

export interface SubscriptionPayment {
  id: string;
  userId: string;
  userName: string;
  businessName?: string;
  userEmail: string;
  amount: number;
  paymentMethod: SubscriptionPaymentMethod;
  note: string;
  paymentReceipt?: PaymentReceipt;
  status: SubscriptionPaymentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface StoreSettings {
  freeShippingThreshold: number;
  standardShippingCost: number;
  updatedBy?: string;
  updatedAt?: Timestamp | string;
}

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export type DatabaseMode = 'cloud' | 'local';

export type CloudflareTunnelPhase =
  | 'idle'
  | 'installing'
  | 'awaiting_browser_auth'
  | 'starting'
  | 'active'
  | 'error';

export interface CloudflareTunnelStatus {
  installed: boolean;
  binaryPath?: string;
  accountAuthorized: boolean;
  chromeDetected?: boolean;
  chromeOpened?: boolean;
  defaultBrowserOpened?: boolean;
  phase: CloudflareTunnelPhase;
  authUrl?: string;
  publicUrl?: string;
  startedAt?: string;
  message?: string;
  error?: string;
}

export interface LocalServerInfo {
  available: boolean;
  networkMode: 'local' | 'lan';
  standalonePcMode?: boolean;
  host: string;
  port: number;
  localUrl: string;
  lanUrls: string[];
  cloudflarePublicUrl?: string;
  cloudflarePhase?: CloudflareTunnelPhase;
  dbFileName: string;
  adminClaimed: boolean;
  envAdminConfigured: boolean;
  counts: {
    products: number;
    orders: number;
    notifications: number;
    users: number;
  };
}

export type ActiveView = 'catalog' | 'tracking' | 'notifications' | 'admin';
export type AdminTab =
  | 'analytics'
  | 'inventory'
  | 'orders'
  | 'shipping'
  | 'push'
  | 'subscription'
  | 'accounts'
  | 'backups'
  | 'database';

export type RestoreMode = 'replace' | 'merge';

export interface DatabaseBackupPayload {
  version: number;
  exportedAt: string;
  sourceMode: 'local' | 'lan' | 'cloud';
  products: Product[];
  orders: Order[];
  notifications: AppNotification[];
  shippingSettings: StoreSettings;
}

export interface LocalBackupSnapshotMeta {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  sourceMode: string;
  productsCount: number;
  ordersCount: number;
  notificationsCount: number;
}

export interface RestoreSummary {
  products: number;
  orders: number;
  notifications: number;
  shippingSettings: boolean;
  safetyBackupFile?: string;
}

export const SHIPMENT_PIPELINE: {
  status: ShipmentStatus;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    status: 'confirmed',
    label: 'Pedido confirmado',
    shortLabel: 'Confirmado',
    description: 'Pago validado y reserva de stock confirmada en depósito.',
  },
  {
    status: 'preparing',
    label: 'Preparando en depósito',
    shortLabel: 'Preparando',
    description: 'Control de calidad, embalaje protector y generación de etiqueta.',
  },
  {
    status: 'in_transit',
    label: 'En tránsito interurbano',
    shortLabel: 'En tránsito',
    description: 'Despachado hacia el centro de distribución de destino.',
  },
  {
    status: 'out_for_delivery',
    label: 'En reparto local',
    shortLabel: 'En reparto',
    description: 'El correo se encuentra en ruta hacia tu domicilio.',
  },
  {
    status: 'delivered',
    label: 'Entregado',
    shortLabel: 'Entregado',
    description: 'Paquete recibido y entrega confirmada.',
  },
];
