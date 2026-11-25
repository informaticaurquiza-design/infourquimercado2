import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  FileCheck2,
  Landmark,
  Loader2,
  Save,
  ScanText,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { compressReceiptImage } from '../lib/imageTools';
import {
  MONTHLY_SUBSCRIPTION_COST_TIER_1,
  MONTHLY_SUBSCRIPTION_COST_TIER_2,
  SELLER_TRIAL_NOTICE,
  formatCurrency,
  formatDateTime,
  formatShortDate,
  getAccountSubscriptionInfo,
} from '../lib/validation';
import {
  parseTransferReceipt,
  submitSubscriptionPayment,
  updateUserProfile,
} from '../services/dataService';
import type {
  AdminBillingSettings,
  AppUser,
  PaymentReceipt,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  UserProfile,
} from '../types/ecommerce';

interface SubscriptionPaymentPanelProps {
  user: AppUser;
  profile: UserProfile | null;
  isAdmin: boolean;
  payments: SubscriptionPayment[];
  adminBillingSettings: AdminBillingSettings | null;
  onProfileSaved?: (updates: Partial<UserProfile>) => void;
  onNotifyToast: (msg: string) => void;
  onPaymentSubmitted?: () => void;
}

export function SubscriptionPaymentPanel({
  user,
  profile,
  isAdmin,
  payments,
  adminBillingSettings,
  onProfileSaved,
  onNotifyToast,
  onPaymentSubmitted,
}: SubscriptionPaymentPanelProps) {
  const [method, setMethod] = useState<SubscriptionPaymentMethod>('transfer');
  const [note, setNote] = useState('');

  // Transfer receipt state
  const [receiptImageUrl, setReceiptImageUrl] = useState('');
  const [receiptFileName, setReceiptFileName] = useState('');
  const [receiptOpNumber, setReceiptOpNumber] = useState('');
  const [receiptBankName, setReceiptBankName] = useState('');
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptPayer, setReceiptPayer] = useState('');
  const [receiptDate, setReceiptDate] = useState('');
  const [receiptDest, setReceiptDest] = useState('');
  const [receiptSummary, setReceiptSummary] = useState('');
  const [receiptReading, setReceiptReading] = useState(false);
  const [receiptError, setReceiptError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [viewingPayment, setViewingPayment] = useState<SubscriptionPayment | null>(null);

  // Admin inline bank editor state
  const [editingAdminBank, setEditingAdminBank] = useState(false);
  const [adminBankHolder, setAdminBankHolder] = useState('');
  const [adminBankAlias, setAdminBankAlias] = useState('');
  const [adminBankCbu, setAdminBankCbu] = useState('');
  const [savingAdminBank, setSavingAdminBank] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const subInfo = useMemo(() => {
    const effectiveProfile: UserProfile | null = profile
      ? { ...profile, role: isAdmin ? 'admin' : profile.role }
      : isAdmin
        ? {
            uid: user.uid,
            displayName: user.displayName || 'Administrador',
            email: user.email || '',
            photoURL: user.photoURL || '',
            phone: '',
            defaultAddress: '',
            defaultCity: '',
            defaultPostalCode: '',
            pushEnabled: false,
            role: 'admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : null;
    return getAccountSubscriptionInfo(effectiveProfile);
  }, [profile, isAdmin, user]);

  // Administrator bank details come from settings/billing (automatically synced with the admin's profile).
  // For the admin themselves, fall back immediately to their profile fields if settings/billing hasn't synced yet.
  const adminBank = useMemo(() => {
    const settingsAlias = (adminBillingSettings?.bankAlias || '').trim();
    const settingsCbu = (adminBillingSettings?.bankCbuCvu || '').trim();
    const settingsHolder = (adminBillingSettings?.bankAccountHolder || '').trim();
    const hasSettings = Boolean(settingsAlias || settingsCbu || settingsHolder);

    if (hasSettings) {
      return {
        bankAlias: settingsAlias,
        bankCbuCvu: settingsCbu,
        bankAccountHolder: settingsHolder,
      };
    }

    if (isAdmin && profile) {
      return {
        bankAlias: (profile.bankAlias || '').trim(),
        bankCbuCvu: (profile.bankCbuCvu || '').trim(),
        bankAccountHolder: (profile.bankAccountHolder || '').trim(),
      };
    }

    return {
      bankAlias: '',
      bankCbuCvu: '',
      bankAccountHolder: '',
    };
  }, [adminBillingSettings, isAdmin, profile]);

  const hasAdminBank = Boolean(
    adminBank.bankAlias || adminBank.bankCbuCvu || adminBank.bankAccountHolder,
  );

  useEffect(() => {
    if (!editingAdminBank) {
      setAdminBankHolder(adminBank.bankAccountHolder);
      setAdminBankAlias(adminBank.bankAlias);
      setAdminBankCbu(adminBank.bankCbuCvu);
    }
  }, [adminBank, editingAdminBank]);

  const myPayments = useMemo(
    () => payments.filter((p) => p.userId === user.uid),
    [payments, user.uid],
  );

  function clearReceipt() {
    setReceiptImageUrl('');
    setReceiptFileName('');
    setReceiptOpNumber('');
    setReceiptBankName('');
    setReceiptAmount('');
    setReceiptPayer('');
    setReceiptDate('');
    setReceiptDest('');
    setReceiptSummary('');
    setReceiptError('');
  }

  async function runReceiptRead(dataUrl: string) {
    setReceiptReading(true);
    setReceiptError('');
    try {
      const info = await parseTransferReceipt(dataUrl);
      setReceiptOpNumber(info.operationNumber || '');
      setReceiptBankName(info.bankName || '');
      setReceiptAmount(info.amountDetected || '');
      setReceiptPayer(info.payerName || '');
      setReceiptDate(info.transferDate || '');
      setReceiptDest(info.destinationAccount || '');
      setReceiptSummary(info.summary || '');
      onNotifyToast('Información del comprobante leída automáticamente.');
    } catch (err) {
      setReceiptError(
        err instanceof Error
          ? err.message
          : 'No pudimos leer automáticamente el comprobante. Podés completar los datos manualmente.',
      );
    } finally {
      setReceiptReading(false);
    }
  }

  async function handleReceiptFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReceiptError('');
    try {
      const compressed = await compressReceiptImage(file);
      setReceiptImageUrl(compressed.dataUrl);
      setReceiptFileName(file.name || 'comprobante.jpg');
      await runReceiptRead(compressed.dataUrl);
    } catch (err) {
      setReceiptError(
        err instanceof Error ? err.message : 'No pudimos procesar la imagen del comprobante.',
      );
    }
  }

  async function handleCopyText(label: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onNotifyToast(`${label} copiado al portapapeles.`);
    } catch {
      onNotifyToast(`${label}: ${value}`);
    }
  }

  async function handleSaveAdminBank() {
    if (!isAdmin) return;
    setSavingAdminBank(true);
    try {
      const updates = {
        bankAccountHolder: adminBankHolder.trim(),
        bankAlias: adminBankAlias.trim(),
        bankCbuCvu: adminBankCbu.trim(),
      };
      await updateUserProfile(user.uid, updates);
      onProfileSaved?.(updates);
      setEditingAdminBank(false);
      onNotifyToast('Datos bancarios del administrador actualizados para el pago mensual.');
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos guardar los datos bancarios.',
      );
    } finally {
      setSavingAdminBank(false);
    }
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');

    if (method === 'transfer' && !receiptImageUrl) {
      setSubmitError('Subí o fotografiá el comprobante de transferencia antes de enviar.');
      return;
    }

    const paymentReceipt: PaymentReceipt | undefined =
      method === 'transfer'
        ? {
            imageUrl: receiptImageUrl,
            fileName: receiptFileName || 'comprobante-abono.jpg',
            operationNumber: receiptOpNumber.trim(),
            bankName: receiptBankName.trim(),
            amountDetected: receiptAmount.trim(),
            payerName: receiptPayer.trim(),
            transferDate: receiptDate.trim(),
            destinationAccount: receiptDest.trim(),
            summary: receiptSummary.trim(),
            uploadedAt: new Date().toISOString(),
          }
        : undefined;

    const amountToSubmit = subInfo.monthlyAmount;

    setSubmitting(true);
    try {
      await submitSubscriptionPayment({
        user,
        profile,
        paymentMethod: method,
        amount: amountToSubmit,
        note: note.trim(),
        paymentReceipt,
      });
      setNote('');
      clearReceipt();
      onNotifyToast(
        `Pago mensual de ${formatCurrency(amountToSubmit)} registrado. El administrador revisará tu comprobante para activar la cuenta.`,
      );
      onPaymentSubmitted?.();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'No pudimos registrar tu pago mensual.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const currentTierIdx = subInfo.accountMonth <= 1 ? 1 : subInfo.accountMonth <= 3 ? 2 : 3;

  return (
    <div className="space-y-6">
      {/* Account Status Banner */}
      <div
        className={`rounded-xl border p-5 sm:p-6 space-y-5 ${
          subInfo.isActive
            ? 'bg-emerald-50/70 border-emerald-200'
            : 'bg-red-50/80 border-red-200'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  subInfo.isActive ? 'bg-emerald-600' : 'bg-red-600'
                }`}
              />
              <h2
                className={`font-display text-base font-bold ${
                  subInfo.isActive ? 'text-emerald-950' : 'text-red-950'
                }`}
              >
                Estado de cuenta de vendedor: {subInfo.statusLabel}
              </h2>
            </div>
            <p className={`text-xs ${subInfo.isActive ? 'text-emerald-900' : 'text-red-800'}`}>
              {subInfo.detailText}
            </p>
            <p className="text-[11px] text-zinc-600 pt-0.5">{SELLER_TRIAL_NOTICE}</p>
          </div>

          <div className="flex flex-wrap items-center gap-5 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-zinc-200/80">
            <div>
              <p className="text-[11px] text-zinc-500">Fecha de ingreso</p>
              <p className="font-mono text-sm font-semibold text-zinc-950 tabular-nums">
                {formatShortDate(subInfo.joinedAtIso)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500">Mes de cuenta</p>
              <p className="font-mono text-sm font-semibold text-zinc-950 tabular-nums">
                Mes {subInfo.accountMonth}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500">Costo mes actual</p>
              <p className="font-mono text-sm font-bold text-zinc-950 tabular-nums">
                {isAdmin
                  ? 'Sin cargo'
                  : subInfo.currentMonthCost === 0
                    ? 'Gratis'
                    : formatCurrency(subInfo.currentMonthCost)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500">Próximo abono</p>
              <p className="font-mono text-sm font-bold text-blue-700 tabular-nums">
                {formatCurrency(subInfo.monthlyAmount)}
              </p>
            </div>
          </div>
        </div>

        {/* Tiered Monthly Pricing Schedule */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-zinc-200/70">
          <div
            className={`rounded-lg border px-3.5 py-2.5 bg-white/90 ${
              !isAdmin && currentTierIdx === 1
                ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                : 'border-zinc-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-600">1° mes (días 1 a 30)</span>
              {!isAdmin && currentTierIdx === 1 && (
                <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">
                  Tu mes actual
                </span>
              )}
            </div>
            <p className="font-mono text-sm font-bold text-emerald-700 mt-0.5">Gratis ($ 0)</p>
          </div>

          <div
            className={`rounded-lg border px-3.5 py-2.5 bg-white/90 ${
              !isAdmin && currentTierIdx === 2
                ? 'border-blue-600 ring-1 ring-blue-600/30'
                : 'border-zinc-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-600">
                2° y 3° mes (días 31 a 90)
              </span>
              {!isAdmin && currentTierIdx === 2 && (
                <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                  Tu mes actual
                </span>
              )}
            </div>
            <p className="font-mono text-sm font-bold text-zinc-950 mt-0.5">
              {formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_1)} / mes
            </p>
          </div>

          <div
            className={`rounded-lg border px-3.5 py-2.5 bg-white/90 ${
              !isAdmin && currentTierIdx === 3
                ? 'border-blue-600 ring-1 ring-blue-600/30'
                : 'border-zinc-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-600">
                A partir del 4° mes (día 91+)
              </span>
              {!isAdmin && currentTierIdx === 3 && (
                <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                  Tu mes actual
                </span>
              )}
            </div>
            <p className="font-mono text-sm font-bold text-zinc-950 mt-0.5">
              {formatCurrency(MONTHLY_SUBSCRIPTION_COST_TIER_2)} / mes
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid: Payment Form + Payment History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Monthly Payment Form */}
        <form
          onSubmit={handleSubmitPayment}
          className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 space-y-5"
        >
          <div>
            <h3 className="font-display text-base font-bold text-zinc-950">
              Ingreso de pago mensual de la aplicación
            </h3>
            <p className="text-xs text-zinc-600 mt-1">
              Importe correspondiente para tu próximo período de 30 días:{' '}
              <strong className="font-mono text-zinc-950">
                {formatCurrency(subInfo.monthlyAmount)}
              </strong>
              . Seleccioná Efectivo o Transferencia bancaria a la cuenta del administrador.
            </p>
          </div>

          {submitError && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {submitError}
            </div>
          )}

          {/* Method Switcher */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setMethod('transfer');
                setSubmitError('');
              }}
              className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                method === 'transfer'
                  ? 'border-blue-700 bg-blue-50/50 text-zinc-950'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
              }`}
            >
              <Landmark
                className={`w-5 h-5 shrink-0 ${
                  method === 'transfer' ? 'text-blue-700' : 'text-zinc-400'
                }`}
              />
              <div>
                <p className="text-xs font-semibold">Transferencia</p>
                <p className="text-[11px] text-zinc-500">Comprobante + lectura</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setMethod('cash');
                setSubmitError('');
              }}
              className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                method === 'cash'
                  ? 'border-blue-700 bg-blue-50/50 text-zinc-950'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
              }`}
            >
              <Banknote
                className={`w-5 h-5 shrink-0 ${
                  method === 'cash' ? 'text-blue-700' : 'text-zinc-400'
                }`}
              />
              <div>
                <p className="text-xs font-semibold">Efectivo</p>
                <p className="text-[11px] text-zinc-500">
                  Pago presencial {formatCurrency(subInfo.monthlyAmount)}
                </p>
              </div>
            </button>
          </div>

          {method === 'transfer' ? (
            <div className="space-y-4">
              {/* Destination Account Info — Administrator's Bank Details */}
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900">
                    Datos bancarios del administrador para transferir el abono mensual
                  </span>
                  <div className="flex items-center gap-3">
                    {adminBank.bankAlias && !editingAdminBank && (
                      <button
                        type="button"
                        onClick={() => void handleCopyText('Alias', adminBank.bankAlias)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copiar alias
                      </button>
                    )}
                    {adminBank.bankCbuCvu && !editingAdminBank && (
                      <button
                        type="button"
                        onClick={() => void handleCopyText('CBU/CVU', adminBank.bankCbuCvu)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copiar CBU/CVU
                      </button>
                    )}
                    {isAdmin && !editingAdminBank && (
                      <button
                        type="button"
                        onClick={() => setEditingAdminBank(true)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-700 hover:text-zinc-950 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        {hasAdminBank ? 'Editar datos' : 'Cargar datos'}
                      </button>
                    )}
                  </div>
                </div>

                {editingAdminBank && isAdmin ? (
                  <div className="space-y-3 pt-1 border-t border-zinc-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Titular de la cuenta bancaria
                        </label>
                        <input
                          type="text"
                          maxLength={120}
                          value={adminBankHolder}
                          onChange={(e) => setAdminBankHolder(e.target.value)}
                          placeholder="Nombre completo o razón social"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Alias
                        </label>
                        <input
                          type="text"
                          maxLength={60}
                          value={adminBankAlias}
                          onChange={(e) => setAdminBankAlias(e.target.value)}
                          placeholder="Ej. mi.alias.banco"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          CBU / CVU
                        </label>
                        <input
                          type="text"
                          maxLength={32}
                          value={adminBankCbu}
                          onChange={(e) => setAdminBankCbu(e.target.value)}
                          placeholder="22 dígitos"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAdminBank(false);
                          setAdminBankHolder(adminBank.bankAccountHolder);
                          setAdminBankAlias(adminBank.bankAlias);
                          setAdminBankCbu(adminBank.bankCbuCvu);
                        }}
                        className="px-3 py-1.5 text-[11px] font-medium text-zinc-600 bg-white border border-zinc-300 hover:bg-zinc-100 rounded-lg cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={savingAdminBank}
                        onClick={() => void handleSaveAdminBank()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingAdminBank ? 'Guardando...' : 'Guardar datos bancarios'}
                      </button>
                    </div>
                  </div>
                ) : hasAdminBank ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-zinc-700">
                    {adminBank.bankAlias && (
                      <p>
                        <span className="text-zinc-500">Alias:</span>{' '}
                        <span className="font-mono font-medium text-zinc-950 break-all">
                          {adminBank.bankAlias}
                        </span>
                      </p>
                    )}
                    {adminBank.bankCbuCvu && (
                      <p>
                        <span className="text-zinc-500">CBU / CVU:</span>{' '}
                        <span className="font-mono text-zinc-950 break-all">
                          {adminBank.bankCbuCvu}
                        </span>
                      </p>
                    )}
                    {adminBank.bankAccountHolder && (
                      <p>
                        <span className="text-zinc-500">Titular:</span>{' '}
                        <span className="font-medium text-zinc-950">
                          {adminBank.bankAccountHolder}
                        </span>
                      </p>
                    )}
                    <p>
                      <span className="text-zinc-500">Importe:</span>{' '}
                      <span className="font-mono font-bold text-zinc-950">
                        {formatCurrency(subInfo.monthlyAmount)}
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                    <div className="space-y-1">
                      <p className="font-semibold">
                        Datos bancarios del administrador pendientes de carga
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        {isAdmin
                          ? 'Cargá tu Titular, Alias y CBU/CVU desde "Cargar datos" o desde Mi cuenta para que los vendedores los vean al realizar el pago mensual.'
                          : 'El administrador todavía no cargó sus datos bancarios para transferencias. Podés abonar en Efectivo o consultar con la administración.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Receipt Upload / Camera Controls */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-zinc-800">
                  Comprobante de transferencia (obligatorio)
                </label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptFileSelected}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleReceiptFileSelected}
                  className="hidden"
                />

                {!receiptImageUrl ? (
                  <div className="border-2 border-dashed border-zinc-300 rounded-xl p-6 text-center space-y-3 bg-zinc-50/60">
                    <p className="text-xs text-zinc-600">
                      Subí una captura o foto del comprobante. Leeremos automáticamente los datos de
                      la transferencia y los guardaremos para verificación.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Subir comprobante
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Sacar foto
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-zinc-200 rounded-xl p-4 space-y-4 bg-white">
                    <div className="flex items-start gap-4">
                      <img
                        src={receiptImageUrl}
                        alt="Vista previa de comprobante"
                        className="w-24 h-28 object-cover rounded-lg border border-zinc-200 bg-zinc-50 shrink-0"
                      />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-zinc-950 truncate">
                              {receiptFileName}
                            </p>
                            <p className="text-[11px] text-emerald-700 flex items-center gap-1 mt-0.5">
                              <FileCheck2 className="w-3.5 h-3.5" />
                              Imagen lista para guardar en la base de datos
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={clearReceipt}
                            aria-label="Quitar comprobante"
                            className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={receiptReading}
                            onClick={() => void runReceiptRead(receiptImageUrl)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                          >
                            {receiptReading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ScanText className="w-3.5 h-3.5" />
                            )}
                            {receiptReading ? 'Leyendo datos...' : 'Leer datos del comprobante'}
                          </button>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-3 py-1.5 text-[11px] font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer"
                          >
                            Cambiar imagen
                          </button>
                        </div>
                      </div>
                    </div>

                    {receiptError && (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        {receiptError}
                      </p>
                    )}

                    {/* Editable Extracted Receipt Data */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Banco / Billetera emisora
                        </label>
                        <input
                          type="text"
                          maxLength={80}
                          value={receiptBankName}
                          onChange={(e) => setReceiptBankName(e.target.value)}
                          placeholder="Ej. Mercado Pago / Galicia"
                          className="w-full px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          N° de operación / Referencia
                        </label>
                        <input
                          type="text"
                          maxLength={80}
                          value={receiptOpNumber}
                          onChange={(e) => setReceiptOpNumber(e.target.value)}
                          placeholder="Ej. 0004829104"
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Monto detectado
                        </label>
                        <input
                          type="text"
                          maxLength={40}
                          value={receiptAmount}
                          onChange={(e) => setReceiptAmount(e.target.value)}
                          placeholder={formatCurrency(subInfo.monthlyAmount)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Fecha de transferencia
                        </label>
                        <input
                          type="text"
                          maxLength={60}
                          value={receiptDate}
                          onChange={(e) => setReceiptDate(e.target.value)}
                          placeholder="DD/MM/AAAA HH:mm"
                          className="w-full px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Titular / Pagador
                        </label>
                        <input
                          type="text"
                          maxLength={100}
                          value={receiptPayer}
                          onChange={(e) => setReceiptPayer(e.target.value)}
                          placeholder="Nombre del titular"
                          className="w-full px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                          Cuenta destino / Alias
                        </label>
                        <input
                          type="text"
                          maxLength={100}
                          value={receiptDest}
                          onChange={(e) => setReceiptDest(e.target.value)}
                          placeholder={
                            adminBank.bankAlias ||
                            adminBank.bankCbuCvu ||
                            'Alias o CBU/CVU del administrador'
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>
                    </div>

                    {receiptSummary && (
                      <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
                        <span className="font-semibold text-zinc-900">Lectura: </span>
                        {receiptSummary}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2 text-xs text-zinc-700">
              <p className="font-semibold text-zinc-950">
                Pago mensual en efectivo — {formatCurrency(subInfo.monthlyAmount)}
              </p>
              <p className="leading-relaxed">
                Al registrar tu pago en efectivo, el administrador recibirá el aviso en el módulo de
                Cuentas para confirmar la recepción del monto y activar tus publicaciones por 30 días.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              Nota o referencia de pago (opcional)
            </label>
            <textarea
              rows={2}
              maxLength={240}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                method === 'cash'
                  ? 'Ej. Abonado en efectivo en oficina el día de hoy / número de recibo...'
                  : 'Ej. Abono correspondiente al mes en curso...'
              }
              className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || receiptReading}
            className="w-full py-3 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            {submitting
              ? 'Registrando pago...'
              : `Registrar pago mensual (${formatCurrency(subInfo.monthlyAmount)})`}
          </button>
        </form>

        {/* Right: User's Submitted Monthly Payments */}
        <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200">
            <h3 className="font-display text-sm font-bold text-zinc-950">
              Mis pagos mensuales registrados ({myPayments.length})
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Historial de abonos enviados para activación de cuenta
            </p>
          </div>

          {myPayments.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              Todavía no registraste pagos mensuales de la aplicación.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {myPayments.map((payment) => (
                <li key={payment.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-zinc-950">
                        {payment.paymentMethod === 'transfer' ? 'Transferencia bancaria' : 'Efectivo'} ·{' '}
                        <span className="font-mono tabular-nums">
                          {formatCurrency(payment.amount)}
                        </span>
                      </p>
                      <p className="text-[11px] text-zinc-500 font-mono">
                        {formatDateTime(payment.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                        payment.status === 'approved'
                          ? 'text-emerald-700'
                          : payment.status === 'rejected'
                            ? 'text-red-600'
                            : 'text-amber-700'
                      }`}
                    >
                      {payment.status === 'approved' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Aprobado
                        </>
                      ) : payment.status === 'rejected' ? (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          Rechazado
                        </>
                      ) : (
                        <>
                          <Clock className="w-3.5 h-3.5" />
                          Pendiente
                        </>
                      )}
                    </span>
                  </div>

                  {payment.note && (
                    <p className="text-xs text-zinc-600 bg-zinc-50 rounded-md px-2.5 py-1.5">
                      {payment.note}
                    </p>
                  )}

                  {payment.paymentReceipt && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-zinc-500 truncate">
                        {payment.paymentReceipt.bankName || 'Comprobante adjunto'}
                        {payment.paymentReceipt.operationNumber
                          ? ` · Op. ${payment.paymentReceipt.operationNumber}`
                          : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => setViewingPayment(payment)}
                        className="text-xs font-medium text-blue-700 hover:underline shrink-0 cursor-pointer"
                      >
                        Ver comprobante
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {viewingPayment?.paymentReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/60 backdrop-blur-[1px]"
            onClick={() => setViewingPayment(null)}
          />
          <div className="relative z-10 w-full max-w-3xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div>
                <h3 className="font-display text-base font-bold text-zinc-950">
                  Comprobante de abono mensual — {formatCurrency(viewingPayment.amount)}
                </h3>
                <p className="text-xs text-zinc-500">
                  Enviado el {formatDateTime(viewingPayment.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPayment(null)}
                aria-label="Cerrar comprobante"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 overflow-y-auto">
              <div className="md:col-span-6 p-5 bg-zinc-50 border-b md:border-b-0 md:border-r border-zinc-200 flex items-center justify-center">
                <img
                  src={viewingPayment.paymentReceipt.imageUrl}
                  alt="Comprobante de abono mensual"
                  className="max-h-[60vh] w-auto object-contain rounded-lg border border-zinc-200 bg-white"
                />
              </div>
              <div className="md:col-span-6 p-6 space-y-3 text-xs">
                <dl className="divide-y divide-zinc-100">
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">Banco / Billetera</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.bankName || 'No detectado'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">N° de operación</dt>
                    <dd className="font-mono font-medium text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.operationNumber || 'No detectado'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">Monto detectado</dt>
                    <dd className="font-mono font-semibold text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.amountDetected || 'No detectado'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">Pagador</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.payerName || 'No detectado'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">Fecha</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.transferDate || 'No detectada'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-2">
                    <dt className="text-zinc-500">Cuenta destino</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingPayment.paymentReceipt.destinationAccount || 'No detectada'}
                    </dd>
                  </div>
                </dl>
                {viewingPayment.paymentReceipt.summary && (
                  <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <p className="font-semibold text-zinc-700 mb-1">Resumen de lectura</p>
                    <p className="text-zinc-600">{viewingPayment.paymentReceipt.summary}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
