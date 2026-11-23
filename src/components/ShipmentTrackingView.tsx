import { useEffect, useState } from 'react';
import { Check, FileCheck2, MapPin, Package, Search, Truck, X, XCircle } from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  getShipmentStatusMeta,
} from '../lib/validation';
import { cancelCustomerOrder, lookupOrderByCode } from '../services/dataService';
import { SHIPMENT_PIPELINE, type AppUser, type Order } from '../types/ecommerce';
import { ProductImage } from './ProductImage';

interface ShipmentTrackingViewProps {
  user: AppUser | null;
  isAdmin: boolean;
  orders: Order[];
  initialSelectedOrderId: string | null;
  onRequireSignIn: () => void;
  onNotifyToast: (msg: string) => void;
}

export function ShipmentTrackingView({
  user,
  isAdmin,
  orders,
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

  useEffect(() => {
    if (initialSelectedOrderId) {
      setSelectedOrderId(initialSelectedOrderId);
      setLookupResult(null);
    }
  }, [initialSelectedOrderId]);

  const activeOrder: Order | null =
    lookupResult ||
    orders.find((o) => o.id === selectedOrderId) ||
    (orders.length > 0 ? orders[0] : null);

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

        <form onSubmit={handleCodeLookup} className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-72">
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
            Iniciá sesión con tu cuenta de Google para visualizar todos tus pedidos activos, fechas
            estimadas de entrega y comprobantes de pago.
          </p>
          <button
            type="button"
            onClick={onRequireSignIn}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
          >
            Ingresar con Google
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
                {isAdmin ? 'Pedidos registrados' : 'Mis pedidos'} ({orders.length})
              </h2>
            </div>

            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
              {orders.map((order) => {
                const isSelected = activeOrder?.id === order.id;
                const statusMeta = getShipmentStatusMeta(order.shipmentStatus);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(order.id);
                      setLookupResult(null);
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-950 text-white border-zinc-950'
                        : 'bg-white text-zinc-950 border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                      <span
                        className={`text-xs font-medium ${
                          isSelected ? 'text-blue-300' : statusMeta.colorClass
                        }`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                    <p
                      className={`font-mono text-xs mb-2 ${
                        isSelected ? 'text-zinc-300' : 'text-zinc-500'
                      }`}
                    >
                      {order.trackingCode}
                    </p>
                    <div
                      className={`flex items-center justify-between text-xs pt-2 border-t ${
                        isSelected
                          ? 'border-zinc-800 text-zinc-300'
                          : 'border-zinc-100 text-zinc-500'
                      }`}
                    >
                      <span className="truncate pr-2">
                        {order.items.length} {order.items.length === 1 ? 'artículo' : 'artículos'} ·{' '}
                        {order.shippingCity}
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

                <div className="sm:text-right">
                  <p className="text-xs text-zinc-500">Código de seguimiento</p>
                  <p className="font-mono text-base font-bold text-zinc-950">
                    {activeOrder.trackingCode}
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Entrega estimada:{' '}
                    <span className="font-medium text-zinc-950">
                      {activeOrder.estimatedDelivery}
                    </span>
                  </p>
                </div>
              </div>

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
                <h3 className="text-sm font-semibold text-zinc-950 mb-4">
                  Historial de movimientos
                </h3>
                <ol className="space-y-4 border-l border-zinc-200 ml-2.5 pl-6">
                  {[...activeOrder.trackingEvents].reverse().map((ev, idx) => (
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
                    </li>
                  ))}
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
                    <span className="text-zinc-500">Domicilio</span>
                    <span className="font-medium text-zinc-900 text-right">
                      {activeOrder.shippingAddress}, {activeOrder.shippingCity}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Pago</span>
                    <span className="font-medium text-zinc-900 text-right">
                      {activeOrder.paymentMethod === 'cash'
                        ? 'Efectivo (pago al recibir)'
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

      {/* Lightbox Modal for Transfer Receipt */}
      {receiptLightboxOpen && activeOrder?.paymentReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/65 backdrop-blur-[1px]"
            onClick={() => setReceiptLightboxOpen(false)}
          />
          <div className="relative z-10 w-full max-w-2xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
              <h3 className="font-display text-sm font-bold text-zinc-950">
                Comprobante — Pedido {activeOrder.orderNumber}
              </h3>
              <button
                type="button"
                onClick={() => setReceiptLightboxOpen(false)}
                aria-label="Cerrar comprobante"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-zinc-50 flex justify-center">
              <img
                src={activeOrder.paymentReceipt.imageUrl}
                alt={`Comprobante de transferencia ${activeOrder.orderNumber}`}
                className="max-h-[72vh] w-auto object-contain rounded-lg border border-zinc-200 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
