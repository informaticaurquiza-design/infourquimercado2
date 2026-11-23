import type { CategoryId, ShipmentStatus, UserProfile } from '../types/ecommerce';

// Synchronized verbatim with firebase-blueprint.json & firestore.rules
export const SKU_PATTERN = /^[A-Z0-9-]+$/;
export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const ORDER_NUMBER_PATTERN = /^ALB-[0-9]{4}-[0-9]{4}$/;
export const TRACKING_CODE_PATTERN = /^TRK-[A-Z0-9]{8}$/;

export const FREE_SHIPPING_THRESHOLD = 150000;
export const STANDARD_SHIPPING_COST = 8500;
export const SELLER_TRIAL_DAYS = 30;
export const MONTHLY_SUBSCRIPTION_COST = 5000;
export const SELLER_TRIAL_NOTICE =
  'Los primeros 30 dias de uso de la cuenta para vendedores son gratis, pasado los 30 dias tiene un costo de $ 5000';

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

export function validateProductInput(input: {
  sku: string;
  name: string;
  category: CategoryId;
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
      label: 'Período gratuito (30 días)',
      statusLabel: 'Período gratuito (30 días)',
      detailText: `Quedan ${SELLER_TRIAL_DAYS} días de prueba gratuita para vendedores.`,
      joinedAtIso: joinedAtDate.toISOString(),
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate: null,
      effectiveExpiresAt: trialEndsAtDate,
      daysRemaining: SELLER_TRIAL_DAYS,
    };
  }

  const joinedAtDate =
    parseTimestampValue(profile.joinedAt) || parseTimestampValue(profile.createdAt) || now;
  const joinedAtIso = joinedAtDate.toISOString();
  const trialEndsAtDate = new Date(joinedAtDate.getTime() + SELLER_TRIAL_DAYS * MS_PER_DAY);
  const paidUntilDate = parseTimestampValue(profile.subscriptionPaidUntil);

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
    };
  }

  if (profile.subscriptionStatus === 'inactive') {
    return {
      isActive: false,
      status: 'inactive',
      label: 'Inactivo',
      statusLabel: 'Cuenta inactiva',
      detailText:
        'Publicaciones pausadas. Registrá el pago mensual de $ 5.000 para reactivar la cuenta.',
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: paidUntilDate || trialEndsAtDate,
      daysRemaining: 0,
    };
  }

  if (profile.subscriptionStatus === 'active') {
    if (paidUntilDate && paidUntilDate.getTime() < now.getTime()) {
      return {
        isActive: false,
        status: 'expired',
        label: 'Inactivo (abono vencido)',
        statusLabel: 'Abono mensual vencido',
        detailText: `Venció el ${formatShortDate(paidUntilDate.toISOString())}. Aboná $ 5.000 para reactivar tus publicaciones.`,
        joinedAtIso,
        joinedAtDate,
        trialEndsAtDate,
        paidUntilDate,
        effectiveExpiresAt: paidUntilDate,
        daysRemaining: 0,
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
    };
  }

  // Default: 30-day free trial from joinedAt
  const remainingMs = trialEndsAtDate.getTime() - now.getTime();
  if (remainingMs >= 0) {
    const daysRemaining = Math.max(1, Math.ceil(remainingMs / MS_PER_DAY));
    return {
      isActive: true,
      status: 'trial',
      label: 'Activo (prueba 30 días)',
      statusLabel: 'Prueba gratuita 30 días',
      detailText: `Quedan ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'} gratis (hasta el ${formatShortDate(trialEndsAtDate.toISOString())}).`,
      joinedAtIso,
      joinedAtDate,
      trialEndsAtDate,
      paidUntilDate,
      effectiveExpiresAt: trialEndsAtDate,
      daysRemaining,
    };
  }

  return {
    isActive: false,
    status: 'expired',
    label: 'Inactivo (prueba vencida)',
    statusLabel: 'Período gratuito vencido',
    detailText: `Los 30 días gratis finalizaron el ${formatShortDate(trialEndsAtDate.toISOString())}. Aboná $ 5.000 para reactivar tus publicaciones.`,
    joinedAtIso,
    joinedAtDate,
    trialEndsAtDate,
    paidUntilDate,
    effectiveExpiresAt: trialEndsAtDate,
    daysRemaining: 0,
  };
}
