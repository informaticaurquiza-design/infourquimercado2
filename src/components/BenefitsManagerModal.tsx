import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CreditCard,
  Edit3,
  Gift,
  Percent,
  Plus,
  Tag,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatExpirationDate,
  getBenefitTypeLabel,
  isBenefitExpired,
  validateBenefitInput,
} from '../lib/validation';
import { createOrUpdateBenefit, deleteBenefitById } from '../services/dataService';
import {
  BENEFIT_TYPE_OPTIONS,
  type AppUser,
  type BenefitType,
  type CustomerBenefit,
  type UserProfile,
} from '../types/ecommerce';

interface BenefitsManagerModalProps {
  open: boolean;
  onClose: () => void;
  user?: AppUser | null;
  isAdmin?: boolean;
  benefits: CustomerBenefit[];
  accounts: UserProfile[];
  initialEditBenefit?: CustomerBenefit | null;
  onNotifyToast: (msg: string) => void;
}

const QUICK_INSTALLMENTS = [2, 3, 6, 9, 12];

export function BenefitsManagerModal({
  open,
  onClose,
  user = null,
  isAdmin = false,
  benefits,
  accounts,
  initialEditBenefit = null,
  onNotifyToast,
}: BenefitsManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<BenefitType>('promo_code');
  const [targetUserId, setTargetUserId] = useState<string>('all');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState('10');
  const [minOrderAmount, setMinOrderAmount] = useState('0');
  const [maxInstallments, setMaxInstallments] = useState('6');
  const [expiresAt, setExpiresAt] = useState('');
  const [active, setActive] = useState(true);

  const [filterScope, setFilterScope] = useState<'all' | 'global' | 'personal'>('all');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) =>
      (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'es'),
    );
  }, [accounts]);

  function resetForm() {
    setEditingId(null);
    setType('promo_code');
    setTargetUserId('all');
    setTitle('');
    setDescription('');
    setPromoCode('');
    setDiscountPercent('10');
    setMinOrderAmount('0');
    setMaxInstallments('6');
    setExpiresAt('');
    setActive(true);
    setErrorMessage('');
  }

  function populateFromBenefit(benefit: CustomerBenefit) {
    setEditingId(benefit.id);
    setType(benefit.type);
    setTargetUserId(benefit.targetUserId || 'all');
    setTitle(benefit.title);
    setDescription(benefit.description || '');
    setPromoCode(benefit.promoCode || '');
    setDiscountPercent(String(benefit.discountPercent || 10));
    setMinOrderAmount(String(benefit.minOrderAmount || 0));
    setMaxInstallments(String(benefit.maxInstallments || 6));
    setExpiresAt(benefit.expiresAt || '');
    setActive(benefit.active);
    setErrorMessage('');
  }

  useEffect(() => {
    if (!open) return;
    setConfirmDeleteId(null);
    if (initialEditBenefit) {
      populateFromBenefit(initialEditBenefit);
    } else {
      resetForm();
    }
  }, [open, initialEditBenefit]);

  if (!open) return null;

  function resolveTargetUserName(uid: string): string {
    if (uid === 'all') return 'Todos los clientes';
    if (!isAdmin && user && uid === user.uid) {
      const label = user.displayName?.trim() || user.email?.trim() || 'Mi cuenta';
      return user.email && label !== user.email ? `${label} (${user.email})` : label;
    }
    const found = accounts.find((acc) => acc.uid === uid);
    if (found) {
      const label = found.displayName?.trim() || found.businessName?.trim() || found.email;
      return found.email && label !== found.email ? `${label} (${found.email})` : label;
    }
    const existingBenefit = benefits.find((b) => b.targetUserId === uid);
    return existingBenefit?.targetUserName || 'Cliente registrado';
  }

  function buildSuggestedTitle(nextType: BenefitType): string {
    if (nextType === 'installments') {
      const n = Math.max(2, Math.min(12, Math.round(Number(maxInstallments) || 6)));
      return `Hasta ${n} cuotas sin interés`;
    }
    if (nextType === 'promo_code') {
      const pct = Math.max(1, Math.min(90, Math.round(Number(discountPercent) || 10)));
      const code = promoCode.trim().toUpperCase();
      return code ? `${pct}% OFF con código ${code}` : `${pct}% OFF con cupón`;
    }
    const pct = Math.max(1, Math.min(90, Math.round(Number(discountPercent) || 10)));
    const minAmt = Math.max(0, Math.round(Number(minOrderAmount) || 0));
    return minAmt > 0
      ? `${pct}% OFF en compras mayores a ${formatCurrency(minAmt)}`
      : `${pct}% OFF por monto de compra`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');

    const parsedDiscount =
      type === 'installments' ? 0 : Math.round(Number(discountPercent || 0));
    const parsedMinAmount = Math.max(0, Math.round(Number(minOrderAmount || 0)));
    const parsedInstallments =
      type === 'installments' ? Math.round(Number(maxInstallments || 0)) : 1;
    const normalizedCode = type === 'promo_code' ? promoCode.trim().toUpperCase() : '';
    const finalTitle = title.trim() || buildSuggestedTitle(type);
    const targetUserName = resolveTargetUserName(targetUserId);

    const validationErr = validateBenefitInput({
      title: finalTitle,
      description: description.trim(),
      type,
      targetUserId,
      targetUserName,
      promoCode: normalizedCode,
      discountPercent: parsedDiscount,
      minOrderAmount: parsedMinAmount,
      maxInstallments: parsedInstallments,
      expiresAt: expiresAt.trim(),
    });
    if (validationErr) {
      setErrorMessage(validationErr);
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateBenefit({
        id: editingId || undefined,
        title: finalTitle,
        description: description.trim(),
        type,
        targetUserId,
        targetUserName,
        promoCode: normalizedCode,
        discountPercent: parsedDiscount,
        minOrderAmount: parsedMinAmount,
        maxInstallments: parsedInstallments,
        expiresAt: expiresAt.trim(),
        active,
      });
      onNotifyToast(
        editingId
          ? 'Beneficio actualizado correctamente.'
          : 'Beneficio creado y sincronizado correctamente.',
      );
      resetForm();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos guardar el beneficio.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(benefit: CustomerBenefit) {
    setErrorMessage('');
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
      onNotifyToast(
        !benefit.active ? 'Beneficio activado.' : 'Beneficio pausado.',
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos cambiar el estado del beneficio.',
      );
    }
  }

  async function handleDelete(benefitId: string) {
    setDeletingId(benefitId);
    setErrorMessage('');
    try {
      await deleteBenefitById(benefitId);
      if (editingId === benefitId) {
        resetForm();
      }
      setConfirmDeleteId(null);
      onNotifyToast('Beneficio eliminado.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos eliminar el beneficio.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  function renderTypeIcon(benefitType: BenefitType) {
    switch (benefitType) {
      case 'installments':
        return <CreditCard className="w-4 h-4 text-blue-700 shrink-0" />;
      case 'promo_code':
        return <Tag className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'min_amount_discount':
        return <Percent className="w-4 h-4 text-emerald-700 shrink-0" />;
    }
  }

  const manageableBenefits = isAdmin
    ? benefits
    : user
      ? benefits.filter((b) => b.createdBy === user.uid)
      : [];

  const filteredBenefits = manageableBenefits.filter((b) => {
    if (filterScope === 'global') return b.targetUserId === 'all';
    if (filterScope === 'personal') return b.targetUserId !== 'all';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-zinc-950/55 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-5xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div className="flex items-center gap-2.5">
            <Gift className="w-5 h-5 text-blue-700" />
            <div>
              <h2 className="font-display text-base font-bold text-zinc-950">
                {isAdmin ? 'ABM de Beneficios por Cliente' : 'Mis Descuentos y Beneficios (ABM)'}
              </h2>
              <p className="text-xs text-zinc-500">
                {isAdmin
                  ? 'Configurá cuotas sin interés, códigos de descuento o descuentos automáticos por monto para toda la tienda o para cada cliente.'
                  : 'Creá y editá cuotas sin interés, códigos de descuento o descuentos por monto con fecha de vencimiento para asignar a tus productos.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ABM de beneficios"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200">
          {/* Form Column */}
          <form onSubmit={handleSubmit} className="lg:col-span-5 p-6 space-y-4 bg-white">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">
                {editingId ? 'Modificar beneficio' : 'Nuevo beneficio'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Cancelar edición
                </button>
              )}
            </div>

            {/* Benefit Type Selector */}
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Tipo de beneficio
              </label>
              <div className="grid grid-cols-1 gap-2">
                {BENEFIT_TYPE_OPTIONS.map((opt) => {
                  const selected = type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setType(opt.value);
                        setErrorMessage('');
                      }}
                      className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'border-blue-700 bg-blue-50/70'
                          : 'border-zinc-200 hover:border-zinc-400 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {renderTypeIcon(opt.value)}
                        <span className="text-xs font-semibold text-zinc-950">{opt.label}</span>
                      </div>
                      <p className="text-[11px] text-zinc-600 mt-0.5 pl-6">{opt.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Customer Selector */}
            <div>
              <label
                htmlFor="benefit-target-user"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Destinatario (Cliente)
              </label>
              <select
                id="benefit-target-user"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="all">Todos los clientes (visible en el catálogo)</option>
                {isAdmin
                  ? sortedAccounts.map((acc) => {
                      const label =
                        acc.displayName?.trim() || acc.businessName?.trim() || acc.email;
                      return (
                        <option key={acc.uid} value={acc.uid}>
                          {label}
                          {acc.email && label !== acc.email ? ` — ${acc.email}` : ''}
                        </option>
                      );
                    })
                  : user && (
                      <option value={user.uid}>
                        Solo mi cuenta ({user.displayName?.trim() || user.email || 'Mi cuenta'})
                      </option>
                    )}
              </select>
              {isAdmin && sortedAccounts.length === 0 && (
                <p className="text-[11px] text-zinc-500 mt-1">
                  Cuando haya clientes registrados aparecerán aquí para asignar beneficios
                  individuales.
                </p>
              )}
              {!isAdmin && (
                <p className="text-[11px] text-zinc-500 mt-1">
                  Elegí &quot;Todos los clientes&quot; para que el descuento se informe a cualquier
                  comprador cuando lo habilites en un producto del catálogo.
                </p>
              )}
            </div>

            {/* Conditional fields by benefit type */}
            {type === 'installments' && (
              <div className="space-y-3 p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                <div>
                  <label
                    htmlFor="benefit-installments"
                    className="block text-xs font-medium text-zinc-700 mb-1.5"
                  >
                    Cuotas sin interés (2 a 12)
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {QUICK_INSTALLMENTS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMaxInstallments(String(n))}
                        className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md border cursor-pointer ${
                          Number(maxInstallments) === n
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-950'
                        }`}
                      >
                        {n} cuotas
                      </button>
                    ))}
                  </div>
                  <input
                    id="benefit-installments"
                    type="number"
                    min={2}
                    max={12}
                    value={maxInstallments}
                    onChange={(e) => setMaxInstallments(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="benefit-min-inst"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Monto mínimo de compra (opcional, $0 = sin mínimo)
                  </label>
                  <input
                    id="benefit-min-inst"
                    type="number"
                    min={0}
                    step={1000}
                    value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>
            )}

            {type === 'promo_code' && (
              <div className="space-y-3 p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="benefit-code"
                      className="block text-xs font-medium text-zinc-700 mb-1"
                    >
                      Código promocional *
                    </label>
                    <input
                      id="benefit-code"
                      type="text"
                      maxLength={24}
                      value={promoCode}
                      onChange={(e) =>
                        setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
                      }
                      placeholder="Ej. VIP15"
                      className="w-full px-3 py-2 text-xs font-mono uppercase bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="benefit-code-percent"
                      className="block text-xs font-medium text-zinc-700 mb-1"
                    >
                      Descuento (%) *
                    </label>
                    <input
                      id="benefit-code-percent"
                      type="number"
                      min={1}
                      max={90}
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="benefit-code-min"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Compra mínima requerida (opcional, $0 = sin mínimo)
                  </label>
                  <input
                    id="benefit-code-min"
                    type="number"
                    min={0}
                    step={1000}
                    value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>
            )}

            {type === 'min_amount_discount' && (
              <div className="space-y-3 p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="benefit-threshold-amount"
                      className="block text-xs font-medium text-zinc-700 mb-1"
                    >
                      Compras mayores a ($) *
                    </label>
                    <input
                      id="benefit-threshold-amount"
                      type="number"
                      min={1}
                      step={5000}
                      value={minOrderAmount}
                      onChange={(e) => setMinOrderAmount(e.target.value)}
                      placeholder="100000"
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="benefit-threshold-percent"
                      className="block text-xs font-medium text-zinc-700 mb-1"
                    >
                      Descuento (%) *
                    </label>
                    <input
                      id="benefit-threshold-percent"
                      type="number"
                      min={1}
                      max={90}
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600">
                  Se aplica automáticamente en el carrito y en la pasarela de pagos cuando el
                  subtotal supera o iguala el monto configurado.
                </p>
              </div>
            )}

            {/* Title & Description */}
            <div>
              <label
                htmlFor="benefit-title"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Título visible (si lo dejás vacío se genera automáticamente)
              </label>
              <input
                id="benefit-title"
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={buildSuggestedTitle(type)}
                className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label
                htmlFor="benefit-description"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Descripción / condiciones (opcional)
              </label>
              <textarea
                id="benefit-description"
                rows={2}
                maxLength={240}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej. Válido para compras online en todo el catálogo."
                className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
              />
            </div>

            <div>
              <label
                htmlFor="benefit-expires-at"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Fecha de vencimiento (opcional — vacío = sin vencimiento)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="benefit-expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
                {expiresAt && (
                  <button
                    type="button"
                    onClick={() => setExpiresAt('')}
                    className="px-2.5 py-2 text-xs text-zinc-600 hover:text-zinc-950 border border-zinc-300 rounded-lg cursor-pointer"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-800 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-zinc-300 text-blue-700 focus:ring-blue-700"
              />
              <span>Beneficio activo inmediatamente</span>
            </label>

            {errorMessage && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 inline-flex items-center justify-center gap-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {saving
                  ? 'Guardando...'
                  : editingId
                    ? 'Guardar cambios del beneficio'
                    : 'Registrar beneficio'}
              </span>
            </button>
          </form>

          {/* List Column */}
          <div className="lg:col-span-7 p-6 bg-zinc-50 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">
                  {isAdmin
                    ? `Beneficios registrados (${manageableBenefits.length})`
                    : `Mis beneficios creados (${manageableBenefits.length})`}
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Editá, pausá o eliminá beneficios en tiempo real.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'Todos' },
                    { id: 'global', label: 'Generales' },
                    { id: 'personal', label: 'Por cliente' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterScope(tab.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer ${
                      filterScope === tab.id
                        ? 'bg-white text-zinc-950 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredBenefits.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center bg-white border border-zinc-200 rounded-xl p-8">
                <Gift className="w-8 h-8 text-zinc-300 mb-2 stroke-[1.5]" />
                <p className="text-sm font-semibold text-zinc-900">
                  Todavía no hay beneficios en esta vista
                </p>
                <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                  Creá cuotas sin interés, códigos de descuento o porcentajes automáticos por monto
                  para tus clientes desde el formulario.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredBenefits.map((benefit) => {
                  const isPersonal = benefit.targetUserId !== 'all';
                  const expired = isBenefitExpired(benefit);
                  const formattedExpiry = formatExpirationDate(benefit.expiresAt);
                  return (
                    <li
                      key={benefit.id}
                      className={`bg-white border rounded-xl p-4 transition-colors ${
                        editingId === benefit.id
                          ? 'border-blue-700 ring-1 ring-blue-700/20'
                          : 'border-zinc-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            {renderTypeIcon(benefit.type)}
                            <span className="text-[11px] font-semibold text-zinc-700">
                              {getBenefitTypeLabel(benefit.type)}
                            </span>
                            <span className="text-zinc-300">·</span>
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                isPersonal ? 'text-blue-700' : 'text-zinc-600'
                              }`}
                            >
                              {isPersonal ? (
                                <User className="w-3 h-3" />
                              ) : (
                                <Users className="w-3 h-3" />
                              )}
                              {benefit.targetUserName}
                            </span>
                            <span className="text-zinc-300">·</span>
                            <span
                              className={`text-[11px] font-semibold ${
                                expired
                                  ? 'text-red-600'
                                  : benefit.active
                                    ? 'text-emerald-700'
                                    : 'text-zinc-400'
                              }`}
                            >
                              {expired ? 'Vencido' : benefit.active ? 'Activo' : 'Pausado'}
                            </span>
                          </div>

                          <p className="text-sm font-semibold text-zinc-950">{benefit.title}</p>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-zinc-600 font-mono">
                            {benefit.type === 'installments' && (
                              <span className="text-blue-700 font-semibold">
                                Hasta {benefit.maxInstallments} cuotas sin interés
                              </span>
                            )}
                            {benefit.type === 'promo_code' && (
                              <>
                                <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-amber-900 font-semibold">
                                  {benefit.promoCode}
                                </span>
                                <span className="text-emerald-700 font-semibold">
                                  {benefit.discountPercent}% OFF
                                </span>
                              </>
                            )}
                            {benefit.type === 'min_amount_discount' && (
                              <>
                                <span className="text-emerald-700 font-semibold">
                                  {benefit.discountPercent}% OFF automático
                                </span>
                                <span>
                                  en compras ≥ {formatCurrency(benefit.minOrderAmount)}
                                </span>
                              </>
                            )}
                            {benefit.type !== 'min_amount_discount' &&
                              benefit.minOrderAmount > 0 && (
                                <span className="text-zinc-500">
                                  Mín. {formatCurrency(benefit.minOrderAmount)}
                                </span>
                              )}
                            {formattedExpiry && (
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  expired ? 'text-red-600 font-semibold' : 'text-zinc-600'
                                }`}
                              >
                                <Calendar className="w-3 h-3" />
                                {expired
                                  ? `Venció el ${formattedExpiry}`
                                  : `Vence ${formattedExpiry}`}
                              </span>
                            )}
                          </div>

                          {benefit.description && (
                            <p className="text-xs text-zinc-500 mt-1.5">{benefit.description}</p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(benefit)}
                              className="px-2.5 py-1 text-[11px] font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md cursor-pointer"
                            >
                              {benefit.active ? 'Pausar' : 'Activar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => populateFromBenefit(benefit)}
                              title="Editar beneficio"
                              aria-label="Editar beneficio"
                              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-600 hover:text-blue-700 hover:bg-zinc-100 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(benefit.id)}
                              title="Eliminar beneficio"
                              aria-label="Eliminar beneficio"
                              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {confirmDeleteId === benefit.id && (
                            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                              <span className="text-[11px] text-red-700 font-medium">
                                ¿Eliminar?
                              </span>
                              <button
                                type="button"
                                disabled={deletingId === benefit.id}
                                onClick={() => void handleDelete(benefit.id)}
                                className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
                              >
                                {deletingId === benefit.id ? '...' : 'Sí'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[11px] text-zinc-600 hover:underline cursor-pointer"
                              >
                                No
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
