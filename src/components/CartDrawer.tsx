import { useEffect, useState } from 'react';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { evaluateOrderBenefits, formatCurrency } from '../lib/validation';
import type { AppUser, CartItem, CustomerBenefit, StoreSettings } from '../types/ecommerce';
import { ProductImage } from './ProductImage';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  shippingSettings: StoreSettings;
  benefits: CustomerBenefit[];
  user: AppUser | null;
  promoCode: string;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemoveItem: (productId: string) => void;
  onApplyPromo: (code: string) => void;
  onProceedToCheckout: () => void;
}

export function CartDrawer({
  open,
  onClose,
  items,
  shippingSettings,
  benefits,
  user,
  onUpdateQuantity,
  onRemoveItem,
  promoCode,
  onApplyPromo,
  onProceedToCheckout,
}: CartDrawerProps) {
  const [codeInput, setCodeInput] = useState(promoCode);
  const [promoFeedback, setPromoFeedback] = useState('');
  const [promoFeedbackTone, setPromoFeedbackTone] = useState<'success' | 'error'>('success');

  useEffect(() => {
    setCodeInput(promoCode);
    if (!promoCode) {
      setPromoFeedback('');
    }
  }, [promoCode]);

  if (!open) return null;

  const threshold = Math.max(0, shippingSettings.freeShippingThreshold);
  const baseShippingCost = Math.max(0, shippingSettings.standardShippingCost);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const benefitEval = evaluateOrderBenefits({
    subtotal,
    promoCode,
    benefits,
    userId: user?.uid,
  });

  const discount = benefitEval.combinedBenefitDiscount;
  const netSubtotal = Math.max(0, subtotal - discount);
  const hasFreeShippingProduct = items.some((item) => item.freeShipping);
  const shippingCost =
    items.length === 0 || hasFreeShippingProduct || threshold === 0 || netSubtotal >= threshold
      ? 0
      : baseShippingCost;
  const total = Math.max(0, netSubtotal + shippingCost);
  const remainingForFreeShipping =
    hasFreeShippingProduct || threshold === 0 ? 0 : Math.max(0, threshold - netSubtotal);
  const freeShippingProgress =
    hasFreeShippingProduct || threshold === 0
      ? 100
      : Math.min(100, Math.round((netSubtotal / threshold) * 100));

  const suggestedPromoCode =
    benefitEval.promoBenefits[0]?.promoCode ||
    (benefitEval.promoBenefits.length === 0 ? 'ALBA10' : '');

  function handleApplyCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = codeInput.trim().toUpperCase();
    if (!normalized) {
      onApplyPromo('');
      setPromoFeedback('');
      return;
    }

    const testEval = evaluateOrderBenefits({
      subtotal,
      promoCode: normalized,
      benefits,
      userId: user?.uid,
    });

    if (testEval.promoCodeApplied) {
      onApplyPromo(testEval.promoCodeApplied);
      setPromoFeedbackTone('success');
      setPromoFeedback(
        `Código ${testEval.promoCodeApplied} aplicado: ${testEval.promoDiscountPercent}% de descuento.`,
      );
    } else if (testEval.promoMinNotMetAmount !== null) {
      onApplyPromo(normalized);
      setPromoFeedbackTone('error');
      setPromoFeedback(
        `El código ${normalized} requiere una compra mínima de ${formatCurrency(testEval.promoMinNotMetAmount)}.`,
      );
    } else {
      setPromoFeedbackTone('error');
      setPromoFeedback(
        suggestedPromoCode
          ? `Código inválido o no habilitado para tu cuenta. Probá con ${suggestedPromoCode}.`
          : 'Código inválido o no habilitado para tu cuenta.',
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h2 className="font-display text-base font-bold text-zinc-950">Tu carrito</h2>
            <p className="text-xs text-zinc-500 tabular-nums">
              {items.reduce((s, i) => s + i.quantity, 0)} unidades seleccionadas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar carrito"
            className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Free shipping indicator */}
        {items.length > 0 && (
          <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 space-y-2">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-zinc-700">
                  {remainingForFreeShipping === 0
                    ? 'Tenés envío bonificado en este pedido.'
                    : `Sumá ${formatCurrency(remainingForFreeShipping)} para envío sin cargo`}
                </span>
                <span className="font-mono text-zinc-500 tabular-nums">{freeShippingProgress}%</span>
              </div>
              <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-700 transition-transform origin-left duration-200"
                  style={{ width: `${freeShippingProgress}%` }}
                />
              </div>
            </div>

            {benefitEval.nextThresholdBenefit && (
              <p className="text-[11px] text-emerald-700 font-medium">
                Sumá{' '}
                <span className="font-mono">
                  {formatCurrency(Math.max(1, benefitEval.nextThresholdBenefit.minOrderAmount - subtotal))}
                </span>{' '}
                más para activar {benefitEval.nextThresholdBenefit.discountPercent}% OFF automático.
              </p>
            )}
          </div>
        )}

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <ShoppingBag className="w-10 h-10 text-zinc-300 mb-3 stroke-[1.5]" />
              <p className="text-sm font-semibold text-zinc-900 mb-1">Tu carrito está vacío</p>
              <p className="text-xs text-zinc-500 max-w-xs mb-5">
                Explorá los rubros del catálogo y agregá productos con disponibilidad en tiempo real.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-white bg-zinc-950 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Explorar catálogo
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {items.map((item) => (
                <li key={item.productId} className="py-4 flex gap-4">
                  <div className="w-20 h-16 rounded-lg overflow-hidden bg-zinc-100 shrink-0">
                    <ProductImage
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-950 leading-snug line-clamp-2">
                        {item.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.productId)}
                        aria-label={`Quitar ${item.name}`}
                        className="text-zinc-400 hover:text-red-600 p-1 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {item.categoryLabel} · Stock disp. {item.maxStock} u.
                      {item.freeShipping && (
                        <span className="text-emerald-700 font-medium"> · Envío gratis</span>
                      )}
                    </p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="inline-flex items-center border border-zinc-200 rounded-lg">
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.productId, -1)}
                          aria-label="Restar unidad"
                          className="w-8 h-8 inline-flex items-center justify-center text-zinc-700 hover:bg-zinc-100 rounded-l-lg cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center font-mono text-xs font-medium tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={item.quantity >= item.maxStock}
                          onClick={() => onUpdateQuantity(item.productId, 1)}
                          aria-label="Sumar unidad"
                          className="w-8 h-8 inline-flex items-center justify-center text-zinc-700 hover:bg-zinc-100 disabled:opacity-35 rounded-r-lg cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono text-sm font-semibold text-zinc-950 tabular-nums">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer Totals & Checkout CTA */}
        {items.length > 0 && (
          <div className="border-t border-zinc-200 px-6 py-5 bg-zinc-50 space-y-4">
            <form onSubmit={handleApplyCode} className="flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder={
                  suggestedPromoCode
                    ? `Código de descuento (ej. ${suggestedPromoCode})`
                    : 'Código de descuento'
                }
                className="flex-1 px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 uppercase font-mono"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-medium text-zinc-950 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
              >
                Aplicar
              </button>
            </form>
            {promoFeedback && (
              <p
                className={`text-xs ${
                  promoFeedbackTone === 'success' ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {promoFeedback}
              </p>
            )}
            {!promoFeedback && benefitEval.promoMinNotMetAmount !== null && (
              <p className="text-xs text-amber-700">
                El código {promoCode.trim().toUpperCase()} requiere compras desde{' '}
                {formatCurrency(benefitEval.promoMinNotMetAmount)}.
              </p>
            )}

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              {benefitEval.promoDiscount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>
                    Código {benefitEval.promoCodeApplied} ({benefitEval.promoDiscountPercent}%)
                  </span>
                  <span className="font-mono tabular-nums">
                    -{formatCurrency(benefitEval.promoDiscount)}
                  </span>
                </div>
              )}
              {benefitEval.thresholdDiscount > 0 && benefitEval.matchedThresholdBenefit && (
                <div className="flex justify-between text-emerald-700">
                  <span>
                    Descuento compra ≥{' '}
                    {formatCurrency(benefitEval.matchedThresholdBenefit.minOrderAmount)} (
                    {benefitEval.matchedThresholdBenefit.discountPercent}%)
                  </span>
                  <span className="font-mono tabular-nums">
                    -{formatCurrency(benefitEval.thresholdDiscount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-zinc-600">
                <span>Envío estándar</span>
                <span className="font-mono tabular-nums">
                  {shippingCost === 0 ? 'Sin cargo' : formatCurrency(shippingCost)}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-zinc-950 pt-2 border-t border-zinc-200">
                <span>Total</span>
                <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
              </div>
              {benefitEval.maxInstallments > 1 && (
                <p className="text-[11px] text-blue-700 font-medium text-right font-mono tabular-nums">
                  Hasta {benefitEval.maxInstallments} cuotas sin interés de{' '}
                  {formatCurrency(total / benefitEval.maxInstallments)}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onProceedToCheckout}
              className="w-full py-3 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
            >
              <span>Ir a pasarela de pagos</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
