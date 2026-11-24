import { useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  Calendar,
  Check,
  CheckCheck,
  Copy,
  CreditCard,
  Edit3,
  Gift,
  Package,
  Percent,
  Plus,
  Settings2,
  Tag,
  Trash2,
  Truck,
  User,
  Users,
} from 'lucide-react';
import { sendBrowserPush, type PushPermissionState } from '../lib/pushNotifications';
import {
  formatCurrency,
  formatDateTime,
  formatExpirationDate,
  getBenefitTypeLabel,
  isBenefitExpired,
} from '../lib/validation';
import {
  createOrUpdateBenefit,
  deleteBenefitById,
  deleteNotificationById,
  markNotificationRead,
} from '../services/dataService';
import type {
  AppNotification,
  AppUser,
  CustomerBenefit,
  NotificationType,
  UserProfile,
} from '../types/ecommerce';
import { BenefitsManagerModal } from './BenefitsManagerModal';

interface NotificationsViewProps {
  user: AppUser | null;
  isAdmin: boolean;
  notifications: AppNotification[];
  benefits: CustomerBenefit[];
  accounts: UserProfile[];
  activePromoCode: string;
  onApplyPromoCode: (code: string) => void;
  pushPermission: PushPermissionState;
  onEnablePush: () => Promise<void>;
  onRequireSignIn: () => void;
  onOpenOrderTracking: (orderId: string) => void;
  onNotifyToast: (msg: string) => void;
}

