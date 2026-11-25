import type {
  BenefitType,
  CategoryId,
  CustomerBenefit,
  DeliveryVehicleType,
  Product,
  ProductCondition,
  ShipmentStatus,
  UserProfile,
} from '../types/ecommerce';

// Synchronized verbatim with firebase-blueprint.json & firestore.rules
export const SKU_PATTERN = /^[A-Z0-9-]+$/;
export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const ORDER_NUMBER_PATTERN = /^ALB-[0-9]{4}-[0-9]{4}$/;
export const TRACKING_CODE_PATTERN = /^TRK-[A-Z0-9]{8}$/;
export const LICENSE_PLATE_PATTERN = /^[A-Z0-9 -]{4,16}$/;
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,24}$/;
export const DATE_ONLY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export const FREE_SHIPPING_THRESHOLD = 150000;
export const STANDARD_SHIPPING_COST = 8500;
export const SELLER_TRIAL_DAYS = 30;
export const MONTHLY_SUBSCRIPTION_COST_TIER_1 = 5000;
export const MONTHLY_SUBSCRIPTION_COST_TIER_2 = 10000;
export const MONTHLY_SUBSCRIPTION_COST = MONTHLY_SUBSCRIPTION_COST_TIER_1;
export const SELLER_TRIAL_NOTICE =
  'El primer mes (30 días) de uso para vendedores es gratis. A partir del 2° mes el abono es de $ 5.000 y a partir del 4° mes el valor es de $ 10.000.';

export function clampString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatDateTime(isoOrDate: unknown): string {
  if (!isoOrDate) return '—';
  let date: Date;
  if (typeof isoOrDate === 'string') {
    date = new Date(isoOrDate);
  } else if (
    typeof isoOrDate === 'object' &&
    isoOrDate !== null &&
    'toDate' in isoOrDate &&
    typeof (isoOrDate as { toDate: () => Date }).toDate === 'function'
  ) {
    date = (isoOrDate as { toDate: () => Date }).toDate();
  } else if (isoOrDate instanceof Date) {
    date = isoOrDate;
  } else {
    return '—';
  }
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(isoOrDate: unknown): string {
  if (!isoOrDate) return '—';
  let date: Date;
  if (typeof isoOrDate === 'string') {
    date = new Date(isoOrDate);
  } else if (
    typeof isoOrDate === 'object' &&
    isoOrDate !== null &&
    'toDate' in isoOrDate &&
    typeof (isoOrDate as { toDate: () => Date }).toDate === 'function'
  ) {
    date = (isoOrDate as { toDate: () => Date }).toDate();
  } else {
    return '—';
  }
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `ALB-${year}-${suffix}`;
}

export function generateTrackingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `TRK-${code}`;
}

