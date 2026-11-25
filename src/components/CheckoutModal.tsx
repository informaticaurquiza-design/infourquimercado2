import { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  FileCheck2,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { compressReceiptImage } from '../lib/imageTools';
import { sendBrowserPush } from '../lib/pushNotifications';
import { evaluateOrderBenefits, formatCurrency } from '../lib/validation';
import {
  createOrderWithInventoryUpdate,
  parseTransferReceipt,
  updateUserProfile,
} from '../services/dataService';
import type {
  AppUser,
  CartItem,
  CustomerBenefit,
  DeliveryMethod,
  Order,
  PaymentMethod,
  PaymentReceipt,
  StoreSettings,
  UserProfile,
} from '../types/ecommerce';

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  shippingSettings: StoreSettings;
  benefits: CustomerBenefit[];
  promoCode: string;
  user: AppUser | null;
  profile: UserProfile | null;
  onRequireSignIn: () => void;
  onOpenAccount?: () => void;
  onOrderSuccess: (order: Order) => void;
  onTrackOrder: (orderId: string) => void;
}

export function CheckoutModal({
  open,
  onClose,
  items,
  shippingSettings,
  benefits,
  promoCode,
  user,
  profile,
  onRequireSignIn,
  onOrderSuccess,
  onTrackOrder,
}: CheckoutModalProps) {
  const [step, setStep] = useState<'shipping' | 'payment' | 'processing' | 'receipt'>('shipping');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [shippingPhone, setShippingPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [shippingCity, setShippingCity] = useState('');
  const [shippingPostalCode, setShippingPostalCode] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [saveDefaultAddress, setSaveDefaultAddress] = useState(true);

  const [paymentMethod, setPaymentMethod] = useState<Extract<PaymentMethod, 'transfer' | 'cash'>>('transfer');
  const [selectedInstallments, setSelectedInstallments] = useState(1);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Cash payment state
  const [cashTendered, setCashTendered] = useState('');

  // Transfer receipt upload & parsed info state
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null);
  const receiptCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState('');
  const [receiptFileName, setReceiptFileName] = useState('');
  const [receiptOperationNumber, setReceiptOperationNumber] = useState('');
  const [receiptBankName, setReceiptBankName] = useState('');
  const [receiptAmountDetected, setReceiptAmountDetected] = useState('');
  const [receiptPayerName, setReceiptPayerName] = useState('');
  const [receiptTransferDate, setReceiptTransferDate] = useState('');
  const [receiptDestinationAccount, setReceiptDestinationAccount] = useState('');
  const [receiptSummary, setReceiptSummary] = useState('');
  const [parsingReceipt, setParsingReceipt] = useState(false);
  const [receiptReadStatus, setReceiptReadStatus] = useState<'idle' | 'success' | 'warning'>('idle');
  const [receiptReadMessage, setReceiptReadMessage] = useState('');

  const [errorMessage, setErrorMessage] = useState('');
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  function resetReceiptState() {
    setReceiptImageUrl('');
    setReceiptFileName('');
    setReceiptOperationNumber('');
    setReceiptBankName('');
    setReceiptAmountDetected('');
    setReceiptPayerName('');
    setReceiptTransferDate('');
    setReceiptDestinationAccount('');
    setReceiptSummary('');
    setParsingReceipt(false);
    setReceiptReadStatus('idle');
    setReceiptReadMessage('');
  }

  useEffect(() => {
    if (open) {
      setStep('shipping');
      setDeliveryMethod('delivery');
      setPaymentMethod('transfer');
      setSelectedInstallments(1);
      setErrorMessage('');
      setCompletedOrder(null);
      setCashTendered('');
      resetReceiptState();
      setCustomerName(profile?.displayName || user?.displayName || '');
      setShippingPhone(profile?.phone || '');
      setShippingAddress(profile?.defaultAddress || '');
      setShippingCity(profile?.defaultCity || '');
      setShippingPostalCode(profile?.defaultPostalCode || '');
    }
  }, [open, profile, user]);

  if (!open) return null;

  const threshold = Math.max(0, shippingSettings.freeShippingThreshold);
  const baseShippingCost = Math.max(0, shippingSettings.standardShippingCost);

  const subtotal = items.reduce((s, item) => s + item.price * item.quantity, 0);
  const benefitEval = evaluateOrderBenefits({
    subtotal,
    promoCode,
    benefits,
    userId: user?.uid,
  });
  const promoDiscount = benefitEval.promoDiscount;
  const thresholdDiscount = benefitEval.thresholdDiscount;
  const benefitDiscount = benefitEval.combinedBenefitDiscount;
  const transferDiscount =
    paymentMethod === 'transfer' ? Math.round(Math.max(0, subtotal - benefitDiscount) * 0.05) : 0;
  const totalDiscount = Math.min(subtotal, benefitDiscount + transferDiscount);
  const hasFreeShippingProduct = items.some((item) => item.freeShipping);
  const standardDeliveryCost =
    hasFreeShippingProduct || threshold === 0 || subtotal - totalDiscount >= threshold
      ? 0
      : baseShippingCost;
  const isPickup = deliveryMethod === 'pickup';
  const shippingCost = isPickup ? 0 : standardDeliveryCost;
  const total = Math.max(1, subtotal - totalDiscount + shippingCost);
  const effectiveInstallments = Math.min(selectedInstallments, benefitEval.maxInstallments);

  const parsedCashTendered = cashTendered.trim() ? Number(cashTendered) : NaN;
  const cashChangeDue =
    Number.isFinite(parsedCashTendered) && parsedCashTendered >= total
      ? parsedCashTendered - total
      : null;

  interface TransferAccountInfo {
    key: string;
    label: string;
    alias: string;
    cbuCvu: string;
    accountHolder: string;
  }

  const sellerAccountsMap = new Map<string, TransferAccountInfo>();
  for (const item of items) {
    const alias = (item.sellerBankAlias || '').trim();
    const cbuCvu = (item.sellerBankCbuCvu || '').trim();
    const accountHolder = (item.sellerBankAccountHolder || '').trim();
    if (!alias && !cbuCvu && !accountHolder) continue;
    const key =
      item.sellerId ||
      `${alias.toLowerCase()}|${cbuCvu.toLowerCase()}|${accountHolder.toLowerCase()}`;
    if (!sellerAccountsMap.has(key)) {
      sellerAccountsMap.set(key, {
        key,
        label: item.sellerName?.trim() || accountHolder || 'Cuenta del vendedor',
        alias,
        cbuCvu,
        accountHolder: accountHolder || item.sellerName?.trim() || '',
      });
    }
  }

  const transferAccounts: TransferAccountInfo[] = Array.from(sellerAccountsMap.values());
  if (transferAccounts.length === 0) {
    const profileAlias = (profile?.bankAlias || '').trim();
    const profileCbu = (profile?.bankCbuCvu || '').trim();
    const profileHolder = (profile?.bankAccountHolder || '').trim();
    if (profileAlias || profileCbu || profileHolder) {
      transferAccounts.push({
        key: `profile-${user?.uid || 'current'}`,
        label: 'Datos bancarios del cliente',
        alias: profileAlias,
        cbuCvu: profileCbu,
        accountHolder:
          profileHolder ||
          profile?.businessName?.trim() ||
          profile?.displayName?.trim() ||
          user?.displayName?.trim() ||
          '',
      });
    }
  }

  function handleCopyBankValue(fieldKey: string, value: string) {
    if (!value) return;
    void navigator.clipboard?.writeText(value);
    setCopiedField(fieldKey);
    window.setTimeout(() => {
      setCopiedField((curr) => (curr === fieldKey ? null : curr));
    }, 1800);
  }

  async function runReceiptRead(dataUrl: string) {
    setParsingReceipt(true);
    setReceiptReadStatus('idle');
    setReceiptReadMessage('');
    try {
      const info = await parseTransferReceipt(dataUrl);
      setReceiptOperationNumber(info.operationNumber);
      setReceiptBankName(info.bankName);
      setReceiptAmountDetected(info.amountDetected);
      setReceiptPayerName(info.payerName);
      setReceiptTransferDate(info.transferDate);
      setReceiptDestinationAccount(info.destinationAccount);
      setReceiptSummary(info.summary);
      setReceiptReadStatus('success');
      setReceiptReadMessage(
        info.summary || 'Información del comprobante leída automáticamente. Revisá los datos antes de confirmar.',
      );
    } catch (err) {
      setReceiptReadStatus('warning');
      setReceiptReadMessage(
        err instanceof Error
          ? err.message
          : 'No pudimos leer automáticamente el comprobante. Podés completar los datos manualmente y guardarlo igual.',
      );
    } finally {
      setParsingReceipt(false);
    }
  }

  async function handleReceiptFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage('');
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Seleccioná una imagen válida del comprobante (JPG, PNG o WebP).');
      return;
    }

    try {
      setParsingReceipt(true);
      setReceiptReadStatus('idle');
      setReceiptReadMessage('');
      const compressed = await compressReceiptImage(file);
      setReceiptImageUrl(compressed.dataUrl);
      setReceiptFileName(file.name.slice(0, 120));
      await runReceiptRead(compressed.dataUrl);
    } catch (err) {
      setParsingReceipt(false);
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos procesar la imagen del comprobante.',
      );
    }
  }

  function handleContinueToPayment(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');
    if (customerName.trim().length < 2) {
      setErrorMessage('Ingresá tu nombre completo.');
      return;
    }
    if (shippingPhone.trim().length < 6) {
      setErrorMessage('Ingresá un teléfono de contacto válido.');
      return;
    }
    if (
      deliveryMethod === 'delivery' &&
      (shippingAddress.trim().length < 4 ||
        shippingCity.trim().length < 2 ||
        shippingPostalCode.trim().length < 3)
    ) {
      setErrorMessage('Completá dirección, ciudad y código postal para coordinar el envío a domicilio.');
      return;
    }
    setStep('payment');
  }

  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');

    if (!user) {
      onRequireSignIn();
      return;
    }

    if (parsingReceipt) {
      setErrorMessage('Esperá unos segundos mientras terminamos de leer el comprobante.');
      return;
    }

    let brand = 'Transferencia CBU';
    let last4 = 'CBU1';
    const finalInstallments = Math.max(1, Math.min(12, effectiveInstallments));
    let finalNotes = shippingNotes.trim();
    if (finalInstallments > 1) {
      const instNote = `Plan de ${finalInstallments} cuotas sin interés (${formatCurrency(total / finalInstallments)} c/u)`;
      finalNotes = finalNotes ? `${finalNotes} · ${instNote}` : instNote;
    }
    let paymentReceipt: PaymentReceipt | undefined;

    if (paymentMethod === 'cash') {
      brand = 'Efectivo';
      last4 = 'EFEC';
      if (cashTendered.trim()) {
        if (!Number.isFinite(parsedCashTendered) || parsedCashTendered < total) {
          setErrorMessage(
            `El monto con el que abonás en efectivo debe ser al menos ${formatCurrency(total)}.`,
          );
          return;
        }
        const cashNote = `Efectivo: abona con ${formatCurrency(parsedCashTendered)} (vuelto ${formatCurrency(parsedCashTendered - total)})`;
        finalNotes = finalNotes ? `${finalNotes} · ${cashNote}` : cashNote;
      }
    } else {
      brand = receiptBankName.trim() ? `Transferencia · ${receiptBankName.trim()}`.slice(0, 32) : 'Transferencia CBU';
      const opDigits = receiptOperationNumber.replace(/[^a-zA-Z0-9]/g, '');
      last4 = (opDigits.slice(-4) || 'CBU1').slice(0, 4).toUpperCase();
      if (receiptImageUrl) {
        paymentReceipt = {
          imageUrl: receiptImageUrl,
          fileName: receiptFileName || 'comprobante-transferencia.jpg',
          operationNumber: receiptOperationNumber.trim(),
          bankName: receiptBankName.trim(),
          amountDetected: receiptAmountDetected.trim(),
          payerName: receiptPayerName.trim(),
          transferDate: receiptTransferDate.trim(),
          destinationAccount: receiptDestinationAccount.trim(),
          summary: receiptSummary.trim(),
          uploadedAt: new Date().toISOString(),
        };
      }
    }

    setStep('processing');

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 650));

      const created = await createOrderWithInventoryUpdate({
        user,
        cartItems: items,
        customerName,
        shippingPhone,
        shippingAddress: isPickup ? 'Retiro en domicilio' : shippingAddress,
        shippingCity: isPickup ? 'Retiro personal' : shippingCity,
        shippingPostalCode: isPickup ? 'RET' : shippingPostalCode,
        shippingNotes: finalNotes,
        deliveryMethod,
        subtotal,
        discount: totalDiscount,
        shippingCost,
        total,
        paymentMethod,
        paymentBrand: brand,
        paymentLast4: last4,
        installments: finalInstallments,
        paymentReceipt,
      });

      if (!isPickup && saveDefaultAddress) {
        void updateUserProfile(user.uid, {
          displayName: customerName,
          phone: shippingPhone,
          defaultAddress: shippingAddress,
          defaultCity: shippingCity,
          defaultPostalCode: shippingPostalCode,
        }).catch(() => {});
      } else if (isPickup) {
        void updateUserProfile(user.uid, {
          displayName: customerName,
          phone: shippingPhone,
        }).catch(() => {});
      }

      const deliveryTag =
        created.deliveryMethod === 'pickup' || created.carrier === 'Retiro en domicilio'
          ? 'Retiro en domicilio'
          : 'Envío a domicilio';
      const pushSubtitle =
        created.paymentMethod === 'cash'
          ? `${deliveryTag} · Efectivo (${formatCurrency(created.total)}). Código: ${created.trackingCode}`
          : created.paymentMethod === 'transfer'
            ? `${deliveryTag} · Transferencia (${formatCurrency(created.total)}). Código: ${created.trackingCode}`
            : `${deliveryTag} · Pago aprobado (${formatCurrency(created.total)}). Código: ${created.trackingCode}`;

      sendBrowserPush(`Pedido ${created.orderNumber} confirmado`, pushSubtitle, created.id);

      setCompletedOrder(created);
      onOrderSuccess(created);
      setStep('receipt');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'No pudimos completar la transacción. Verificá tu conexión e intentá nuevamente.',
      );
      setStep('payment');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-zinc-950/55 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-base font-bold text-zinc-950">
              Pasarela de pagos segura
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar pasarela de pagos"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auth Gate if not logged in */}
        {!user ? (
          <div className="p-8 text-center max-w-md mx-auto">
            <ShieldCheck className="w-10 h-10 text-blue-700 mx-auto mb-3 stroke-[1.5]" />
            <h3 className="font-display text-lg font-bold text-zinc-950 mb-2">
              Iniciá sesión para finalizar tu compra
            </h3>
            <p className="text-sm text-zinc-600 mb-6 leading-relaxed">
              Necesitamos vincular el pedido a tu cuenta verificada para emitir el comprobante,
              reservar el stock en tiempo real y enviarte alertas del envío.
            </p>
            <button
              type="button"
              onClick={onRequireSignIn}
              className="w-full py-3 px-4 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              Ingresar con mi cuenta
            </button>
          </div>
        ) : step === 'processing' ? (
          <div className="p-14 text-center">
            <div className="w-10 h-10 border-2 border-zinc-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-4" />
            <h3 className="font-display text-lg font-bold text-zinc-950 mb-1">
              Registrando pedido y reservando inventario
            </h3>
            <p className="text-sm text-zinc-500">
              Guardando operación, comprobante y descontando unidades en tiempo real...
            </p>
          </div>
        ) : step === 'receipt' && completedOrder ? (
          <div className="p-6 sm:p-8 overflow-y-auto">
            <div className="flex items-start gap-3 mb-6">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-xl font-bold text-zinc-950">
                  Pedido {completedOrder.orderNumber} confirmado
                </h3>
                <p className="text-sm text-zinc-600 mt-0.5">
                  El inventario fue actualizado al instante y enviamos la confirmación a tus
                  notificaciones.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 px-5 bg-zinc-50 border border-zinc-200 rounded-xl mb-6">
              <div>
                <p className="text-xs text-zinc-500">Código de seguimiento</p>
                <p className="font-mono text-sm font-semibold text-zinc-950 mt-0.5">
                  {completedOrder.trackingCode}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">ID de transacción</p>
                <p className="font-mono text-sm font-semibold text-zinc-950 mt-0.5">
                  {completedOrder.transactionId}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">
                  {completedOrder.paymentMethod === 'cash' ? 'Total a abonar' : 'Total del pedido'}
                </p>
                <p className="font-mono text-sm font-semibold text-zinc-950 mt-0.5 tabular-nums">
                  {formatCurrency(completedOrder.total)}
                </p>
              </div>
            </div>

            <div className="text-sm space-y-2 border-t border-zinc-200 pt-4 mb-6">
              <div className="flex justify-between">
                <span className="text-zinc-500">Destinatario</span>
                <span className="font-medium text-zinc-900">{completedOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Modalidad de entrega</span>
                <span className="font-medium text-zinc-900">
                  {completedOrder.deliveryMethod === 'pickup' ||
                  completedOrder.carrier === 'Retiro en domicilio'
                    ? 'Retiro en domicilio (sin cargo)'
                    : 'Envío a domicilio'}
                </span>
              </div>
              {!(
                completedOrder.deliveryMethod === 'pickup' ||
                completedOrder.carrier === 'Retiro en domicilio'
              ) && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500 shrink-0">Dirección de entrega</span>
                  <span className="font-medium text-zinc-900 text-right">
                    {completedOrder.shippingAddress}, {completedOrder.shippingCity} (
                    {completedOrder.shippingPostalCode})
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Medio de pago</span>
                <span className="font-medium text-zinc-900">
                  {completedOrder.paymentMethod === 'cash'
                    ? completedOrder.deliveryMethod === 'pickup' ||
                      completedOrder.carrier === 'Retiro en domicilio'
                      ? 'Efectivo (al retirar en domicilio)'
                      : 'Efectivo (al recibir en domicilio)'
                    : completedOrder.paymentMethod === 'transfer'
                      ? `${completedOrder.paymentBrand}${completedOrder.paymentReceipt ? ' · Comprobante adjunto' : ''}`
                      : `${completedOrder.paymentBrand} ···· ${completedOrder.paymentLast4}${completedOrder.installments > 1 ? ` (${completedOrder.installments} cuotas)` : ''}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">
                  {completedOrder.deliveryMethod === 'pickup' ||
                  completedOrder.carrier === 'Retiro en domicilio'
                    ? 'Coordinación de retiro'
                    : 'Entrega estimada'}
                </span>
                <span className="font-medium text-zinc-900">{completedOrder.estimatedDelivery}</span>
              </div>
            </div>

            {completedOrder.paymentReceipt && (
              <div className="mb-6 p-4 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col sm:flex-row gap-4">
                <div className="w-24 h-28 rounded-lg overflow-hidden bg-white border border-zinc-200 shrink-0">
                  <img
                    src={completedOrder.paymentReceipt.imageUrl}
                    alt="Comprobante de transferencia guardado"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-700 mb-1">
                    <FileCheck2 className="w-4 h-4 shrink-0" />
                    <span>Comprobante guardado en la base de datos</span>
                  </div>
                  {completedOrder.paymentReceipt.bankName && (
                    <p className="text-zinc-700">
                      <span className="text-zinc-500">Banco / Billetera:</span>{' '}
                      <span className="font-medium text-zinc-950">
                        {completedOrder.paymentReceipt.bankName}
                      </span>
                    </p>
                  )}
                  {completedOrder.paymentReceipt.operationNumber && (
                    <p className="text-zinc-700">
                      <span className="text-zinc-500">N° de operación:</span>{' '}
                      <span className="font-mono font-medium text-zinc-950">
                        {completedOrder.paymentReceipt.operationNumber}
                      </span>
                    </p>
                  )}
                  {completedOrder.paymentReceipt.amountDetected && (
                    <p className="text-zinc-700">
                      <span className="text-zinc-500">Monto detectado:</span>{' '}
                      <span className="font-mono font-medium text-zinc-950">
                        {completedOrder.paymentReceipt.amountDetected}
                      </span>
                    </p>
                  )}
                  {completedOrder.paymentReceipt.payerName && (
                    <p className="text-zinc-700">
                      <span className="text-zinc-500">Titular:</span>{' '}
                      <span className="font-medium text-zinc-950">
                        {completedOrder.paymentReceipt.payerName}
                      </span>
                    </p>
                  )}
                  {completedOrder.paymentReceipt.transferDate && (
                    <p className="text-zinc-700">
                      <span className="text-zinc-500">Fecha:</span>{' '}
                      <span className="font-medium text-zinc-950">
                        {completedOrder.paymentReceipt.transferDate}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onTrackOrder(completedOrder.id);
                }}
                className="flex-1 py-3 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                {completedOrder.deliveryMethod === 'pickup' ||
                completedOrder.carrier === 'Retiro en domicilio' ? (
                  <>
                    <Store className="w-4 h-4" />
                    Ver estado del pedido
                  </>
                ) : (
                  <>
                    <Truck className="w-4 h-4" />
                    Seguir envío en vivo
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-3 px-5 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
              >
                Volver al catálogo
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 overflow-y-auto">
            {/* Left Form Column */}
            <div className="lg:col-span-7 p-6 border-b lg:border-b-0 lg:border-r border-zinc-200">
              {/* Step Indicator */}
              <div className="flex items-center gap-4 text-xs font-medium mb-6 pb-4 border-b border-zinc-100">
                <button
                  type="button"
                  onClick={() => setStep('shipping')}
                  className={`cursor-pointer ${
                    step === 'shipping' ? 'text-blue-700 font-semibold' : 'text-zinc-500'
                  }`}
                >
                  01. Entrega y contacto
                </button>
                <span className="text-zinc-300">/</span>
                <span className={step === 'payment' ? 'text-blue-700 font-semibold' : 'text-zinc-400'}>
                  02. Pago y confirmación
                </span>
              </div>

              {errorMessage && (
                <div className="mb-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {errorMessage}
                </div>
              )}

              {step === 'shipping' ? (
                <form onSubmit={handleContinueToPayment} className="space-y-4">
                  {/* Delivery Method Selector */}
                  <div>
                    <p className="block text-xs font-medium text-zinc-700 mb-2">
                      Modalidad de entrega
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDeliveryMethod('delivery');
                          setErrorMessage('');
                        }}
                        className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                          deliveryMethod === 'delivery'
                            ? 'border-blue-700 bg-blue-50/50 ring-1 ring-blue-700'
                            : 'border-zinc-200 bg-white hover:border-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950">
                            <Truck
                              className={`w-4 h-4 shrink-0 ${
                                deliveryMethod === 'delivery' ? 'text-blue-700' : 'text-zinc-500'
                              }`}
                            />
                            Envío a domicilio
                          </span>
                          <span
                            className={`text-[11px] font-mono font-semibold ${
                              standardDeliveryCost === 0 ? 'text-emerald-700' : 'text-zinc-700'
                            }`}
                          >
                            {standardDeliveryCost === 0
                              ? 'Sin cargo'
                              : formatCurrency(standardDeliveryCost)}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-snug">
                          Recibí tu compra en la dirección que indiques.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeliveryMethod('pickup');
                          setErrorMessage('');
                        }}
                        className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                          deliveryMethod === 'pickup'
                            ? 'border-blue-700 bg-blue-50/50 ring-1 ring-blue-700'
                            : 'border-zinc-200 bg-white hover:border-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950">
                            <Store
                              className={`w-4 h-4 shrink-0 ${
                                deliveryMethod === 'pickup' ? 'text-blue-700' : 'text-zinc-500'
                              }`}
                            />
                            Retiro en domicilio
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-emerald-700">
                            Sin cargo
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-snug">
                          Coordiná día y horario para retirar personalmente.
                        </p>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      {isPickup
                        ? 'Nombre y apellido de quien retira'
                        : 'Nombre y apellido del destinatario'}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ej. Carolina Méndez"
                      className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      {isPickup
                        ? 'Teléfono de contacto (para coordinar el retiro)'
                        : 'Teléfono de contacto (para avisos de correo)'}
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={32}
                      value={shippingPhone}
                      onChange={(e) => setShippingPhone(e.target.value)}
                      placeholder="+54 11 4520-8810"
                      className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  {isPickup ? (
                    <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-xl flex items-start gap-2.5">
                      <MapPin className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                      <div className="text-xs text-zinc-600 leading-relaxed">
                        <p className="font-semibold text-zinc-900 mb-0.5">
                          Retiro en domicilio sin costo de envío
                        </p>
                        <p>
                          Al confirmar tu pedido reservamos tus productos al instante y coordinamos
                          el punto y horario de retiro al teléfono que ingresaste.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Dirección de entrega (calle, altura, piso/depto)
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={200}
                          value={shippingAddress}
                          onChange={(e) => setShippingAddress(e.target.value)}
                          placeholder="Av. Callao 1180, Piso 4B"
                          className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-zinc-700 mb-1">
                            Ciudad / Provincia
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={80}
                            value={shippingCity}
                            onChange={(e) => setShippingCity(e.target.value)}
                            placeholder="Buenos Aires"
                            className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-700 mb-1">
                            Código postal
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={20}
                            value={shippingPostalCode}
                            onChange={(e) => setShippingPostalCode(e.target.value)}
                            placeholder="C1023"
                            className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 font-mono"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      {isPickup
                        ? 'Horario preferido o indicaciones para el retiro (opcional)'
                        : 'Indicaciones para el repartidor (opcional)'}
                    </label>
                    <input
                      type="text"
                      maxLength={240}
                      value={shippingNotes}
                      onChange={(e) => setShippingNotes(e.target.value)}
                      placeholder={
                        isPickup
                          ? 'Ej. Paso a retirar hoy después de las 17 hs'
                          : 'Horario preferido, timbre o recepción'
                      }
                      className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  {!isPickup && (
                    <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={saveDefaultAddress}
                        onChange={(e) => setSaveDefaultAddress(e.target.checked)}
                        className="accent-blue-700 rounded"
                      />
                      Guardar como dirección predeterminada en mi cuenta
                    </label>
                  )}

                  <button
                    type="submit"
                    className="w-full mt-2 py-3 px-4 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                  >
                    Continuar al pago
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmPayment} className="space-y-4">
                  {/* Selected Delivery Summary Bar */}
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {isPickup ? (
                        <Store className="w-4 h-4 text-blue-700 shrink-0" />
                      ) : (
                        <Truck className="w-4 h-4 text-blue-700 shrink-0" />
                      )}
                      <span className="font-medium text-zinc-900 truncate">
                        {isPickup
                          ? 'Retiro en domicilio · Sin cargo'
                          : `Envío a domicilio · ${shippingAddress}, ${shippingCity}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep('shipping')}
                      className="text-[11px] font-medium text-blue-700 hover:underline shrink-0 cursor-pointer"
                    >
                      Cambiar
                    </button>
                  </div>

                  {/* Payment Method Selector (Transferencia & Efectivo only) */}
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-100 rounded-lg">
                    {(
                      [
                        { id: 'transfer', label: 'Transferencia', icon: Building2 },
                        { id: 'cash', label: 'Efectivo', icon: Banknote },
                      ] as const
                    ).map((m) => {
                      const Icon = m.icon;
                      const active = paymentMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setPaymentMethod(m.id);
                            setErrorMessage('');
                          }}
                          className={`py-2.5 px-3 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-white text-zinc-950 shadow-sm'
                              : 'text-zinc-600 hover:text-zinc-950'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Dynamic Installment Benefit Selector */}
                  {benefitEval.maxInstallments > 1 && (
                    <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-blue-950">
                          Plan de cuotas sin interés habilitado
                        </span>
                        <span className="text-[11px] font-mono text-blue-700 font-semibold">
                          Hasta {benefitEval.maxInstallments} cuotas
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {benefitEval.installmentOptions.map((n) => {
                          const isSelected = effectiveInstallments === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setSelectedInstallments(n)}
                              className={`px-2.5 py-1.5 text-xs font-mono rounded-lg border transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-700 text-white border-blue-700 font-semibold'
                                  : 'bg-white text-zinc-800 border-blue-200 hover:border-blue-600'
                              }`}
                            >
                              {n === 1
                                ? `1 pago (${formatCurrency(total)})`
                                : `${n}x ${formatCurrency(total / n)}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'transfer' && (
                    <div className="space-y-3.5">
                      <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-emerald-700">
                            5% de descuento adicional por transferencia
                          </span>
                          {transferAccounts.length > 0 && (
                            <span className="text-[11px] font-medium text-zinc-500">
                              Datos bancarios de destino
                            </span>
                          )}
                        </div>

                        {transferAccounts.length > 0 && (
                          <div className="space-y-2.5">
                            {transferAccounts.map((acc, idx) => (
                              <div
                                key={acc.key}
                                className="p-3 bg-white border border-zinc-200 rounded-lg space-y-2"
                              >
                                {transferAccounts.length > 1 && (
                                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                    {acc.label}
                                  </p>
                                )}
                                <div className="space-y-1.5 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-zinc-500 shrink-0">Nombre de la cuenta:</span>
                                    <span className="font-medium text-zinc-950 text-right truncate">
                                      {acc.accountHolder || 'No informado'}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-zinc-500 shrink-0">Alias:</span>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-mono font-medium text-zinc-950 truncate">
                                        {acc.alias || 'No informado'}
                                      </span>
                                      {acc.alias && (
                                        <button
                                          type="button"
                                          onClick={() => handleCopyBankValue(`alias-${idx}`, acc.alias)}
                                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer shrink-0"
                                        >
                                          <Copy className="w-3 h-3" />
                                          {copiedField === `alias-${idx}` ? 'Copiado' : 'Copiar'}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-zinc-500 shrink-0">CBU / CVU:</span>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-mono font-medium text-zinc-950 truncate">
                                        {acc.cbuCvu || 'No informado'}
                                      </span>
                                      {acc.cbuCvu && (
                                        <button
                                          type="button"
                                          onClick={() => handleCopyBankValue(`cbu-${idx}`, acc.cbuCvu)}
                                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer shrink-0"
                                        >
                                          <Copy className="w-3 h-3" />
                                          {copiedField === `cbu-${idx}` ? 'Copiado' : 'Copiar'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Comprobante Upload & Automatic Payment Info Extraction */}
                      <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-zinc-950">
                              Comprobante de transferencia
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              Subí la captura o foto para guardarla en la base de datos y leer los
                              datos de pago.
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              ref={receiptFileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleReceiptFileChange}
                              className="hidden"
                            />
                            <input
                              ref={receiptCameraInputRef}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleReceiptFileChange}
                              className="hidden"
                            />
                            <button
                              type="button"
                              disabled={parsingReceipt}
                              onClick={() => receiptFileInputRef.current?.click()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              {receiptImageUrl ? 'Cambiar imagen' : 'Cargar comprobante'}
                            </button>
                            <button
                              type="button"
                              disabled={parsingReceipt}
                              onClick={() => receiptCameraInputRef.current?.click()}
                              title="Sacar foto con cámara"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Cámara</span>
                            </button>
                          </div>
                        </div>

                        {parsingReceipt && (
                          <div className="flex items-center gap-2.5 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            <span>Leyendo información de pago del comprobante...</span>
                          </div>
                        )}

                        {!parsingReceipt && receiptReadMessage && (
                          <div
                            className={`p-3 rounded-lg text-xs border ${
                              receiptReadStatus === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}
                          >
                            {receiptReadMessage}
                          </div>
                        )}

                        {receiptImageUrl && (
                          <div className="flex items-start gap-3 p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                            <div className="w-16 h-20 rounded-md overflow-hidden bg-white border border-zinc-200 shrink-0">
                              <img
                                src={receiptImageUrl}
                                alt="Vista previa del comprobante"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p className="text-xs font-medium text-zinc-900 truncate">
                                {receiptFileName || 'comprobante.jpg'}
                              </p>
                              <p className="text-[11px] text-zinc-500">
                                Listo para guardarse junto al pedido en la base de datos.
                              </p>
                              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                <button
                                  type="button"
                                  disabled={parsingReceipt}
                                  onClick={() => void runReceiptRead(receiptImageUrl)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline disabled:opacity-50 cursor-pointer"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  Volver a leer
                                </button>
                                <button
                                  type="button"
                                  disabled={parsingReceipt}
                                  onClick={resetReceiptState}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Quitar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Extracted / Editable Payment Info Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              N° de operación / referencia
                            </label>
                            <input
                              type="text"
                              maxLength={80}
                              value={receiptOperationNumber}
                              onChange={(e) => setReceiptOperationNumber(e.target.value)}
                              placeholder="Ej. 00492817462"
                              className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              Banco / Billetera emisora
                            </label>
                            <input
                              type="text"
                              maxLength={80}
                              value={receiptBankName}
                              onChange={(e) => setReceiptBankName(e.target.value)}
                              placeholder="Ej. Mercado Pago, Galicia..."
                              className="w-full px-2.5 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              Monto detectado
                            </label>
                            <input
                              type="text"
                              maxLength={40}
                              value={receiptAmountDetected}
                              onChange={(e) => setReceiptAmountDetected(e.target.value)}
                              placeholder={formatCurrency(total)}
                              className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              Fecha de transferencia
                            </label>
                            <input
                              type="text"
                              maxLength={60}
                              value={receiptTransferDate}
                              onChange={(e) => setReceiptTransferDate(e.target.value)}
                              placeholder="Ej. 22/11/2026 14:30"
                              className="w-full px-2.5 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              Titular / Pagador
                            </label>
                            <input
                              type="text"
                              maxLength={100}
                              value={receiptPayerName}
                              onChange={(e) => setReceiptPayerName(e.target.value)}
                              placeholder="Nombre del titular"
                              className="w-full px-2.5 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                              Cuenta destino / Alias
                            </label>
                            <input
                              type="text"
                              maxLength={100}
                              value={receiptDestinationAccount}
                              onChange={(e) => setReceiptDestinationAccount(e.target.value)}
                              placeholder={
                                transferAccounts[0]?.alias ||
                                transferAccounts[0]?.cbuCvu ||
                                'Alias o CBU/CVU de destino'
                              }
                              className="w-full px-2.5 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'cash' && (
                    <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-3.5">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200 flex items-center justify-center shrink-0">
                          <Banknote className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-950">
                            {isPickup
                              ? 'Pago en efectivo al retirar en domicilio'
                              : 'Pago en efectivo al recibir en tu domicilio'}
                          </p>
                          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                            {isPickup
                              ? 'Abonás en efectivo al momento de retirar tu pedido. Tu stock queda reservado de inmediato.'
                              : 'Abonás en efectivo al momento de recibir tu compra en el domicilio indicado. Tu stock queda reservado de inmediato.'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="cash-tendered-input"
                          className="block text-xs font-medium text-zinc-700 mb-1"
                        >
                          ¿Con cuánto abonás? (opcional, para preparar cambio)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-400">
                            $
                          </span>
                          <input
                            id="cash-tendered-input"
                            type="number"
                            min={total}
                            step={500}
                            value={cashTendered}
                            onChange={(e) => setCashTendered(e.target.value)}
                            placeholder={String(total)}
                            className="w-full pl-7 pr-3 py-2.5 text-sm font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 tabular-nums"
                          />
                        </div>
                        {cashChangeDue !== null && (
                          <p className="text-xs text-emerald-700 font-medium mt-1.5 font-mono tabular-nums">
                            Vuelto a entregar: {formatCurrency(cashChangeDue)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep('shipping')}
                      className="px-4 py-3 text-sm font-medium text-zinc-700 border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      disabled={parsingReceipt}
                      className="flex-1 py-3 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                    >
                      {paymentMethod === 'cash'
                        ? `Confirmar pedido en efectivo · ${formatCurrency(total)}`
                        : paymentMethod === 'transfer'
                          ? `Confirmar transferencia · ${formatCurrency(total)}`
                          : `Confirmar pago · ${formatCurrency(total)}`}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Right Summary Column */}
            <div className="lg:col-span-5 p-6 bg-zinc-50 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold text-zinc-900 mb-4">Resumen de tu compra</h3>
                <ul className="space-y-3 mb-5 max-h-56 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <li key={item.productId} className="flex justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900 truncate">{item.name}</p>
                        <p className="text-zinc-500 tabular-nums">
                          {item.quantity} × {formatCurrency(item.price)}
                        </p>
                      </div>
                      <span className="font-mono font-medium text-zinc-900 tabular-nums shrink-0">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2 text-xs border-t border-zinc-200 pt-4">
                  <div className="flex justify-between text-zinc-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
                  </div>
                  {promoDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        Cupón {benefitEval.promoCodeApplied} ({benefitEval.promoDiscountPercent}%)
                      </span>
                      <span className="font-mono tabular-nums">-{formatCurrency(promoDiscount)}</span>
                    </div>
                  )}
                  {thresholdDiscount > 0 && benefitEval.matchedThresholdBenefit && (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        Beneficio compra ≥{' '}
                        {formatCurrency(benefitEval.matchedThresholdBenefit.minOrderAmount)} (
                        {benefitEval.matchedThresholdBenefit.discountPercent}%)
                      </span>
                      <span className="font-mono tabular-nums">
                        -{formatCurrency(thresholdDiscount)}
                      </span>
                    </div>
                  )}
                  {transferDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Descuento transferencia (5%)</span>
                      <span className="font-mono tabular-nums">
                        -{formatCurrency(transferDiscount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-zinc-600">
                    <span>Modalidad</span>
                    <span className="font-medium text-zinc-900">
                      {isPickup ? 'Retiro en domicilio' : 'Envío a domicilio'}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-600">
                    <span>{isPickup ? 'Costo de retiro' : 'Envío'}</span>
                    <span
                      className={`font-mono tabular-nums ${
                        shippingCost === 0 ? 'text-emerald-700 font-medium' : ''
                      }`}
                    >
                      {shippingCost === 0 ? 'Sin cargo' : formatCurrency(shippingCost)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-zinc-950 pt-3 border-t border-zinc-200">
                    <span>Total a pagar</span>
                    <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
                  </div>
                  {effectiveInstallments > 1 && (
                    <p className="text-[11px] text-blue-700 font-mono text-right tabular-nums">
                      {effectiveInstallments} cuotas sin interés de{' '}
                      {formatCurrency(total / effectiveInstallments)}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-200 text-[11px] text-zinc-500 space-y-1">
                <p className="font-medium text-zinc-700">Compra protegida y stock garantizado</p>
                <p>
                  Las unidades se reservan de forma atómica al confirmar el pedido y recibirás tu
                  código de seguimiento de inmediato.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