export function NotificationsView({
  user,
  isAdmin,
  notifications,
  benefits,
  accounts,
  activePromoCode,
  onApplyPromoCode,
  pushPermission,
  onEnablePush,
  onRequireSignIn,
  onOpenOrderTracking,
  onNotifyToast,
}: NotificationsViewProps) {
  const [filterType, setFilterType] = useState<'all' | NotificationType>('all');
  const [markingAll, setMarkingAll] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [editingBenefit, setEditingBenefit] = useState<CustomerBenefit | null>(null);
  const [confirmDeleteBenefitId, setConfirmDeleteBenefitId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const filtered = notifications.filter((n) => (filterType === 'all' ? true : n.type === filterType));
  const unreadMine = notifications.filter((n) => !n.read && n.userId === user?.uid);

  const visibleCustomerBenefits = useMemo(() => {
    if (isAdmin) return benefits;
    const now = new Date();
    return benefits.filter((b) => {
      const isOwnedByMe = Boolean(user) && b.createdBy === user?.uid;
      if (isOwnedByMe) return true;
      return (
        b.active &&
        !isBenefitExpired(b, now) &&
        (b.targetUserId === 'all' || (Boolean(user) && b.targetUserId === user?.uid))
      );
    });
  }, [benefits, isAdmin, user]);

  const activeBenefitsCount = useMemo(() => {
    const now = new Date();
    return benefits.filter(
      (b) =>
        b.active &&
        !isBenefitExpired(b, now) &&
        (isAdmin || b.targetUserId === 'all' || (Boolean(user) && b.targetUserId === user?.uid)),
    ).length;
  }, [benefits, isAdmin, user]);

  async function handleMarkAllRead() {
    if (!user || unreadMine.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(unreadMine.map((n) => markNotificationRead(n.id)));
      onNotifyToast('Todas tus notificaciones fueron marcadas como leídas.');
    } finally {
      setMarkingAll(false);
    }
  }

  function handleTestPush() {
    const sent = sendBrowserPush(
      'Infourqui Mercado — Alerta de prueba',
      'Las notificaciones push del navegador funcionan correctamente en tiempo real.',
      'infourqui-test-push',
    );
    if (sent) {
      onNotifyToast('Notificación push enviada al sistema operativo.');
    } else {
      onNotifyToast('Primero activá el permiso de notificaciones en tu navegador.');
    }
  }

  function handleCopyPromoCode(code: string) {
    if (!code) return;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedCode(code);
    onNotifyToast(`Código ${code} copiado.`);
    window.setTimeout(() => {
      setCopiedCode((curr) => (curr === code ? null : curr));
    }, 2000);
  }

  async function handleQuickToggleBenefit(benefit: CustomerBenefit) {
    try {
      await createOrUpdateBenefit({
        id: benefit.id,
        title: benefit.title,
        description: benefit.description,
        type: benefit.type,
        targetUserId: benefit.targetUserId,
        targetUserName: benefit.targetUserName,
        promoCode: benefit.promoCode,
        discountPercent: benefit.discountPercent,
        minOrderAmount: benefit.minOrderAmount,
        maxInstallments: benefit.maxInstallments,
        expiresAt: benefit.expiresAt || '',
        active: !benefit.active,
      });
      onNotifyToast(!benefit.active ? 'Beneficio activado.' : 'Beneficio pausado.');
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos actualizar el beneficio.',
      );
    }
  }

  async function handleQuickDeleteBenefit(benefitId: string) {
    try {
      await deleteBenefitById(benefitId);
      setConfirmDeleteBenefitId(null);
      onNotifyToast('Beneficio eliminado.');
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos eliminar el beneficio.',
      );
    }
  }

  function renderIcon(type: NotificationType) {
    switch (type) {
      case 'shipment':
        return <Truck className="w-4 h-4 text-blue-700 shrink-0" />;
      case 'order':
        return <Package className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'promo':
        return <Tag className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'inventory':
        return <Bell className="w-4 h-4 text-zinc-700 shrink-0" />;
    }
  }

  function renderBenefitIcon(type: CustomerBenefit['type']) {
    switch (type) {
      case 'installments':
        return <CreditCard className="w-4 h-4 text-blue-700 shrink-0" />;
      case 'promo_code':
        return <Tag className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'min_amount_discount':
        return <Percent className="w-4 h-4 text-emerald-700 shrink-0" />;
    }
  }

  function typeLabel(type: NotificationType): string {
    switch (type) {
      case 'shipment':
        return 'Envío';
      case 'order':
        return 'Pedido';
      case 'promo':
        return 'Beneficio';
      case 'inventory':
        return 'Inventario';
    }
  }

  const showBenefitsWorkspace = filterType === 'promo';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950">
            Centro de alertas y beneficios
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Recibí actualizaciones de pagos y envíos, y consultá cuotas sin interés, códigos y
            descuentos por monto disponibles para tu cuenta.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user && (
            <button
              type="button"
              onClick={() => {
                setEditingBenefit(null);
                setManagerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {isAdmin ? 'ABM de Beneficios' : 'Gestionar descuentos (ABM)'}
            </button>
          )}

          {unreadMine.length > 0 && (
            <button
              type="button"
              disabled={markingAll}
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar todo leído ({unreadMine.length})
            </button>
          )}
        </div>
      </div>

      {/* Browser Push Configuration Strip */}
      <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <BellRing className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              Notificaciones push del navegador:{' '}
              <span
                className={
                  pushPermission === 'granted'
                    ? 'text-emerald-700'
                    : pushPermission === 'denied'
                      ? 'text-red-600'
                      : 'text-amber-700'
                }
              >
                {pushPermission === 'granted'
                  ? 'Activas'
                  : pushPermission === 'denied'
                    ? 'Bloqueadas en el navegador'
                    : pushPermission === 'unsupported'
                      ? 'No compatibles en este dispositivo'
                      : 'Pendientes de activación'}
              </span>
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Activá las notificaciones nativas para enterarte cuando tu envío pase a depósito,
              tránsito o reparto local.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {pushPermission === 'granted' ? (
            <button
              type="button"
              onClick={handleTestPush}
              className="px-4 py-2 text-xs font-medium text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Probar alerta push
            </button>
          ) : pushPermission !== 'unsupported' ? (
            <button
              type="button"
              onClick={onEnablePush}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Activar notificaciones push
            </button>
          ) : null}
        </div>
      </div>

      {!user ? (
        <div className="mt-8 space-y-6">
          {/* Global store benefits visible even before sign-in */}
          {visibleCustomerBenefits.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Gift className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-base font-bold text-zinc-950">
                  Beneficios generales vigentes
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleCustomerBenefits.map((benefit) => (
                  <div
                    key={benefit.id}
                    className="p-4 border border-zinc-200 rounded-xl bg-zinc-50/70"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700 mb-1">
                      {renderBenefitIcon(benefit.type)}
                      <span>{getBenefitTypeLabel(benefit.type)}</span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-950">{benefit.title}</p>
                    {benefit.description && (
                      <p className="text-xs text-zinc-600 mt-1">{benefit.description}</p>
                    )}
                    {formatExpirationDate(benefit.expiresAt) && (
                      <p className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500 mt-1.5">
                        <Calendar className="w-3 h-3" />
                        Válido hasta {formatExpirationDate(benefit.expiresAt)}
                      </p>
                    )}
                    {benefit.type === 'promo_code' && benefit.promoCode && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs font-mono font-semibold bg-amber-50 border border-amber-200 rounded text-amber-900">
                          {benefit.promoCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => onApplyPromoCode(benefit.promoCode)}
                          className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                        >
                          Aplicar al carrito
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
            <Bell className="w-9 h-9 text-zinc-300 mx-auto mb-3 stroke-[1.5]" />
            <h2 className="font-display text-lg font-bold text-zinc-950 mb-1.5">
              Iniciá sesión para ver tus alertas y beneficios personalizados
            </h2>
            <p className="text-sm text-zinc-600 mb-6 max-w-md mx-auto">
              Tus confirmaciones de compra, novedades de envío en vivo y descuentos exclusivos de
              tu cuenta se sincronizan de forma privada.
            </p>
            <button
              type="button"
              onClick={onRequireSignIn}
              className="px-5 py-2.5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              Ingresar con mi cuenta
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Filter Segmented Control */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg w-fit overflow-x-auto max-w-full">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'shipment', label: 'Envíos' },
                  { id: 'order', label: 'Pedidos' },
                  {
                    id: 'promo',
                    label:
                      activeBenefitsCount > 0
                        ? `Beneficios (${activeBenefitsCount})`
                        : 'Beneficios',
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterType(tab.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    filterType === tab.id
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filterType !== 'promo' && (
              <button
                type="button"
                onClick={() => setFilterType('promo')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                <Gift className="w-3.5 h-3.5" />
                {isAdmin
                  ? `Gestionar beneficios (${benefits.length})`
                  : activeBenefitsCount > 0
                    ? `Ver y gestionar beneficios (${activeBenefitsCount} vigentes) →`
                    : 'Crear o gestionar beneficios →'}
              </button>
            )}
          </div>

          {/* Dedicated Benefits Section (ABM for Admin & Clients + Active Benefits) */}
          {showBenefitsWorkspace && (
            <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200">
                <div>
                  <h2 className="font-display text-lg font-bold text-zinc-950 flex items-center gap-2">
                    <Gift className="w-5 h-5 text-blue-700" />
                    {isAdmin ? 'Gestión de Beneficios (ABM)' : 'Beneficios y Mis Descuentos (ABM)'}
                  </h2>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {isAdmin
                      ? 'Administrá cuotas sin interés, códigos promocionales y porcentajes de descuento por monto para cada cliente o para toda la tienda.'
                      : 'Consultá los beneficios vigentes para tu cuenta y creá o editá tus propios descuentos para asignarlos a tus productos.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingBenefit(null);
                    setManagerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nuevo beneficio / ABM
                </button>
              </div>

              {visibleCustomerBenefits.length === 0 ? (
                <div className="py-8 text-center">
                  <Gift className="w-8 h-8 text-zinc-300 mx-auto mb-2 stroke-[1.5]" />
                  <p className="text-sm font-semibold text-zinc-900">
                    Todavía no hay beneficios cargados
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                    Creá cuotas sin interés, códigos de descuento o descuentos automáticos por monto
                    con fecha de vencimiento para aplicarlos en tus productos.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBenefit(null);
                      setManagerOpen(true);
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Crear primer beneficio
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleCustomerBenefits.map((benefit) => {
                    const isPersonal = benefit.targetUserId !== 'all';
                    const expired = isBenefitExpired(benefit);
                    const formattedExpiry = formatExpirationDate(benefit.expiresAt);
                    const isCodeApplied =
                      benefit.type === 'promo_code' &&
                      Boolean(benefit.promoCode) &&
                      activePromoCode.trim().toUpperCase() ===
                        benefit.promoCode.trim().toUpperCase();

                    return (
                      <div
                        key={benefit.id}
                        className={`p-4 border rounded-xl flex flex-col justify-between gap-3 ${
                          benefit.active && !expired
                            ? 'border-zinc-200 bg-zinc-50/60'
                            : 'border-zinc-200 bg-zinc-100/70 opacity-75'
                        }`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              {renderBenefitIcon(benefit.type)}
                              <span className="text-[11px] font-semibold text-zinc-700">
                                {getBenefitTypeLabel(benefit.type)}
                              </span>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                isPersonal ? 'text-blue-700' : 'text-zinc-500'
                              }`}
                            >
                              {isPersonal ? (
                                <User className="w-3 h-3" />
                              ) : (
                                <Users className="w-3 h-3" />
                              )}
                              {isAdmin
                                ? benefit.targetUserName
                                : isPersonal
                                  ? 'Exclusivo para vos'
                                  : 'Todos los clientes'}
                            </span>
                          </div>

                          <p className="text-sm font-bold text-zinc-950">{benefit.title}</p>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono">
                            {benefit.type === 'installments' && (
                              <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-800 rounded font-semibold">
                                Hasta {benefit.maxInstallments} cuotas sin interés
                              </span>
                            )}
                            {benefit.type === 'promo_code' && (
                              <>
                                <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-900 rounded font-semibold">
                                  {benefit.promoCode}
                                </span>
                                <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded font-semibold">
                                  {benefit.discountPercent}% OFF
                                </span>
                              </>
                            )}
                            {benefit.type === 'min_amount_discount' && (
                              <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded font-semibold">
                                {benefit.discountPercent}% OFF en compras ≥{' '}
                                {formatCurrency(benefit.minOrderAmount)}
                              </span>
                            )}
                            {benefit.type !== 'min_amount_discount' &&
                              benefit.minOrderAmount > 0 && (
                                <span className="text-[11px] text-zinc-500">
                                  Compra mín. {formatCurrency(benefit.minOrderAmount)}
                                </span>
                              )}
                          </div>

                          {formattedExpiry && (
                            <p
                              className={`mt-2 inline-flex items-center gap-1 text-[11px] font-mono ${
                                expired ? 'text-red-600 font-semibold' : 'text-zinc-500'
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                              {expired
                                ? `Vencido el ${formattedExpiry}`
                                : `Válido hasta el ${formattedExpiry}`}
                            </p>
                          )}

                          {benefit.description && (
                            <p className="text-xs text-zinc-600 mt-2 leading-relaxed">
                              {benefit.description}
                            </p>
                          )}
                        </div>

                        <div className="pt-2.5 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2">
                          {/* Customer quick actions */}
                          <div className="flex items-center gap-2">
                            {benefit.type === 'promo_code' &&
                              benefit.promoCode &&
                              benefit.active &&
                              !expired && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onApplyPromoCode(benefit.promoCode)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                                      isCodeApplied
                                        ? 'bg-emerald-700 text-white'
                                        : 'bg-zinc-950 text-white hover:bg-blue-700'
                                    }`}
                                  >
                                    {isCodeApplied ? 'Aplicado en carrito' : 'Aplicar al carrito'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyPromoCode(benefit.promoCode)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                                  >
                                    <Copy className="w-3 h-3" />
                                    {copiedCode === benefit.promoCode ? 'Copiado' : 'Copiar'}
                                  </button>
                                </>
                              )}
                            {benefit.type === 'min_amount_discount' &&
                              benefit.active &&
                              !expired && (
                                <span className="text-[11px] font-medium text-emerald-700">
                                  Se aplica automáticamente al comprar
                                </span>
                              )}
                            {benefit.type === 'installments' && benefit.active && !expired && (
                              <span className="text-[11px] font-medium text-blue-700">
                                Disponible en la pasarela de pagos
                              </span>
                            )}
                            {expired ? (
                              <span className="text-[11px] font-semibold text-red-600">
                                Vencido
                              </span>
                            ) : !benefit.active ? (
                              <span className="text-[11px] font-semibold text-zinc-500">
                                Pausado
                              </span>
                            ) : null}
                          </div>

                          {/* Admin or Owner quick ABM actions */}
                          {(isAdmin || (Boolean(user) && benefit.createdBy === user.uid)) && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleQuickToggleBenefit(benefit)}
                                className="px-2 py-1 text-[11px] font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-md cursor-pointer"
                              >
                                {benefit.active ? 'Pausar' : 'Activar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBenefit(benefit);
                                  setManagerOpen(true);
                                }}
                                title="Editar beneficio"
                                aria-label="Editar beneficio"
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-600 hover:text-blue-700 hover:bg-white border border-transparent hover:border-zinc-200 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {confirmDeleteBenefitId === benefit.id ? (
                                <div className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() => void handleQuickDeleteBenefit(benefit.id)}
                                    className="font-semibold text-red-700 hover:underline cursor-pointer"
                                  >
                                    Borrar
                                  </button>
                                  <span className="text-zinc-300">/</span>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteBenefitId(null)}
                                    className="text-zinc-600 hover:underline cursor-pointer"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteBenefitId(benefit.id)}
                                  title="Eliminar beneficio"
                                  aria-label="Eliminar beneficio"
                                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Notifications List */}
          {filtered.length === 0 ? (
            !showBenefitsWorkspace && (
              <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-12 text-center">
                <p className="text-sm font-semibold text-zinc-900 mb-1">
                  No tenés alertas en esta categoría
                </p>
                <p className="text-xs text-zinc-500">
                  Cuando compres o tu envío cambie de etapa, las notificaciones aparecerán aquí.
                </p>
              </div>
            )
          ) : (
            <div className="mt-6">
              {showBenefitsWorkspace && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                  Avisos promocionales recibidos
                </h3>
              )}
              <ul className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-200 overflow-hidden">
                {filtered.map((notif) => {
                  const isPersonal = notif.userId === user.uid;
                  return (
                    <li
                      key={notif.id}
                      className={`p-5 flex items-start justify-between gap-4 transition-colors ${
                        !notif.read && isPersonal ? 'bg-blue-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="mt-0.5">{renderIcon(notif.type)}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 mb-1">
                            <span className="font-medium text-zinc-700">
                              {typeLabel(notif.type)}
                            </span>
                            <span>·</span>
                            <span className="font-mono tabular-nums">
                              {formatDateTime(notif.createdAt)}
                            </span>
                            {!notif.read && isPersonal && (
                              <>
                                <span>·</span>
                                <span className="font-medium text-blue-700">Nueva</span>
                              </>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-zinc-950">{notif.title}</p>
                          <p className="text-sm text-zinc-600 mt-1 leading-relaxed">
                            {notif.message}
                          </p>
                          {notif.orderId && (
                            <button
                              type="button"
                              onClick={() => onOpenOrderTracking(notif.orderId)}
                              className="mt-2.5 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                            >
                              Ver seguimiento del envío →
                            </button>
                          )}
                        </div>
                      </div>

                      {isPersonal && (
                        <div className="flex items-center gap-1 shrink-0">
                          {!notif.read && (
                            <button
                              type="button"
                              onClick={() => void markNotificationRead(notif.id)}
                              title="Marcar como leída"
                              aria-label="Marcar como leída"
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-blue-700 hover:bg-zinc-100 cursor-pointer"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void deleteNotificationById(notif.id)}
                            title="Eliminar notificación"
                            aria-label="Eliminar notificación"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-zinc-100 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {user && (
        <BenefitsManagerModal
          open={managerOpen}
          onClose={() => {
            setManagerOpen(false);
            setEditingBenefit(null);
          }}
          user={user}
          isAdmin={isAdmin}
          benefits={benefits}
          accounts={accounts}
          initialEditBenefit={editingBenefit}
          onNotifyToast={onNotifyToast}
        />
      )}
    </div>
  );
}