export function generateTransactionId(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 10; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${suffix}`;
}

export function detectCardBrand(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.startsWith('4')) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(clean)) return 'Mastercard';
  if (/^3[47]/.test(clean)) return 'American Express';
  return 'Tarjeta';
}

export function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatCardExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
}

export const CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

export function slugifyCategoryId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function validateCategoryInput(input: {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  sortOrder: number;
}): string | null {
  const id = input.id.trim().toLowerCase();
  if (!CATEGORY_SLUG_PATTERN.test(id)) {
    return 'El identificador del rubro debe tener entre 2 y 40 caracteres (letras minúsculas, números y guiones).';
  }
  const label = input.label.trim();
  if (label.length < 2 || label.length > 48) {
    return 'El nombre del rubro debe tener entre 2 y 48 caracteres.';
  }
  const shortLabel = input.shortLabel.trim();
  if (shortLabel.length < 2 || shortLabel.length > 28) {
    return 'El nombre corto debe tener entre 2 y 28 caracteres.';
  }
  const description = input.description.trim();
  if (description.length < 3 || description.length > 200) {
    return 'La descripción del rubro debe tener entre 3 y 200 caracteres.';
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 1000) {
    return 'El orden debe ser un número entero entre 0 y 1000.';
  }
  return null;
}

export function getProductConditionLabel(condition?: ProductCondition): string {
  return condition === 'usado' ? 'Usado' : 'Nuevo';
}

export function validateProductInput(input: {
  sku: string;
  name: string;
  category: CategoryId;
  condition?: ProductCondition;
  description: string;
  price: number;
  stock: number;
  minStockThreshold: number;
}): string | null {
  const sku = input.sku.trim().toUpperCase();
  if (sku.length < 3 || sku.length > 32 || !SKU_PATTERN.test(sku)) {
    return 'El SKU debe tener entre 3 y 32 caracteres (solo letras mayúsculas, números y guiones).';
  }
  if (input.name.trim().length < 2 || input.name.trim().length > 120) {
    return 'El nombre del producto debe tener entre 2 y 120 caracteres.';
  }
  if (!CATEGORY_SLUG_PATTERN.test(String(input.category || '').trim())) {
    return 'Seleccioná un rubro válido para el producto.';
  }
  if (input.condition !== undefined && input.condition !== 'nuevo' && input.condition !== 'usado') {
    return 'Seleccioná si el artículo es Nuevo o Usado.';
  }
  if (input.description.trim().length < 5 || input.description.trim().length > 800) {
    return 'La descripción debe tener entre 5 y 800 caracteres.';
  }
  if (!Number.isFinite(input.price) || input.price <= 0 || input.price > 100000000) {
    return 'El precio debe ser un número mayor a 0.';
  }
  if (!Number.isInteger(input.stock) || input.stock < 0 || input.stock > 100000) {
    return 'El stock debe ser un número entero mayor o igual a 0.';
  }
  if (
    !Number.isInteger(input.minStockThreshold) ||
    input.minStockThreshold < 0 ||
    input.minStockThreshold > 1000
  ) {
    return 'El umbral mínimo de stock debe estar entre 0 y 1000.';
  }
  return null;
}

export function getShipmentStatusMeta(status: ShipmentStatus): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmado', colorClass: 'text-blue-700' };
    case 'preparing':
      return { label: 'Preparando', colorClass: 'text-amber-700' };
    case 'in_transit':
      return { label: 'En tránsito', colorClass: 'text-amber-700' };
    case 'out_for_delivery':
      return { label: 'En reparto', colorClass: 'text-blue-700' };
    case 'delivered':
      return { label: 'Entregado', colorClass: 'text-emerald-700' };
    case 'cancelled':
      return { label: 'Cancelado', colorClass: 'text-red-600' };
  }
}

export function getNextShipmentStatus(current: ShipmentStatus): ShipmentStatus | null {
  switch (current) {
    case 'confirmed':
      return 'preparing';
    case 'preparing':
      return 'in_transit';
    case 'in_transit':
      return 'out_for_delivery';
    case 'out_for_delivery':
      return 'delivered';
    default:
      return null;
  }
}

export function getPreviousShipmentStatus(current: ShipmentStatus): ShipmentStatus | null {
  switch (current) {
    case 'delivered':
      return 'out_for_delivery';
    case 'out_for_delivery':
      return 'in_transit';
    case 'in_transit':
      return 'preparing';
    case 'preparing':
      return 'confirmed';
    default:
      return null;
  }
}

export function getVehicleTypeLabel(vehicleType: DeliveryVehicleType): string {
  switch (vehicleType) {
    case 'moto':
      return 'Moto';
    case 'auto':
      return 'Auto';
    case 'utilitario':
      return 'Utilitario';
  }
}

export function validateDeliveryAgentInput(input: {
  vehicleType: string;
  licensePlate: string;
  fullName: string;
}): string | null {
  if (!['moto', 'auto', 'utilitario'].includes(input.vehicleType)) {
    return 'Seleccioná un tipo de vehículo válido (Moto, Auto o Utilitario).';
  }
  const plate = input.licensePlate.trim().toUpperCase();
  if (plate.length < 4 || plate.length > 16 || !LICENSE_PLATE_PATTERN.test(plate)) {
    return 'Ingresá una patente válida (entre 4 y 16 caracteres, letras y números).';
  }
  const name = input.fullName.trim();
  if (name.length < 2 || name.length > 100) {
    return 'Ingresá el nombre completo del repartidor (entre 2 y 100 caracteres).';
  }
  return null;
}

export function getBenefitTypeLabel(type: BenefitType): string {
  switch (type) {
    case 'installments':
      return 'Cuotas sin interés';
    case 'promo_code':
      return 'Código de descuento';
    case 'min_amount_discount':
      return 'Descuento por monto';
  }
}

export function isBenefitExpired(
  benefit: Pick<CustomerBenefit, 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  const raw = (benefit.expiresAt || '').trim();
  if (!raw || !DATE_ONLY_PATTERN.test(raw)) return false;
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return false;
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(endOfDay.getTime())) return false;
  return now.getTime() > endOfDay.getTime();
}

export function formatExpirationDate(expiresAt?: string): string {
  const raw = (expiresAt || '').trim();
  if (!raw || !DATE_ONLY_PATTERN.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatBenefitSummary(benefit: CustomerBenefit): string {
  if (benefit.type === 'installments') {
    const base = `Hasta ${benefit.maxInstallments} cuotas sin interés`;
    return benefit.minOrderAmount > 0
      ? `${base} (mín. ${formatCurrency(benefit.minOrderAmount)})`
      : base;
  }
  if (benefit.type === 'promo_code') {
    const base = `${benefit.discountPercent}% OFF · Código ${benefit.promoCode}`;
    return benefit.minOrderAmount > 0
      ? `${base} (mín. ${formatCurrency(benefit.minOrderAmount)})`
      : base;
  }
  return `${benefit.discountPercent}% OFF en compras ≥ ${formatCurrency(benefit.minOrderAmount)}`;
}

export function getProductActiveBenefit(
  product: Pick<Product, 'benefitId' | 'benefitEnabled'>,
  benefits: CustomerBenefit[],
  userId?: string | null,
  now: Date = new Date(),
): CustomerBenefit | null {
  if (!product.benefitEnabled || !product.benefitId) return null;
  const found = benefits.find((b) => b.id === product.benefitId);
  if (!found || !found.active || isBenefitExpired(found, now)) return null;
  if (found.targetUserId !== 'all' && (!userId || found.targetUserId !== userId)) {
    return null;
  }
  return found;
}

export function validateBenefitInput(input: {
  title: string;
  description: string;
  type: string;
  targetUserId: string;
  targetUserName: string;
  promoCode: string;
  discountPercent: number;
  minOrderAmount: number;
  maxInstallments: number;
  expiresAt?: string;
}): string | null {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 100) {
    return 'El título del beneficio debe tener entre 2 y 100 caracteres.';
  }
  if (input.description.trim().length > 240) {
    return 'La descripción no puede superar los 240 caracteres.';
  }
  if (!['installments', 'promo_code', 'min_amount_discount'].includes(input.type)) {
    return 'Seleccioná un tipo de beneficio válido.';
  }
  const targetUserId = input.targetUserId.trim();
  if (!targetUserId || targetUserId.length > 128 || !ID_PATTERN.test(targetUserId)) {
    return 'Seleccioná un cliente destinatario válido (o Todos los clientes).';
  }
  if (input.targetUserName.trim().length < 2 || input.targetUserName.trim().length > 120) {
    return 'El nombre del destinatario es obligatorio.';
  }
  if (
    !Number.isFinite(input.minOrderAmount) ||
    input.minOrderAmount < 0 ||
    input.minOrderAmount > 500000000
  ) {
    return 'El monto mínimo debe ser un número mayor o igual a 0.';
  }
  const expiresAt = (input.expiresAt || '').trim();
  if (expiresAt) {
    if (!DATE_ONLY_PATTERN.test(expiresAt)) {
      return 'La fecha de vencimiento debe tener formato válido (AAAA-MM-DD).';
    }
    const [y, m, d] = expiresAt.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== y ||
      parsed.getMonth() !== m - 1 ||
      parsed.getDate() !== d
    ) {
      return 'Ingresá una fecha de vencimiento válida.';
    }
  }

  if (input.type === 'installments') {
    if (
      !Number.isInteger(input.maxInstallments) ||
      input.maxInstallments < 2 ||
      input.maxInstallments > 12
    ) {
      return 'La cantidad de cuotas sin interés debe estar entre 2 y 12.';
    }
  } else if (input.type === 'promo_code') {
    const code = input.promoCode.trim().toUpperCase();
    if (!PROMO_CODE_PATTERN.test(code)) {
      return 'El código debe tener entre 3 y 24 caracteres (solo letras, números, guiones o guion bajo).';
    }
    if (
      !Number.isFinite(input.discountPercent) ||
      input.discountPercent < 1 ||
      input.discountPercent > 90
    ) {
      return 'El porcentaje de descuento debe estar entre 1% y 90%.';
    }
  } else if (input.type === 'min_amount_discount') {
    if (input.minOrderAmount <= 0) {
      return 'Para descuento por monto, el monto mínimo debe ser mayor a $0.';
    }
    if (
      !Number.isFinite(input.discountPercent) ||
      input.discountPercent < 1 ||
      input.discountPercent > 90
    ) {
      return 'El porcentaje de descuento debe estar entre 1% y 90%.';
    }
  }
  return null;
}

export function getInstallmentOptions(maxInstallments: number): number[] {
  const safeMax = Math.max(1, Math.min(12, Math.floor(maxInstallments)));
  const standard = [1, 2, 3, 6, 9, 12].filter((n) => n <= safeMax);
  if (!standard.includes(safeMax)) {
    standard.push(safeMax);
  }
  return standard.sort((a, b) => a - b);
}

export interface OrderBenefitsEvaluation {
  applicableBenefits: CustomerBenefit[];
  promoBenefits: CustomerBenefit[];
  matchedPromoBenefit: CustomerBenefit | null;
  promoCodeApplied: string;
  promoDiscountPercent: number;
  promoDiscount: number;
  promoMinNotMetAmount: number | null;
  matchedThresholdBenefit: CustomerBenefit | null;
  nextThresholdBenefit: CustomerBenefit | null;
  thresholdDiscount: number;
  combinedBenefitDiscount: number;
  matchedInstallmentsBenefit: CustomerBenefit | null;
  catalogMaxInstallments: number;
  maxInstallments: number;
  installmentOptions: number[];
}

export function evaluateOrderBenefits(params: {
  subtotal: number;
  promoCode: string;
  benefits: CustomerBenefit[];
  userId?: string | null;
}): OrderBenefitsEvaluation {
  const subtotal = Math.max(0, Math.round(params.subtotal));
  const normalizedCode = params.promoCode.trim().toUpperCase();
  const userId = params.userId || null;
  const now = new Date();

  const applicableBenefits = params.benefits.filter(
    (b) =>
      b.active &&
      !isBenefitExpired(b, now) &&
      (b.targetUserId === 'all' || (Boolean(userId) && b.targetUserId === userId)),
  );

  // 1. Promo code matching
  const promoBenefits = applicableBenefits.filter((b) => b.type === 'promo_code' && b.promoCode);
  let matchedPromoBenefit: CustomerBenefit | null = null;
  let promoCodeApplied = '';
  let promoDiscountPercent = 0;
  let promoDiscount = 0;
  let promoMinNotMetAmount: number | null = null;

  if (normalizedCode) {
    const exactCandidates = promoBenefits.filter(
      (b) => b.promoCode.trim().toUpperCase() === normalizedCode,
    );
    if (exactCandidates.length > 0) {
      // Prefer personal benefit over global, then highest discount
      exactCandidates.sort((a, b) => {
        const aPersonal = a.targetUserId !== 'all' ? 1 : 0;
        const bPersonal = b.targetUserId !== 'all' ? 1 : 0;
        if (bPersonal !== aPersonal) return bPersonal - aPersonal;
        return b.discountPercent - a.discountPercent;
      });
      const bestMatch = exactCandidates[0];
      if (subtotal >= bestMatch.minOrderAmount || subtotal === 0) {
        matchedPromoBenefit = bestMatch;
        promoCodeApplied = bestMatch.promoCode.trim().toUpperCase();
        promoDiscountPercent = bestMatch.discountPercent;
        promoDiscount = Math.round(subtotal * (bestMatch.discountPercent / 100));
      } else {
        promoMinNotMetAmount = bestMatch.minOrderAmount;
      }
    } else if (promoBenefits.length === 0 && normalizedCode === 'ALBA10') {
      // Backward-compatible default store coupon when no custom promo codes exist yet
      promoCodeApplied = 'ALBA10';
      promoDiscountPercent = 10;
      promoDiscount = Math.round(subtotal * 0.1);
    }
  }

  // 2. Automatic threshold discount (min_amount_discount)
  const thresholdBenefits = applicableBenefits.filter(
    (b) => b.type === 'min_amount_discount' && b.minOrderAmount > 0 && b.discountPercent > 0,
  );
  const qualifiedThresholds = thresholdBenefits.filter((b) => subtotal >= b.minOrderAmount);
  qualifiedThresholds.sort((a, b) => {
    if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
    return a.minOrderAmount - b.minOrderAmount;
  });
  const matchedThresholdBenefit = qualifiedThresholds[0] ?? null;
  const thresholdDiscount = matchedThresholdBenefit
    ? Math.round(subtotal * (matchedThresholdBenefit.discountPercent / 100))
    : 0;

  const currentThresholdPct = matchedThresholdBenefit?.discountPercent ?? 0;
  const upcomingThresholds = thresholdBenefits
    .filter((b) => b.minOrderAmount > subtotal && b.discountPercent > currentThresholdPct)
    .sort((a, b) => a.minOrderAmount - b.minOrderAmount);
  const nextThresholdBenefit = upcomingThresholds[0] ?? null;

  const combinedBenefitDiscount = Math.min(subtotal, promoDiscount + thresholdDiscount);

  // 3. Installments (cuotas sin interés)
  const installmentBenefits = applicableBenefits.filter(
    (b) => b.type === 'installments' && b.maxInstallments >= 2,
  );
  const catalogMaxInstallments =
    installmentBenefits.length > 0
      ? Math.max(...installmentBenefits.map((b) => b.maxInstallments))
      : 6;

  const qualifiedInstallments = installmentBenefits.filter(
    (b) => subtotal === 0 || subtotal >= b.minOrderAmount,
  );
  qualifiedInstallments.sort((a, b) => b.maxInstallments - a.maxInstallments);
  const matchedInstallmentsBenefit = qualifiedInstallments[0] ?? null;

  const maxInstallments =
    installmentBenefits.length === 0
      ? 6
      : matchedInstallmentsBenefit
        ? matchedInstallmentsBenefit.maxInstallments
        : 1;

  return {
    applicableBenefits,
    promoBenefits,
    matchedPromoBenefit,
    promoCodeApplied,
    promoDiscountPercent,
    promoDiscount,
    promoMinNotMetAmount,
    matchedThresholdBenefit,
    nextThresholdBenefit,
    thresholdDiscount,
    combinedBenefitDiscount,
    matchedInstallmentsBenefit,
    catalogMaxInstallments,
    maxInstallments,
    installmentOptions: getInstallmentOptions(maxInstallments),
  };
}

function parseTimestampValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const sec = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(sec)) return new Date(sec * 1000);
  }
  return null;
}

export interface AccountSubscriptionInfo {
  isActive: boolean;
  status: 'admin' | 'trial' | 'active' | 'expired' | 'inactive';
  label: string;
  statusLabel: string;
  detailText: string;
  joinedAtIso: string;
  joinedAtDate: Date;
  trialEndsAtDate: Date;
  paidUntilDate: Date | null;
  effectiveExpiresAt: Date | null;
  daysRemaining: number;
  accountMonth: number;
  currentMonthCost: number;
  monthlyAmount: number;
  tierLabel: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function getAccountSubscriptionInfo(
  profile:
    | Pick<
        UserProfile,
        'role' | 'joinedAt' | 'createdAt' | 'subscriptionStatus' | 'subscriptionPaidUntil'
      >
    | null
    | undefined,
  now: Date = new Date(),
): AccountSubscriptionInfo {
  if (!profile) {
    const joinedAtDate = now;
    const trialEndsAtDate = new Date(joinedAtDate.getTime() + SELLER_TRIAL_DAYS * MS_PER_DAY);
    return {
      isActive: true,
      status: 'trial',
      label: 'Período gratuito (1° mes)',
      statusLabel: 'Primer mes gratis (30 días)',
      detailText: `Quedan ${SELLER_TRIAL_DAYS} días de prueba gratuita. A partir del 2° mes el abono es de ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_1)} y desde el 4° mes ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_2)}.`,
      joinedAtIso: joinedAtDate.toISOString(),
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate: null,
      effectiveExpiresAt: trialEndsAtDate,
      daysRemaining: SELLER_TRIAL_DAYS,
      accountMonth: 1,
      currentMonthCost: 0,
      monthlyAmount: MONTHLY_SUBSCRIPTION_COST_TIER_1,
      tierLabel: '1° mes — Gratis',
    };
  }

  const joinedAtDate =
    parseTimestampValue(profile.joinedAt) || parseTimestampValue(profile.createdAt) || now;
  const joinedAtIso = joinedAtDate.toISOString();
  const trialEndsAtDate = new Date(joinedAtDate.getTime() + SELLER_TRIAL_DAYS * MS_PER_DAY);
  const paidUntilDate = parseTimestampValue(profile.subscriptionPaidUntil);

  const elapsedDays = Math.max(0, Math.floor((now.getTime() - joinedAtDate.getTime()) / MS_PER_DAY));
  const accountMonth = Math.floor(elapsedDays / SELLER_TRIAL_DAYS) + 1;
  const currentMonthCost =
    accountMonth <= 1
      ? 0
      : accountMonth >= 4
        ? MONTHLY_SUBSCRIPTION_COST_TIER_2
        : MONTHLY_SUBSCRIPTION_COST_TIER_1;

  // Determine the payable monthly fee for the upcoming/current paid billing cycle
  const billingBaseDate =
    paidUntilDate && paidUntilDate.getTime() > now.getTime() ? paidUntilDate : now;
  const billingElapsedDays = Math.max(
    0,
    Math.floor((billingBaseDate.getTime() - joinedAtDate.getTime()) / MS_PER_DAY),
  );
  const billingMonth = Math.max(2, Math.floor(billingElapsedDays / SELLER_TRIAL_DAYS) + 1);
  const monthlyAmount =
    billingMonth >= 4 ? MONTHLY_SUBSCRIPTION_COST_TIER_2 : MONTHLY_SUBSCRIPTION_COST_TIER_1;

  const tierLabel =
    accountMonth <= 1
      ? '1° mes — Gratis'
      : accountMonth >= 4
        ? `${accountMonth}° mes — ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_2)}/mes`
        : `${accountMonth}° mes — ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_1)}/mes`;

  if (profile.role === 'admin') {
    return {
      isActive: true,
      status: 'admin',
      label: 'Administrador',
      statusLabel: 'Administrador',
      detailText: 'Cuenta administradora con acceso completo y sin vencimiento.',
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: null,
      daysRemaining: 999,
      accountMonth,
      currentMonthCost: 0,
      monthlyAmount,
      tierLabel: 'Sin cargo (Administrador)',
    };
  }

  if (profile.subscriptionStatus === 'inactive') {
    return {
      isActive: false,
      status: 'inactive',
      label: 'Inactivo',
      statusLabel: 'Cuenta inactiva',
      detailText: `Publicaciones pausadas. Registrá el pago mensual de ${formatCurrency(monthlyAmount)} para reactivar la cuenta.`,
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: paidUntilDate || trialEndsAtDate,
      daysRemaining: 0,
      accountMonth,
      currentMonthCost,
      monthlyAmount,
      tierLabel,
    };
  }

  if (profile.subscriptionStatus === 'active') {
    if (paidUntilDate && paidUntilDate.getTime() < now.getTime()) {
      return {
        isActive: false,
        status: 'expired',
        label: 'Inactivo (abono vencido)',
        statusLabel: 'Abono mensual vencido',
        detailText: `Venció el ${formatShortDate(paidUntilDate.toISOString())}. Aboná ${formatCurrency(monthlyAmount)} para reactivar tus publicaciones.`,
        joinedAtIso,
        joinedAtDate,
        trialEndsAtDate,
        paidUntilDate,
        effectiveExpiresAt: paidUntilDate,
        daysRemaining: 0,
        accountMonth,
        currentMonthCost,
        monthlyAmount,
        tierLabel,
      };
    }
    const daysRemaining = paidUntilDate
      ? Math.max(1, Math.ceil((paidUntilDate.getTime() - now.getTime()) / MS_PER_DAY))
      : SELLER_TRIAL_DAYS;
    return {
      isActive: true,
      status: 'active',
      label: 'Activo (abonado)',
      statusLabel: 'Abono mensual activo',
      detailText: paidUntilDate
        ? `Vigente por ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'} (hasta el ${formatShortDate(paidUntilDate.toISOString())}).`
        : 'Cuenta activada por administración.',
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: paidUntilDate,
      daysRemaining,
      accountMonth,
      currentMonthCost,
      monthlyAmount,
      tierLabel,
    };
  }

  // Default: 30-day free trial from joinedAt (1st month)
  const remainingMs = trialEndsAtDate.getTime() - now.getTime();
  if (remainingMs >= 0) {
    const daysRemaining = Math.max(1, Math.ceil(remainingMs / MS_PER_DAY));
    return {
      isActive: true,
      status: 'trial',
      label: 'Activo (1° mes gratis)',
      statusLabel: 'Primer mes gratis (30 días)',
      detailText: `Quedan ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'} gratis (hasta el ${formatShortDate(trialEndsAtDate.toISOString())}). Luego el 2° y 3° mes cuestan ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_1)}/mes y desde el 4° mes ${formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_2)}/mes.`,
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: trialEndsAtDate,
      daysRemaining,
      accountMonth,
      currentMonthCost,
      monthlyAmount,
      tierLabel,
    };
  }

  return {
    isActive: false,
    status: 'expired',
    label: 'Inactivo (1° mes gratis vencido)',
    statusLabel: 'Primer mes gratuito vencido',
    detailText: `El primer mes gratis finalizó el ${formatShortDate(trialEndsAtDate.toISOString())}. Aboná ${formatCurrency(monthlyAmount)} para reactivar tus publicaciones.`,
    joinedAtIso,
    joinedAtDate,
    trialEndsAtDate,
    paidUntilDate,
    effectiveExpiresAt: trialEndsAtDate,
    daysRemaining: 0,
    accountMonth,
    currentMonthCost,
    monthlyAmount,
    tierLabel,
  };
}
