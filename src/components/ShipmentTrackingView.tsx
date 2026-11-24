import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Edit3,
  FileCheck2,
  MapPin,
  Package,
  Plus,
  Printer,
  Search,
  Settings2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  getNextShipmentStatus,
  getPreviousShipmentStatus,
  getShipmentStatusMeta,
  getVehicleTypeLabel,
} from '../lib/validation';
import {
  advanceOrderShipmentStatus,
  cancelCustomerOrder,
  lookupOrderByCode,
  revertOrderShipmentStatus,
} from '../services/dataService';
import {
  SHIPMENT_PIPELINE,
  type AppUser,
  type AssignedCourier,
  type DeliveryAgent,
  type Order,
  type OrderItem,
  type Product,
  type ShipmentStatus,
} from '../types/ecommerce';
import {
  DeliveryAgentsManagerModal,
  VehicleTypeIcon,
} from './DeliveryAgentsManagerModal';
import { ProductImage } from './ProductImage';
import {
  ShippingTicketModal,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
} from './ShippingTicketModal';

function getDefaultAdvanceDetails(
  order: Order,
  nextStatus: ShipmentStatus,
): { location: string; note: string } {
  const isPickup =
    order.deliveryMethod === 'pickup' || order.carrier === 'Retiro en domicilio';

  if (isPickup) {
    switch (nextStatus) {
      case 'preparing':
        return {
          location: 'Local Infourqui Mercado — Armado de pedido',
          note: 'Estamos preparando tu pedido para retiro en domicilio.',
        };
      case 'in_transit':
        return {
          location: 'Punto de Retiro Infourqui Mercado',
          note: 'Pedido empaquetado y listo en el mostrador de entregas.',
        };
      case 'out_for_delivery':
        return {
          location: 'Punto de Retiro — Disponible para retirar',
          note: 'Tu pedido ya se encuentra listo para retirar en domicilio.',
        };
      case 'delivered':
        return {
          location: 'Retirado en domicilio',
          note: 'Pedido retirado conforme por el cliente.',
        };
      default:
        return {
          location: 'Plataforma Infourqui Mercado',
          note: 'Actualización de estado del pedido.',
        };
    }
  }

  const citySuffix = order.shippingCity ? ` — ${order.shippingCity}` : '';
  switch (nextStatus) {
    case 'preparing':
      return {
        location: 'Depósito Central Barracas',
        note: 'Pedido en preparación y embalaje en depósito.',
      };
    case 'in_transit':
      return {
        location: 'Centro de Clasificación Norte — Pacheco',
        note: 'Despachado en tránsito hacia el centro de distribución de destino.',
      };
    case 'out_for_delivery':
      return {
        location: `Sucursal de Reparto Local${citySuffix}`,
        note: 'En vehículo de reparto rumbo al domicilio del destinatario.',
      };
    case 'delivered':
      return {
        location: `Domicilio del destinatario${citySuffix}`,
        note: 'Paquete entregado y recibido conforme.',
      };
    default:
      return {
        location: 'Plataforma Infourqui Mercado',
        note: 'Actualización logística del envío.',
      };
  }
}

function getSellerItemsForOrder(
  order: Order | null,
  productsById: Map<string, Product>,
  user: AppUser | null,
  isAdmin: boolean,
): OrderItem[] {
  if (!order || !user) return [];
  return order.items.filter((item) => {
    const resolvedSellerId =
      item.sellerId?.trim() || productsById.get(item.productId)?.sellerId?.trim() || '';
    if (resolvedSellerId) {
      return resolvedSellerId === user.uid;
    }
    return isAdmin;
  });
}

interface ShipmentTrackingViewProps {
  user: AppUser | null;
  isAdmin: boolean;
  orders: Order[];
  products: Product[];
  deliveryAgents: DeliveryAgent[];
  initialSelectedOrderId: string | null;
  onRequireSignIn: () => void;
  onNotifyToast: (msg: string) => void;
}

