import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CreditCard,
  FileCheck2,
  MapPin,
  Package,
  Printer,
  Truck,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  getShipmentStatusMeta,
  getVehicleTypeLabel,
} from '../lib/validation';
import type { Order, OrderItem, PaymentMethod, PaymentStatus } from '../types/ecommerce';
import { VehicleTypeIcon } from './DeliveryAgentsManagerModal';
import { ProductImage } from './ProductImage';

export function getPaymentMethodLabel(order: Order): string {
  const isPickup =
    order.deliveryMethod === 'pickup' || order.carrier === 'Retiro en domicilio';
  const method: PaymentMethod = order.paymentMethod;
  switch (method) {
    case 'transfer':
      return `Transferencia bancaria${order.paymentBrand ? ` (${order.paymentBrand})` : ''}`;
    case 'card':
      return `Tarjeta ${order.paymentBrand}${order.paymentLast4 ? ` ···· ${order.paymentLast4}` : ''}${
        order.installments > 1 ? ` · ${order.installments} cuotas` : ' · 1 pago'
      }`;
    case 'wallet':
      return `Billetera virtual${order.paymentBrand ? ` (${order.paymentBrand})` : ''}`;
    case 'cash':
      return isPickup ? 'Efectivo (al retirar)' : 'Efectivo (pago al recibir)';
  }
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'approved':
      return 'Pago aprobado';
    case 'pending_transfer':
      return 'Transferencia registrada / pendiente de validación';
    case 'pending_cash':
      return 'Pendiente de cobro en efectivo';
    case 'refunded':
      return 'Reembolsado';
  }
}

interface ShippingTicketContentProps {
  order: Order;
  items: OrderItem[];
}

