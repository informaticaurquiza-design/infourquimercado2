import type { Timestamp } from 'firebase/firestore';

export type CategoryId = string;

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  shortLabel: string;
  description: string;
  active?: boolean;
  sortOrder?: number;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'tecnologia',
    label: 'Tecnología & Audio',
    shortLabel: 'Tecnología',
    description: 'Auriculares de estudio, parlantes y periféricos de precisión.',
    active: true,
    sortOrder: 0,
  },
  {
    id: 'hogar',
    label: 'Hogar & Diseño',
    shortLabel: 'Hogar',
    description: 'Iluminación arquitectónica y objetos funcionales para espacios modernos.',
    active: true,
    sortOrder: 1,
  },
  {
    id: 'indumentaria',
    label: 'Indumentaria Urbana',
    shortLabel: 'Indumentaria',
    description: 'Prendas técnicas impermeables y básicos de sastrería contemporánea.',
    active: true,
    sortOrder: 2,
  },
  {
    id: 'relojeria',
    label: 'Relojería & Accesorios',
    shortLabel: 'Relojería',
    description: 'Cronógrafos automáticos, marroquinería y piezas de acero cepillado.',
    active: true,
    sortOrder: 3,
  },
  {
    id: 'deportes',
    label: 'Deportes & Outdoor',
    shortLabel: 'Deportes',
    description: 'Mochilas técnicas, equipamiento urbano y accesorios de expedición.',
    active: true,
    sortOrder: 4,
  },
  {
    id: 'gourmet',
    label: 'Café & Gourmet',
    shortLabel: 'Gourmet',
    description: 'Pavas de cuello de cisne, métodos de filtrado y selección barista.',
    active: true,
    sortOrder: 5,
  },
];

export const CATEGORY_MAP: Record<string, CategoryDefinition> = CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<string, CategoryDefinition>,
);

export type ProductCondition = 'nuevo' | 'usado';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: CategoryId;
  categoryLabel: string;
  condition?: ProductCondition;
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
  sellerId?: string;
  sellerName?: string;
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
  sellerIds?: string[];
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

export interface AdminBillingSettings {
  bankAlias: string;
  bankCbuCvu: string;
  bankAccountHolder: string;
  updatedBy?: string;
  updatedAt?: Timestamp | string;
}

export interface ShippingRate {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  zone: string;
  cost: number;
  freeOverAmount: number;
  estimatedDays: string;
  description: string;
  active: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export type ActiveView = 'catalog' | 'tracking' | 'notifications' | 'admin';
export type AdminTab =
  | 'analytics'
  | 'inventory'
  | 'categories'
  | 'orders'
  | 'shipping'
  | 'push'
  | 'subscription'
  | 'accounts'
  | 'backups';

export type RestoreMode = 'replace' | 'merge';

export interface DatabaseBackupPayload {
  version: number;
  exportedAt: string;
  sourceMode: 'cloud' | 'local' | 'lan';
  products: Product[];
  orders: Order[];
  notifications: AppNotification[];
  shippingSettings: StoreSettings;
}

export interface RestoreSummary {
  products: number;
  orders: number;
  notifications: number;
  shippingSettings: boolean;
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