export function ShipmentTrackingView({
  user,
  isAdmin,
  orders,
  products,
  deliveryAgents,
  initialSelectedOrderId,
  onRequireSignIn,
  onNotifyToast,
}: ShipmentTrackingViewProps) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialSelectedOrderId);
  const [searchCode, setSearchCode] = useState('');
  const [lookupResult, setLookupResult] = useState<Order | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [receiptLightboxOpen, setReceiptLightboxOpen] = useState(false);
  const [shippingTicketOpen, setShippingTicketOpen] = useState(false);
  const [agentsModalOpen, setAgentsModalOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [showCustomAdvance, setShowCustomAdvance] = useState(false);
  const [customLocation, setCustomLocation] = useState('');
  const [customNote, setCustomNote] = useState('');

  useEffect(() => {
    if (initialSelectedOrderId) {
      setSelectedOrderId(initialSelectedOrderId);
      setLookupResult(null);
    }
  }, [initialSelectedOrderId]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const activeOrder: Order | null =
    lookupResult ||
    orders.find((o) => o.id === selectedOrderId) ||
    (orders.length > 0 ? orders[0] : null);

  const sellerItemsForActiveOrder = useMemo(
    () => getSellerItemsForOrder(activeOrder, productsById, user, isAdmin),
    [activeOrder, productsById, user, isAdmin],
  );
  const canViewShippingTicket = Boolean(
    user && activeOrder && sellerItemsForActiveOrder.length > 0,
  );
  const canManageActiveOrderShipment = Boolean(
    user && activeOrder && (isAdmin || sellerItemsForActiveOrder.length > 0),
  );
  const hasAnySellerOrders = useMemo(
    () =>
      !isAdmin &&
      Boolean(user) &&
      orders.some(
        (order) =>
          order.userId !== user?.uid &&
          getSellerItemsForOrder(order, productsById, user, isAdmin).length > 0,
      ),
    [isAdmin, user, orders, productsById],
  );

  const nextShipmentStatus = activeOrder
    ? getNextShipmentStatus(activeOrder.shipmentStatus)
    : null;
  const nextStageMeta = nextShipmentStatus
    ? getShipmentStatusMeta(nextShipmentStatus)
    : null;
  const previousShipmentStatus = activeOrder
    ? getPreviousShipmentStatus(activeOrder.shipmentStatus)
    : null;
  const previousStageMeta = previousShipmentStatus
    ? getShipmentStatusMeta(previousShipmentStatus)
    : null;

  const ownDeliveryAgents = useMemo(
    () =>
      !user
        ? []
        : deliveryAgents.filter(
            (a) => a.ownerId === user.uid || (!a.ownerId && isAdmin),
          ),
    [deliveryAgents, user, isAdmin],
  );
  const availableAgents = ownDeliveryAgents.filter((a) => a.active);

  useEffect(() => {
    if (!canViewShippingTicket) {
      setShippingTicketOpen(false);
    }
  }, [activeOrder?.id, canViewShippingTicket]);

  useEffect(() => {
    setAdvanceError('');
    setShowCustomAdvance(false);
    setSelectedAgentId(activeOrder?.assignedCourier?.agentId || '');
    if (activeOrder && nextShipmentStatus) {
      const defaults = getDefaultAdvanceDetails(activeOrder, nextShipmentStatus);
      setCustomLocation(defaults.location);
      setCustomNote(defaults.note);
    } else {
      setCustomLocation('');
      setCustomNote('');
    }
  }, [activeOrder?.id, activeOrder?.shipmentStatus, activeOrder?.assignedCourier?.agentId, nextShipmentStatus]);

  async function handleCodeLookup(e: React.FormEvent) {
    e.preventDefault();
    setSearchError('');
    const code = searchCode.trim().toUpperCase();
    if (!code) {
      setLookupResult(null);
      return;
    }

    const localMatch = orders.find(
      (o) => o.trackingCode.toUpperCase() === code || o.orderNumber.toUpperCase() === code,
    );
    if (localMatch) {
      setSelectedOrderId(localMatch.id);
      setLookupResult(null);
      return;
    }

    if (!user) {
      setSearchError('Iniciá sesión para consultar envíos asociados a tu cuenta.');
      return;
    }

    setSearching(true);
    try {
      const found = await lookupOrderByCode(code, user.uid, isAdmin);
      if (found) {
        setLookupResult(found);
        setSelectedOrderId(found.id);
      } else {
        setSearchError(`No encontramos ningún envío con el código "${code}".`);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleCancelOrder(order: Order) {
    setCancellingId(order.id);
    try {
      await cancelCustomerOrder(order);
      onNotifyToast(`El pedido ${order.orderNumber} fue cancelado.`);
    } finally {
      setCancellingId(null);
    }
  }

  async function handleAdvanceNextStage() {
    if (!activeOrder || !nextShipmentStatus || !canManageActiveOrderShipment || advancing || reverting) return;
    setAdvanceError('');
    setAdvancing(true);
    try {
      const defaults = getDefaultAdvanceDetails(activeOrder, nextShipmentStatus);
      const chosenAgent =
        nextShipmentStatus === 'preparing' && selectedAgentId
          ? ownDeliveryAgents.find((a) => a.id === selectedAgentId)
          : undefined;

      const assignedCourier: AssignedCourier | undefined = chosenAgent
        ? {
            agentId: chosenAgent.id,
            fullName: chosenAgent.fullName,
            vehicleType: chosenAgent.vehicleType,
            licensePlate: chosenAgent.licensePlate,
          }
        : undefined;

      const location = (showCustomAdvance ? customLocation.trim() : '') || defaults.location;
      const courierNoteSuffix = assignedCourier
        ? ` Repartidor asignado: ${assignedCourier.fullName} (${getVehicleTypeLabel(
            assignedCourier.vehicleType,
          )} · Patente ${assignedCourier.licensePlate}).`
        : '';
      const baseNote = (showCustomAdvance ? customNote.trim() : '') || defaults.note;
      const note = `${baseNote}${
        assignedCourier && !baseNote.includes(assignedCourier.licensePlate) ? courierNoteSuffix : ''
      }`.slice(0, 200);

      await advanceOrderShipmentStatus(
        activeOrder,
        nextShipmentStatus,
        location,
        note,
        assignedCourier,
      );

      if (lookupResult && user) {
        if (orders.some((o) => o.id === activeOrder.id)) {
          setLookupResult(null);
        } else {
          const refreshed = await lookupOrderByCode(activeOrder.trackingCode, user.uid, isAdmin);
          if (refreshed) setLookupResult(refreshed);
        }
      }

      const stageMeta = getShipmentStatusMeta(nextShipmentStatus);
      setShowCustomAdvance(false);
      onNotifyToast(
        assignedCourier
          ? `Seguimiento ${activeOrder.orderNumber} avanzado a "${stageMeta.label}" — Envío asignado a ${assignedCourier.fullName}.`
          : `Seguimiento ${activeOrder.orderNumber} avanzado a "${stageMeta.label}".`,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No pudimos avanzar al próximo seguimiento en este momento.';
      setAdvanceError(msg);
      onNotifyToast(msg);
    } finally {
      setAdvancing(false);
    }
  }

  async function handleRevertPreviousStage() {
    if (!activeOrder || !previousShipmentStatus || !canManageActiveOrderShipment || advancing || reverting) return;
    setAdvanceError('');
    setReverting(true);
    try {
      await revertOrderShipmentStatus(activeOrder);

      if (lookupResult && user) {
        if (orders.some((o) => o.id === activeOrder.id)) {
          setLookupResult(null);
        } else {
          const refreshed = await lookupOrderByCode(activeOrder.trackingCode, user.uid, isAdmin);
          if (refreshed) setLookupResult(refreshed);
        }
      }

      const prevMeta = getShipmentStatusMeta(previousShipmentStatus);
      setShowCustomAdvance(false);
      onNotifyToast(
        `Seguimiento ${activeOrder.orderNumber} retrocedido a "${prevMeta.label}".`,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No pudimos retroceder el seguimiento en este momento.';
      setAdvanceError(msg);
      onNotifyToast(msg);
    } finally {
      setReverting(false);
    }
  }

  const currentStageIndex = activeOrder
    ? SHIPMENT_PIPELINE.findIndex((s) => s.status === activeOrder.shipmentStatus)
    : -1;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header & Lookup Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-zinc-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950">
            Seguimiento de envíos
          </h1>
          <p className="text-sm text-zinc-600 mt-1.5 max-w-xl">
            Consultá el recorrido de tus paquetes en tiempo real. Cada cambio de estado en depósito
            o distribución se sincroniza al instante y dispara una alerta push.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full lg:w-auto">
          {user && (
            <button
              type="button"
              onClick={() => setAgentsModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Settings2 className="w-4 h-4 text-blue-700" />
              <span>Mis medios de envío ({ownDeliveryAgents.length})</span>
            </button>
          )}
          <form onSubmit={handleCodeLookup} className="flex flex-col sm:flex-row gap-2.5 flex-1">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                placeholder="Ej. TRK-84K9M2P1 o ALB-2026-8401"
                className="w-full pl-9 pr-3 py-2.5 text-sm font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 uppercase"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="px-5 py-2.5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {searching ? 'Buscando...' : 'Rastrear envío'}
            </button>
          </form>
        </div>
      </div>

      {searchError && (
        <div className="mt-4 p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {searchError}
        </div>
      )}

      {!user ? (
        <div className="mt-10 bg-white border border-zinc-200 rounded-xl p-10 text-center max-w-lg mx-auto">
          <Truck className="w-10 h-10 text-zinc-400 mx-auto mb-3 stroke-[1.5]" />
          <h2 className="font-display text-lg font-bold text-zinc-950 mb-1.5">
            Accedé al historial de tus envíos
          </h2>
          <p className="text-sm text-zinc-600 mb-6">
            Iniciá sesión con tu cuenta local o de Google para visualizar todos tus pedidos activos,
            fechas estimadas de entrega y comprobantes de pago.
          </p>
          <button
            type="button"
            onClick={onRequireSignIn}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
          >
            Ingresar con mi cuenta
          </button>
        </div>
      ) : orders.length === 0 && !activeOrder ? (
        <div className="mt-10 bg-white border border-zinc-200 rounded-xl p-12 text-center max-w-lg mx-auto">
          <Package className="w-10 h-10 text-zinc-300 mx-auto mb-3 stroke-[1.5]" />
          <h2 className="font-display text-lg font-bold text-zinc-950 mb-1.5">
            Todavía no registrás pedidos
          </h2>
          <p className="text-sm text-zinc-500">
            Cuando realices una compra en el catálogo, vas a poder monitorear el paquete paso a paso
            desde esta pantalla.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8">
          {/* Left: Orders List */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="flex items-center justify-between pb-2">
              <h2 className="text-xs font-semibold text-zinc-700">
                {isAdmin
                  ? 'Pedidos registrados'
                  : hasAnySellerOrders
                    ? 'Mis pedidos y ventas'
                    : 'Mis pedidos'}{' '}
                ({orders.length})
              </h2>
            </div>

            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
              {orders.map((order) => {
                const isSelected = activeOrder?.id === order.id;
                const statusMeta = getShipmentStatusMeta(order.shipmentStatus);
                const firstItem = order.items[0];
                const extraItemsCount = Math.max(0, order.items.length - 1);
                const isSellerOrderForUser =
                  !isAdmin &&
                  Boolean(user) &&
                  order.userId !== user?.uid &&
                  getSellerItemsForOrder(order, productsById, user, isAdmin).length > 0;
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(order.id);
                      setLookupResult(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-950 text-white border-zinc-950'
                        : 'bg-white text-zinc-950 border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {firstItem && (
                        <div
                          className={`relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border ${
                            isSelected
                              ? 'border-zinc-800 bg-zinc-900'
                              : 'border-zinc-200 bg-zinc-100'
                          }`}
                        >
                          <ProductImage
                            src={firstItem.imageUrl}
                            alt={firstItem.name}
                            className="w-full h-full object-cover"
                          />
                          {extraItemsCount > 0 && (
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-950/85 text-white leading-none">
                              +{extraItemsCount}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="font-mono text-xs font-semibold truncate">
                            {order.orderNumber}
                          </span>
                          <span
                            className={`text-[11px] font-medium shrink-0 ${
                              isSelected ? 'text-blue-300' : statusMeta.colorClass
                            }`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>

                        {firstItem && (
                          <p
                            className={`text-xs font-medium truncate ${
                              isSelected ? 'text-white' : 'text-zinc-900'
                            }`}
                          >
                            {firstItem.name}
                            {extraItemsCount > 0 ? ` (+${extraItemsCount})` : ''}
                          </p>
                        )}

                        <p
                          className={`font-mono text-[11px] mt-0.5 flex items-center gap-2 ${
                            isSelected ? 'text-zinc-400' : 'text-zinc-500'
                          }`}
                        >
                          <span>{order.trackingCode}</span>
                          {isSellerOrderForUser && (
                            <span
                              className={`font-sans text-[10px] font-semibold uppercase tracking-wide ${
                                isSelected ? 'text-emerald-300' : 'text-emerald-700'
                              }`}
                            >
                              · Venta
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex items-center justify-between text-xs pt-2 mt-2.5 border-t ${
                        isSelected
                          ? 'border-zinc-800 text-zinc-300'
                          : 'border-zinc-100 text-zinc-500'
                      }`}
                    >
                      <span className="truncate pr-2">
                        {order.items.length} {order.items.length === 1 ? 'artículo' : 'artículos'} ·{' '}
                        {order.deliveryMethod === 'pickup' || order.carrier === 'Retiro en domicilio'
                          ? 'Retiro en domicilio'
                          : order.shippingCity}
                      </span>
                      <span className="font-mono font-medium tabular-nums shrink-0">
                        {formatCurrency(order.total)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Live Tracking Detail */}
          {activeOrder && (
            <div className="lg:col-span-8 bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-8">
              {/* Top Shipment Summary */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-zinc-200">
                <div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                    <span className="font-mono">{activeOrder.orderNumber}</span>
                    <span>·</span>
                    <span>{activeOrder.carrier}</span>
                  </div>
                  <h2 className="font-display text-2xl font-bold text-zinc-950">
                    {activeOrder.shipmentStatus === 'cancelled'
                      ? 'Envío cancelado'
                      : getShipmentStatusMeta(activeOrder.shipmentStatus).label}
                  </h2>
                  <p className="text-sm text-zinc-600 mt-1 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-blue-700 shrink-0" />
                    <span>{activeOrder.currentLocation}</span>
                  </p>
                </div>

                <div className="sm:text-right flex flex-col sm:items-end gap-1">
                  <p className="text-xs text-zinc-500">Código de seguimiento</p>
                  <p className="font-mono text-base font-bold text-zinc-950">
                    {activeOrder.trackingCode}
                  </p>
                  <p className="text-xs text-zinc-600">
                    Entrega estimada:{' '}
                    <span className="font-medium text-zinc-950">
                      {activeOrder.estimatedDelivery}
                    </span>
                  </p>
                  {canViewShippingTicket && (
                    <button
                      type="button"
                      onClick={() => setShippingTicketOpen(true)}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-900 bg-zinc-100 hover:bg-zinc-950 hover:text-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Imprimir ticket de envío
                    </button>
                  )}
                </div>
              </div>

              {/* Assigned Delivery Agent Banner */}
              {activeOrder.assignedCourier && (
                <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-blue-700 text-white inline-flex items-center justify-center shrink-0">
                      <VehicleTypeIcon
                        vehicleType={activeOrder.assignedCourier.vehicleType}
                        className="w-4 h-4"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-blue-800 uppercase tracking-wide">
                        Responsable del envío asignado
                      </p>
                      <p className="text-sm font-semibold text-zinc-950 truncate">
                        {activeOrder.assignedCourier.fullName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-md bg-white border border-blue-200 font-medium text-zinc-800">
                      {getVehicleTypeLabel(activeOrder.assignedCourier.vehicleType)}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-zinc-950 text-white font-mono font-semibold">
                      {activeOrder.assignedCourier.licensePlate}
                    </span>
                  </div>
                </div>
              )}

              {/* 5-Stage Visual Logistics Stepper */}
              {activeOrder.shipmentStatus === 'cancelled' ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-sm text-red-700">
                  <XCircle className="w-5 h-5 shrink-0" />
                  <span>Este pedido fue cancelado antes de su despacho logístico.</span>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                    {SHIPMENT_PIPELINE.map((stage, idx) => {
                      const completed = idx <= currentStageIndex;
                      const isCurrent = idx === currentStageIndex;
                      return (
                        <div key={stage.status} className="relative">
                          <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-semibold shrink-0 transition-colors ${
                                isCurrent
                                  ? 'bg-blue-700 text-white'
                                  : completed
                                    ? 'bg-zinc-950 text-white'
                                    : 'bg-zinc-100 text-zinc-400 border border-zinc-200'
                              }`}
                            >
                              {completed ? <Check className="w-4 h-4" /> : idx + 1}
                            </div>
                            <div className="min-w-0">
                              <p
                                className={`text-xs font-semibold leading-snug ${
                                  completed ? 'text-zinc-950' : 'text-zinc-400'
                                }`}
                              >
                                {stage.shortLabel}
                              </p>
                              <p className="text-[11px] text-zinc-500 hidden sm:block mt-0.5 leading-snug">
                                {stage.description}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chronological Tracking Log */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-950">
                      Historial de movimientos
                    </h3>
                    {canManageActiveOrderShipment && (nextStageMeta || previousStageMeta) && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {nextStageMeta ? (
                          <>
                            Siguiente etapa:{' '}
                            <span className="font-medium text-zinc-800">{nextStageMeta.label}</span>
                          </>
                        ) : (
                          'Envío en etapa final.'
                        )}
                      </p>
                    )}
                  </div>

                  {canManageActiveOrderShipment && (previousShipmentStatus || nextShipmentStatus) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {previousShipmentStatus && previousStageMeta && (
                        <button
                          type="button"
                          disabled={advancing || reverting}
                          onClick={() => void handleRevertPreviousStage()}
                          title={`Volver a "${previousStageMeta.label}"`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-100 border border-zinc-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>{reverting ? 'Retrocediendo...' : 'Retroceder seguimiento'}</span>
                        </button>
                      )}

                      {nextShipmentStatus && nextStageMeta && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowCustomAdvance((v) => !v)}
                            disabled={advancing || reverting}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {showCustomAdvance ? 'Ocultar detalle' : 'Editar detalle'}
                          </button>
                          <button
                            type="button"
                            disabled={advancing || reverting}
                            onClick={() => void handleAdvanceNextStage()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-55 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <span>{advancing ? 'Avanzando...' : 'Próximo seguimiento'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Courier assignment selector when advancing to Preparado (preparing) */}
                {canManageActiveOrderShipment && nextShipmentStatus === 'preparing' && (
                  <div className="mb-4 p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="assign-delivery-agent"
                        className="text-xs font-semibold text-zinc-950"
                      >
                        ¿Quién realiza el envío al pasar a Preparando?
                      </label>
                      <button
                        type="button"
                        onClick={() => setAgentsModalOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Cargar / gestionar mis medios</span>
                      </button>
                    </div>

                    <select
                      id="assign-delivery-agent"
                      value={selectedAgentId}
                      onChange={(e) => setSelectedAgentId(e.target.value)}
                      disabled={advancing || reverting}
                      className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    >
                      <option value="">Sin asignar (despacho estándar)</option>
                      {availableAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {getVehicleTypeLabel(agent.vehicleType)} · {agent.fullName} — Patente{' '}
                          {agent.licensePlate}
                        </option>
                      ))}
                    </select>

                    {availableAgents.length === 0 && (
                      <p className="text-[11px] text-zinc-600">
                        Todavía no tenés medios de envío propios disponibles cargados. Usá{' '}
                        <strong>Cargar / gestionar mis medios</strong> para registrar tu moto, auto
                        o utilitario.
                      </p>
                    )}
                  </div>
                )}

                {canManageActiveOrderShipment && nextShipmentStatus && nextStageMeta && showCustomAdvance && (
                  <div className="mb-5 p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="next-tracking-location"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Ubicación del nuevo movimiento
                        </label>
                        <input
                          id="next-tracking-location"
                          type="text"
                          value={customLocation}
                          onChange={(e) => setCustomLocation(e.target.value)}
                          maxLength={120}
                          placeholder="Ej. Sucursal de Reparto Local"
                          className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="next-tracking-note"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Nota para el historial y cliente
                        </label>
                        <input
                          id="next-tracking-note"
                          type="text"
                          value={customNote}
                          onChange={(e) => setCustomNote(e.target.value)}
                          maxLength={200}
                          placeholder="Detalle del movimiento"
                          className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={advancing || reverting}
                        onClick={() => void handleAdvanceNextStage()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-55 rounded-lg transition-colors cursor-pointer"
                      >
                        <span>
                          {advancing ? 'Guardando...' : `Confirmar: ${nextStageMeta.label}`}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {advanceError && (
                  <div className="mb-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                    {advanceError}
                  </div>
                )}

                <ol className="space-y-4 border-l border-zinc-200 ml-2.5 pl-6">
                  {[...activeOrder.trackingEvents].reverse().map((ev, idx) => {
                    const isConfirmedTransfer =
                      ev.status === 'confirmed' && activeOrder.paymentMethod === 'transfer';
                    const receipt = activeOrder.paymentReceipt;

                    return (
                      <li key={`${ev.timestampIso}-${idx}`} className="relative">
                        <span
                          className={`w-2.5 h-2.5 rounded-full absolute -left-[29px] top-1.5 ${
                            idx === 0 ? 'bg-blue-700' : 'bg-zinc-300'
                          }`}
                        />
                        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                          <p className="text-sm font-semibold text-zinc-950">{ev.label}</p>
                          <span className="font-mono text-xs text-zinc-500 tabular-nums">
                            {formatDateTime(ev.timestampIso)}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-600 mt-0.5">{ev.note}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">{ev.location}</p>

                        {isConfirmedTransfer && (
                          <div className="mt-3 p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-200/90 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-950">
                                <FileCheck2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                <span>Datos del pago por transferencia</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {receipt && (
                                  <button
                                    type="button"
                                    onClick={() => setReceiptLightboxOpen(true)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 bg-white hover:bg-emerald-700 hover:text-white border border-emerald-300 rounded-md transition-colors cursor-pointer"
                                  >
                                    <FileCheck2 className="w-3 h-3" />
                                    Ver ticket de pago
                                  </button>
                                )}
                                {canViewShippingTicket && (
                                  <button
                                    type="button"
                                    onClick={() => setShippingTicketOpen(true)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-zinc-800 bg-white hover:bg-zinc-950 hover:text-white border border-zinc-300 rounded-md transition-colors cursor-pointer"
                                  >
                                    <Printer className="w-3 h-3" />
                                    Ticket de envío
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3">
                              {receipt && (
                                <button
                                  type="button"
                                  onClick={() => setReceiptLightboxOpen(true)}
                                  aria-label="Ver ticket de pago ampliado"
                                  className="w-20 h-24 rounded-lg overflow-hidden bg-white border border-emerald-200 hover:border-blue-700 transition-colors shrink-0 cursor-pointer"
                                >
                                  <img
                                    src={receipt.imageUrl}
                                    alt={`Ticket de pago ${activeOrder.orderNumber}`}
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              )}

                              <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                <div>
                                  <p className="text-[11px] text-zinc-500">Medio / Estado</p>
                                  <p className="font-medium text-zinc-950">
                                    {getPaymentMethodLabel(activeOrder)} ·{' '}
                                    {getPaymentStatusLabel(activeOrder.paymentStatus)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-zinc-500">
                                    Importe / ID transacción
                                  </p>
                                  <p className="font-mono font-semibold text-zinc-950">
                                    {formatCurrency(activeOrder.total)} ·{' '}
                                    <span className="font-normal text-zinc-600">
                                      {activeOrder.transactionId}
                                    </span>
                                  </p>
                                </div>

                                {receipt ? (
                                  <>
                                    {receipt.bankName && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">
                                          Banco / Billetera
                                        </p>
                                        <p className="font-medium text-zinc-950">
                                          {receipt.bankName}
                                        </p>
                                      </div>
                                    )}
                                    {receipt.operationNumber && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">
                                          N.º de operación
                                        </p>
                                        <p className="font-mono font-semibold text-zinc-950">
                                          {receipt.operationNumber}
                                        </p>
                                      </div>
                                    )}
                                    {receipt.payerName && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">
                                          Titular / Pagador
                                        </p>
                                        <p className="font-medium text-zinc-950">
                                          {receipt.payerName}
                                        </p>
                                      </div>
                                    )}
                                    {receipt.transferDate && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">
                                          Fecha de transferencia
                                        </p>
                                        <p className="font-medium text-zinc-950">
                                          {receipt.transferDate}
                                        </p>
                                      </div>
                                    )}
                                    {receipt.destinationAccount && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">Cuenta destino</p>
                                        <p className="font-medium text-zinc-950 truncate">
                                          {receipt.destinationAccount}
                                        </p>
                                      </div>
                                    )}
                                    {receipt.amountDetected && (
                                      <div>
                                        <p className="text-[11px] text-zinc-500">
                                          Monto del comprobante
                                        </p>
                                        <p className="font-mono font-semibold text-zinc-950">
                                          {receipt.amountDetected}
                                        </p>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="sm:col-span-2 text-[11px] text-zinc-600">
                                    Transferencia registrada sin imagen de ticket adjunta.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* Items & Receipt Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-zinc-200">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-900 mb-3">
                    Productos incluidos
                  </h3>
                  <ul className="space-y-3">
                    {activeOrder.items.map((item, idx) => (
                      <li key={`${item.productId}-${idx}`} className="flex items-center gap-3">
                        <div className="w-12 h-10 rounded-md overflow-hidden bg-zinc-100 shrink-0">
                          <ProductImage
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-zinc-950 truncate">{item.name}</p>
                          <p className="text-[11px] text-zinc-500 font-mono tabular-nums">
                            {item.quantity} × {formatCurrency(item.price)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2 text-xs">
                  <h3 className="text-xs font-semibold text-zinc-900 mb-3">
                    Comprobante y destino
                  </h3>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Destinatario</span>
                    <span className="font-medium text-zinc-900">{activeOrder.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Modalidad</span>
                    <span className="font-medium text-zinc-900 text-right">
                      {activeOrder.deliveryMethod === 'pickup' ||
                      activeOrder.carrier === 'Retiro en domicilio'
                        ? 'Retiro en domicilio'
                        : 'Envío a domicilio'}
                    </span>
                  </div>
                  {!(
                    activeOrder.deliveryMethod === 'pickup' ||
                    activeOrder.carrier === 'Retiro en domicilio'
                  ) && (
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500 shrink-0">Domicilio</span>
                      <span className="font-medium text-zinc-900 text-right">
                        {activeOrder.shippingAddress}, {activeOrder.shippingCity}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Pago</span>
                    <span className="font-medium text-zinc-900 text-right">
                      {activeOrder.paymentMethod === 'cash'
                        ? activeOrder.deliveryMethod === 'pickup' ||
                          activeOrder.carrier === 'Retiro en domicilio'
                          ? 'Efectivo (al retirar)'
                          : 'Efectivo (pago al recibir)'
                        : activeOrder.paymentMethod === 'transfer'
                          ? `${activeOrder.paymentBrand}${activeOrder.paymentReceipt ? ' · Comprobante adjunto' : ''}`
                          : `${activeOrder.paymentBrand} ···· ${activeOrder.paymentLast4}`}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-zinc-100 text-sm font-bold text-zinc-950">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(activeOrder.total)}
                    </span>
                  </div>

                  {activeOrder.shipmentStatus === 'confirmed' &&
                    activeOrder.userId === user.uid && (
                      <div className="pt-3">
                        <button
                          type="button"
                          disabled={cancellingId === activeOrder.id}
                          onClick={() => handleCancelOrder(activeOrder)}
                          className="text-xs font-medium text-red-600 hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {cancellingId === activeOrder.id
                            ? 'Cancelando pedido...'
                            : 'Cancelar pedido antes del despacho'}
                        </button>
                      </div>
                    )}
                </div>
              </div>

              {/* Saved Transfer Payment Receipt & Extracted Info */}
              {activeOrder.paymentReceipt && (
                <div className="pt-6 border-t border-zinc-200">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-emerald-700" />
                      <h3 className="text-xs font-semibold text-zinc-950">
                        Comprobante de transferencia registrado
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReceiptLightboxOpen(true)}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Ampliar comprobante
                    </button>
                  </div>

                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col sm:flex-row gap-4">
                    <button
                      type="button"
                      onClick={() => setReceiptLightboxOpen(true)}
                      className="w-24 h-28 rounded-lg overflow-hidden bg-white border border-zinc-200 shrink-0 hover:border-blue-700 transition-colors cursor-pointer"
                      aria-label="Ver imagen completa del comprobante"
                    >
                      <img
                        src={activeOrder.paymentReceipt.imageUrl}
                        alt="Comprobante de transferencia"
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {activeOrder.paymentReceipt.bankName && (
                        <div>
                          <p className="text-[11px] text-zinc-500">Banco / Billetera</p>
                          <p className="font-medium text-zinc-950">
                            {activeOrder.paymentReceipt.bankName}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.operationNumber && (
                        <div>
                          <p className="text-[11px] text-zinc-500">N° de operación</p>
                          <p className="font-mono font-medium text-zinc-950">
                            {activeOrder.paymentReceipt.operationNumber}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.amountDetected && (
                        <div>
                          <p className="text-[11px] text-zinc-500">Monto leído</p>
                          <p className="font-mono font-semibold text-zinc-950">
                            {activeOrder.paymentReceipt.amountDetected}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.transferDate && (
                        <div>
                          <p className="text-[11px] text-zinc-500">Fecha de transferencia</p>
                          <p className="font-medium text-zinc-950">
                            {activeOrder.paymentReceipt.transferDate}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.payerName && (
                        <div>
                          <p className="text-[11px] text-zinc-500">Titular / Pagador</p>
                          <p className="font-medium text-zinc-950">
                            {activeOrder.paymentReceipt.payerName}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.destinationAccount && (
                        <div>
                          <p className="text-[11px] text-zinc-500">Cuenta destino</p>
                          <p className="font-medium text-zinc-950 truncate">
                            {activeOrder.paymentReceipt.destinationAccount}
                          </p>
                        </div>
                      )}
                      {activeOrder.paymentReceipt.summary && (
                        <div className="sm:col-span-2 pt-1 border-t border-zinc-200/80">
                          <p className="text-[11px] text-zinc-500">Lectura automática</p>
                          <p className="text-zinc-700 mt-0.5">{activeOrder.paymentReceipt.summary}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lightbox Modal for Transfer Receipt / Ticket de Pago */}
      {receiptLightboxOpen && activeOrder?.paymentReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/65 backdrop-blur-[1px]"
            onClick={() => setReceiptLightboxOpen(false)}
          />
          <div className="relative z-10 w-full max-w-2xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
              <h3 className="font-display text-sm font-bold text-zinc-950">
                Ticket de pago — Pedido {activeOrder.orderNumber}
              </h3>
              <button
                type="button"
                onClick={() => setReceiptLightboxOpen(false)}
                aria-label="Cerrar ticket de pago"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-zinc-50 space-y-4">
              <div className="flex justify-center">
                <img
                  src={activeOrder.paymentReceipt.imageUrl}
                  alt={`Ticket de pago por transferencia ${activeOrder.orderNumber}`}
                  className="max-h-[58vh] w-auto object-contain rounded-lg border border-zinc-200 bg-white"
                />
              </div>
              <div className="p-4 rounded-xl bg-white border border-zinc-200 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {activeOrder.paymentReceipt.bankName && (
                  <div>
                    <p className="text-[11px] text-zinc-500">Banco / Billetera</p>
                    <p className="font-medium text-zinc-950">
                      {activeOrder.paymentReceipt.bankName}
                    </p>
                  </div>
                )}
                {activeOrder.paymentReceipt.operationNumber && (
                  <div>
                    <p className="text-[11px] text-zinc-500">N.º de operación</p>
                    <p className="font-mono font-semibold text-zinc-950">
                      {activeOrder.paymentReceipt.operationNumber}
                    </p>
                  </div>
                )}
                {activeOrder.paymentReceipt.payerName && (
                  <div>
                    <p className="text-[11px] text-zinc-500">Titular / Pagador</p>
                    <p className="font-medium text-zinc-950">
                      {activeOrder.paymentReceipt.payerName}
                    </p>
                  </div>
                )}
                {activeOrder.paymentReceipt.transferDate && (
                  <div>
                    <p className="text-[11px] text-zinc-500">Fecha de transferencia</p>
                    <p className="font-medium text-zinc-950">
                      {activeOrder.paymentReceipt.transferDate}
                    </p>
                  </div>
                )}
                {activeOrder.paymentReceipt.destinationAccount && (
                  <div>
                    <p className="text-[11px] text-zinc-500">Cuenta destino</p>
                    <p className="font-medium text-zinc-950 break-all">
                      {activeOrder.paymentReceipt.destinationAccount}
                    </p>
                  </div>
                )}
                {activeOrder.paymentReceipt.amountDetected && (
                  <div>
                    <p className="text-[11px] text-zinc-500">Monto leído</p>
                    <p className="font-mono font-semibold text-zinc-950">
                      {activeOrder.paymentReceipt.amountDetected}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ShippingTicketModal
        order={shippingTicketOpen && canViewShippingTicket ? activeOrder : null}
        sellerItems={sellerItemsForActiveOrder}
        onClose={() => setShippingTicketOpen(false)}
      />

      {user && (
        <DeliveryAgentsManagerModal
          open={agentsModalOpen}
          user={user}
          agents={ownDeliveryAgents}
          onClose={() => setAgentsModalOpen(false)}
          onNotifyToast={onNotifyToast}
        />
      )}
    </div>
  );
}