function ShippingTicketContent({ order, items }: ShippingTicketContentProps) {
  const isPickup =
    order.deliveryMethod === 'pickup' || order.carrier === 'Retiro en domicilio';
  const statusMeta = getShipmentStatusMeta(order.shipmentStatus);
  const receipt = order.paymentReceipt;
  const isPartialSellerOrder = items.length < order.items.length;
  const sellerItemsSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="bg-white text-zinc-950 p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b-2 border-zinc-950">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
            Infourqui Mercado · Comprobante logístico
          </p>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-zinc-950 mt-0.5">
            Ticket de envío
          </h2>
          <p className="text-xs text-zinc-600 mt-1">
            Estado actual: <span className="font-semibold text-zinc-950">{statusMeta.label}</span>
          </p>
        </div>

        <div className="text-left sm:text-right font-mono text-xs space-y-0.5">
          <p className="text-[11px] text-zinc-500">Pedido</p>
          <p className="text-sm font-bold text-zinc-950">{order.orderNumber}</p>
          <p className="text-[11px] text-zinc-500 pt-1">Código de seguimiento</p>
          <p className="text-sm font-bold text-blue-800">{order.trackingCode}</p>
          {order.createdAt && (
            <p className="text-[11px] text-zinc-500 pt-1">
              Emitido: {formatDateTime(order.createdAt)}
            </p>
          )}
        </div>
      </div>

      {/* Products with Photo */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-zinc-700" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800">
            {isPartialSellerOrder
              ? `Tus artículos en este envío (${items.length})`
              : `Productos del envío (${items.length})`}
          </h3>
        </div>

        <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-200 overflow-hidden">
          {items.map((item, idx) => (
            <div
              key={`${item.productId}-${idx}`}
              className="p-3.5 flex items-center gap-3.5 bg-white"
            >
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-white border border-zinc-200 shrink-0 flex items-center justify-center">
                <ProductImage
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-full h-full object-contain object-center"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-950 leading-snug">{item.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Cantidad:{' '}
                  <span className="font-mono font-semibold text-zinc-800">{item.quantity} u.</span>{' '}
                  · Precio unitario:{' '}
                  <span className="font-mono text-zinc-800">{formatCurrency(item.price)}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-zinc-500">Subtotal</p>
                <p className="font-mono text-sm font-bold text-zinc-950 tabular-nums">
                  {formatCurrency(item.price * item.quantity)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Amounts Summary */}
        <div className="mt-3 p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1.5 text-xs">
          {isPartialSellerOrder ? (
            <>
              <div className="flex justify-between text-zinc-800 font-semibold">
                <span>Subtotal de tus artículos</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(sellerItemsSubtotal)}
                </span>
              </div>
              <div className="flex justify-between pt-2 mt-1 border-t border-zinc-300 text-sm font-bold text-zinc-950">
                <span>Importe total del pedido</span>
                <span className="font-mono tabular-nums">{formatCurrency(order.total)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal de productos</span>
                <span className="font-mono tabular-nums">{formatCurrency(order.subtotal)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Descuento aplicado</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-zinc-600">
                <span>Costo de envío</span>
                <span className="font-mono tabular-nums">
                  {order.shippingCost === 0 ? 'Gratis' : formatCurrency(order.shippingCost)}
                </span>
              </div>
              <div className="flex justify-between pt-2 mt-1 border-t border-zinc-300 text-base font-bold text-zinc-950">
                <span>Importe total</span>
                <span className="font-mono tabular-nums">{formatCurrency(order.total)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payment & Shipping Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Payment Method & Data */}
        <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
            <CreditCard className="w-4 h-4 text-zinc-700" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800">
              Medio y datos de pago
            </h3>
          </div>

          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 shrink-0">Medio de pago</dt>
              <dd className="font-semibold text-zinc-950 text-right">
                {getPaymentMethodLabel(order)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 shrink-0">Estado</dt>
              <dd className="font-medium text-zinc-900 text-right">
                {getPaymentStatusLabel(order.paymentStatus)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 shrink-0">ID transacción</dt>
              <dd className="font-mono text-zinc-900 text-right break-all">
                {order.transactionId}
              </dd>
            </div>

            {receipt && (
              <div className="pt-2 mt-2 border-t border-zinc-100 space-y-1.5">
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  Datos de transferencia
                </p>
                {receipt.bankName && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Banco / Billetera</dt>
                    <dd className="font-medium text-zinc-950 text-right">{receipt.bankName}</dd>
                  </div>
                )}
                {receipt.operationNumber && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">N.º de operación</dt>
                    <dd className="font-mono font-semibold text-zinc-950 text-right">
                      {receipt.operationNumber}
                    </dd>
                  </div>
                )}
                {receipt.payerName && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Titular / Pagador</dt>
                    <dd className="font-medium text-zinc-950 text-right">{receipt.payerName}</dd>
                  </div>
                )}
                {receipt.transferDate && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Fecha transf.</dt>
                    <dd className="font-medium text-zinc-950 text-right">{receipt.transferDate}</dd>
                  </div>
                )}
                {receipt.destinationAccount && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Cuenta destino</dt>
                    <dd className="font-medium text-zinc-950 text-right break-all">
                      {receipt.destinationAccount}
                    </dd>
                  </div>
                )}
                {receipt.amountDetected && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Monto comprobante</dt>
                    <dd className="font-mono font-semibold text-zinc-950 text-right">
                      {receipt.amountDetected}
                    </dd>
                  </div>
                )}
              </div>
            )}
          </dl>
        </div>

        {/* Shipping Method & Recipient */}
        <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
            <Truck className="w-4 h-4 text-zinc-700" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800">
              Medio de envío y destino
            </h3>
          </div>

          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 shrink-0">Modalidad</dt>
              <dd className="font-semibold text-zinc-950 text-right">
                {isPickup ? 'Retiro en domicilio' : 'Envío a domicilio'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 shrink-0">Transporte</dt>
              <dd className="font-medium text-zinc-950 text-right">{order.carrier}</dd>
            </div>

            {order.assignedCourier && (
              <div className="p-2.5 my-1 rounded-lg bg-zinc-50 border border-zinc-200 space-y-1">
                <p className="text-[11px] font-semibold text-zinc-700 flex items-center gap-1.5">
                  <VehicleTypeIcon
                    vehicleType={order.assignedCourier.vehicleType}
                    className="w-3.5 h-3.5 text-blue-700"
                  />
                  <span>
                    {getVehicleTypeLabel(order.assignedCourier.vehicleType)} · Patente{' '}
                    <span className="font-mono font-bold text-zinc-950">
                      {order.assignedCourier.licensePlate}
                    </span>
                  </span>
                </p>
                <p className="text-xs font-semibold text-zinc-950">
                  Responsable: {order.assignedCourier.fullName}
                </p>
              </div>
            )}

            <div className="pt-2 mt-2 border-t border-zinc-100 space-y-1.5">
              <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-700">
                <MapPin className="w-3.5 h-3.5" />
                Datos del destinatario
              </p>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500 shrink-0">Cliente</dt>
                <dd className="font-semibold text-zinc-950 text-right">{order.customerName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500 shrink-0">Teléfono</dt>
                <dd className="font-mono text-zinc-900 text-right">{order.shippingPhone}</dd>
              </div>
              {!isPickup && (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Domicilio</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {order.shippingAddress}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">Localidad / CP</dt>
                    <dd className="font-medium text-zinc-900 text-right">
                      {order.shippingCity} ({order.shippingPostalCode})
                    </dd>
                  </div>
                </>
              )}
              {order.shippingNotes && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500 shrink-0">Indicaciones</dt>
                  <dd className="text-zinc-700 text-right">{order.shippingNotes}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500 shrink-0">Entrega estimada</dt>
                <dd className="font-medium text-zinc-900 text-right">{order.estimatedDelivery}</dd>
              </div>
            </div>
          </dl>
        </div>
      </div>

      {/* Footer note */}
      <div className="pt-3 border-t border-dashed border-zinc-300 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span>Infourqui Mercado · Ticket de envío y control de entrega</span>
        <span className="font-mono">
          {order.orderNumber} / {order.trackingCode}
        </span>
      </div>
    </div>
  );
}

interface ShippingTicketModalProps {
  order: Order | null;
  sellerItems?: OrderItem[];
  onClose: () => void;
}

export function ShippingTicketModal({ order, sellerItems, onClose }: ShippingTicketModalProps) {
  const displayItems = sellerItems !== undefined ? sellerItems : order?.items ?? [];
  const canRender = Boolean(order && displayItems.length > 0);

  useEffect(() => {
    if (!canRender) return;
    document.body.classList.add('printing-shipping-ticket');
    return () => {
      document.body.classList.remove('printing-shipping-ticket');
    };
  }, [canRender]);

  if (!canRender || !order) return null;

  function handlePrint() {
    window.print();
  }

  return (
    <>
      {/* On-screen Interactive Preview Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
        <div
          className="fixed inset-0 bg-zinc-950/60 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <div className="relative z-10 w-full max-w-3xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-200 bg-zinc-50">
            <div className="flex items-center gap-2 min-w-0">
              <Printer className="w-4 h-4 text-blue-700 shrink-0" />
              <h3 className="font-display text-sm font-bold text-zinc-950 truncate">
                Vista previa — Ticket de envío {order.orderNumber}
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                Imprimir ticket
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar vista previa del ticket"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-200/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto bg-zinc-100/80 p-4 sm:p-6">
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
              <ShippingTicketContent order={order} items={displayItems} />
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Print-Only Portal mounted directly on document.body */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div id="shipping-ticket-print-root" className="hidden print:block bg-white">
            <ShippingTicketContent order={order} items={displayItems} />
          </div>,
          document.body,
        )}
    </>
  );
}
