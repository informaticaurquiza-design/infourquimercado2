import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Minus,
  Percent,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from 'lucide-react';
import { HERO_BANNER_SLIDES, type HeroBannerSlide } from '../lib/categoryAssets';
import { getProductGallery } from '../lib/imageTools';
import type { PushPermissionState } from '../lib/pushNotifications';
import {
  evaluateOrderBenefits,
  formatBenefitSummary,
  formatCurrency,
  formatExpirationDate,
  getBenefitTypeLabel,
  getProductActiveBenefit,
} from '../lib/validation';
import {
  CATEGORY_MAP,
  type AppUser,
  type CategoryId,
  type CustomerBenefit,
  type Product,
  type StoreSettings,
} from '../types/ecommerce';
import { CategorySidebar } from './CategorySidebar';
import { ProductImage } from './ProductImage';

interface StorefrontViewProps {
  products: Product[];
  loading: boolean;
  shippingSettings: StoreSettings;
  benefits: CustomerBenefit[];
  user: AppUser | null;
  activePromoCode?: string;
  onApplyPromoCode?: (code: string) => void;
  selectedCategory: CategoryId | 'all';
  onSelectCategory: (cat: CategoryId | 'all') => void;
  onAddToCart: (product: Product, qty?: number) => void;
  pushPermission: PushPermissionState;
  onEnablePush: () => void;
  mobileSidebarOpen: boolean;
  onOpenMobileSidebar: () => void;
  onCloseMobileSidebar: () => void;
}

type SortOption = 'featured' | 'price_asc' | 'price_desc' | 'bestselling';

function shuffleItems<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function StorefrontView({
  products,
  loading,
  shippingSettings,
  benefits,
  user,
  activePromoCode = '',
  onApplyPromoCode,
  selectedCategory,
  onSelectCategory,
  onAddToCart,
  pushPermission,
  onEnablePush,
  mobileSidebarOpen,
  onOpenMobileSidebar,
  onCloseMobileSidebar,
}: StorefrontViewProps) {
  const storefrontBenefits = useMemo(
    () =>
      evaluateOrderBenefits({
        subtotal: 0,
        promoCode: '',
        benefits,
        userId: user?.uid,
      }),
    [benefits, user?.uid],
  );
  const heroInstallments = storefrontBenefits.catalogMaxInstallments;

  const discountBannerSlides = useMemo(() => {
    const slides = storefrontBenefits.applicableBenefits.map((benefit) => {
      const expiryLabel = benefit.expiresAt
        ? ` · Vence ${formatExpirationDate(benefit.expiresAt)}`
        : '';
      const personalLabel = benefit.targetUserId !== 'all' ? ' · Exclusivo para vos' : '';

      if (benefit.type === 'promo_code') {
        const minLabel =
          benefit.minOrderAmount > 0
            ? ` en compras desde ${formatCurrency(benefit.minOrderAmount)}`
            : '';
        return {
          id: benefit.id,
          headline: `${benefit.discountPercent}% OFF · Código ${benefit.promoCode}`,
          detail: `${benefit.title}${minLabel}${personalLabel}${expiryLabel}`,
          promoCode: benefit.promoCode,
          kind: 'promo_code' as const,
        };
      }

      if (benefit.type === 'min_amount_discount') {
        return {
          id: benefit.id,
          headline: `${benefit.discountPercent}% OFF automático`,
          detail: `En compras desde ${formatCurrency(benefit.minOrderAmount)} · ${benefit.title}${personalLabel}${expiryLabel}`,
          promoCode: '',
          kind: 'min_amount_discount' as const,
        };
      }

      return {
        id: benefit.id,
        headline: `Hasta ${benefit.maxInstallments} cuotas sin interés`,
        detail: `${benefit.title}${personalLabel}${expiryLabel}`,
        promoCode: '',
        kind: 'installments' as const,
      };
    });

    const hasExplicitDiscount = storefrontBenefits.applicableBenefits.some(
      (b) => b.type === 'promo_code' || b.type === 'min_amount_discount',
    );
    if (!hasExplicitDiscount) {
      slides.push(
        {
          id: 'default-alba10',
          headline: '10% OFF · Código ALBA10',
          detail: 'Aplicá el cupón en tu carrito al finalizar la compra',
          promoCode: 'ALBA10',
          kind: 'promo_code' as const,
        },
        {
          id: 'default-transfer',
          headline: '5% OFF adicional por transferencia',
          detail: 'Descuento automático pagando por transferencia bancaria',
          promoCode: '',
          kind: 'min_amount_discount' as const,
        },
      );
    }

    return shuffleItems(slides).slice(0, 10);
  }, [storefrontBenefits.applicableBenefits]);

  const [discountBannerIndex, setDiscountBannerIndex] = useState(0);
  const [discountBannerPaused, setDiscountBannerPaused] = useState(false);

  useEffect(() => {
    setDiscountBannerIndex((prev) =>
      discountBannerSlides.length > 0 ? prev % discountBannerSlides.length : 0,
    );
  }, [discountBannerSlides.length]);

  useEffect(() => {
    if (discountBannerSlides.length <= 1 || discountBannerPaused) return;
    const timer = window.setInterval(() => {
      setDiscountBannerIndex((prev) => (prev + 1) % discountBannerSlides.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [discountBannerSlides.length, discountBannerPaused]);

  const activeDiscountSlide =
    discountBannerSlides[discountBannerIndex] ?? discountBannerSlides[0] ?? null;

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('featured');
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);

  const priceCeiling = useMemo(() => {
    const maxFound = products.reduce((m, p) => Math.max(m, p.price), 500000);
    return Math.ceil(maxFound / 50000) * 50000;
  }, [products]);

  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const effectiveMaxPrice = maxPrice === null ? priceCeiling : Math.min(maxPrice, priceCeiling);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [cardQuantities, setCardQuantities] = useState<Record<string, string>>({});
  const [recentlyAdded, setRecentlyAdded] = useState<{ id: string; qty: number } | null>(null);
  const [heroBannerSlides] = useState<HeroBannerSlide[]>(() =>
    shuffleItems(HERO_BANNER_SLIDES),
  );
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const handledSharedProductRef = useRef<string | null>(null);

  useEffect(() => {
    if (heroBannerSlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setHeroSlideIndex((prev) => (prev + 1) % heroBannerSlides.length);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [heroBannerSlides.length]);

  useEffect(() => {
    if (typeof window === 'undefined' || products.length === 0) return;
    const sharedParam = new URLSearchParams(window.location.search).get('producto')?.trim();
    if (!sharedParam || handledSharedProductRef.current === sharedParam) return;
    const match = products.find(
      (p) => p.id === sharedParam || p.sku.toLowerCase() === sharedParam.toLowerCase(),
    );
    if (!match) return;
    handledSharedProductRef.current = sharedParam;
    setSelectedProduct(match);
    setDetailQty(match.stock > 0 ? 1 : 0);
    setDetailImageIndex(0);
  }, [products]);

  function openProductDetail(product: Product) {
    setSelectedProduct(product);
    setDetailQty(getCardQuantityValue(product));
    setDetailImageIndex(0);
  }

  function getCardQuantityValue(product: Product): number {
    if (product.stock <= 0) return 0;
    const raw = cardQuantities[product.id];
    const parsed = raw === undefined || raw === '' ? 1 : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(product.stock, parsed);
  }

  function handleCardQuantityChange(product: Product, rawValue: string) {
    const digits = rawValue.replace(/\D/g, '');
    if (digits === '') {
      setCardQuantities((prev) => ({ ...prev, [product.id]: '' }));
      return;
    }
    const parsed = Number.parseInt(digits, 10);
    const clamped = Math.min(Math.max(1, product.stock), Math.max(1, parsed));
    setCardQuantities((prev) => ({ ...prev, [product.id]: String(clamped) }));
  }

  function handleCardQuantityBlur(product: Product) {
    if (product.stock <= 0) return;
    const valid = getCardQuantityValue(product);
    setCardQuantities((prev) => ({ ...prev, [product.id]: String(valid) }));
  }

  function qualifiesForFreeShipping(product: Product): boolean {
    return (
      Boolean(product.freeShipping) ||
      shippingSettings.freeShippingThreshold === 0 ||
      product.price >= shippingSettings.freeShippingThreshold
    );
  }

  const freeShippingProducts = useMemo(
    () => products.filter((p) => qualifiesForFreeShipping(p)),
    [products, shippingSettings.freeShippingThreshold],
  );

  const freeShippingCount = freeShippingProducts.length;
  const sidebarProducts = onlyFreeShipping ? freeShippingProducts : products;

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (onlyFreeShipping && !qualifiesForFreeShipping(p)) return false;
      if (onlyInStock && p.stock <= 0) return false;
      if (p.price > effectiveMaxPrice) return false;
      if (q) {
        const match =
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.categoryLabel.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    const sorted = [...list];
    switch (sortBy) {
      case 'price_asc':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        sorted.sort((a, b) => b.price - a.price);
        break;
      case 'bestselling':
        sorted.sort((a, b) => b.soldCount - a.soldCount);
        break;
      default:
        sorted.sort((a, b) => {
          if (onlyFreeShipping) {
            const freeDiff = Number(Boolean(b.freeShipping)) - Number(Boolean(a.freeShipping));
            if (freeDiff !== 0) return freeDiff;
          }
          return Number(b.featured) - Number(a.featured) || b.soldCount - a.soldCount;
        });
    }
    return sorted;
  }, [
    products,
    selectedCategory,
    onlyFreeShipping,
    onlyInStock,
    effectiveMaxPrice,
    searchQuery,
    sortBy,
    shippingSettings.freeShippingThreshold,
  ]);

  function handleQuickAdd(product: Product, qty = 1) {
    if (product.stock <= 0) return;
    const safeQty = Math.min(product.stock, Math.max(1, qty));
    onAddToCart(product, safeQty);
    setRecentlyAdded({ id: product.id, qty: safeQty });
    window.setTimeout(() => {
      setRecentlyAdded((curr) => (curr?.id === product.id ? null : curr));
    }, 1200);
  }

  function handleToggleFreeShipping() {
    const nextEnabled = !onlyFreeShipping;
    setOnlyFreeShipping(nextEnabled);
    if (nextEnabled) {
      onSelectCategory('all');
      setSearchQuery('');
      setMaxPrice(null);
      setOnlyInStock(false);
      onCloseMobileSidebar();
      window.requestAnimationFrame(() => {
        document.getElementById('catalogo-principal')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }
  }

  function handleResetFilters() {
    onSelectCategory('all');
    setOnlyFreeShipping(false);
    setOnlyInStock(false);
    setMaxPrice(null);
    setSearchQuery('');
  }

  const activeCategoryMeta = selectedCategory === 'all' ? null : CATEGORY_MAP[selectedCategory];

  // Keep selectedProduct synced with real-time stock from products array
  const liveSelectedProduct = selectedProduct
    ? products.find((p) => p.id === selectedProduct.id) ?? selectedProduct
    : null;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pb-20">
      {/* Editorial Storefront Hero — 2-column stretch split with single dominant focal anchor */}
      <section className="pt-8 pb-10 border-b border-zinc-200">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between py-2">
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-4">
                Colección Contemporánea · Despacho en 24 hs
              </p>
              <h1
                className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-zinc-950 leading-[1.12] mb-5"
                style={{ textWrap: 'balance' }}
              >
                Objetos diseñados para durar, con inventario en vivo.
              </h1>
              <p className="text-base text-zinc-600 leading-relaxed max-w-lg mb-8">
                Explorá seis rubros curados de tecnología, iluminación, relojería e indumentaria
                técnica. Pagá en cuotas sin interés y seguí cada etapa de tu envío en tiempo real.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="#catalogo-principal"
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap"
                >
                  Explorar catálogo
                  <ArrowDownRight className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onSelectCategory('tecnologia');
                    document.getElementById('catalogo-principal')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-5 py-3 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Ver Tecnología & Audio
                </button>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-zinc-200">
              <div
                className="rounded-xl bg-zinc-950 text-white border border-zinc-800 px-4 py-3 transition-colors"
                onMouseEnter={() => setDiscountBannerPaused(true)}
                onMouseLeave={() => setDiscountBannerPaused(false)}
                onFocus={() => setDiscountBannerPaused(true)}
                onBlur={() => setDiscountBannerPaused(false)}
              >
                {activeDiscountSlide && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 inline-flex items-center justify-center shrink-0">
                        {activeDiscountSlide.kind === 'promo_code' ? (
                          <Tag className="w-4 h-4" />
                        ) : activeDiscountSlide.kind === 'installments' ? (
                          <CreditCard className="w-4 h-4" />
                        ) : (
                          <Percent className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-white tabular-nums truncate">
                          {activeDiscountSlide.headline}
                        </p>
                        <p className="text-xs text-zinc-300 mt-0.5 truncate">
                          {activeDiscountSlide.detail}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeDiscountSlide.promoCode && onApplyPromoCode && (
                        <button
                          type="button"
                          onClick={() => onApplyPromoCode(activeDiscountSlide.promoCode)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                            activePromoCode.trim().toUpperCase() ===
                            activeDiscountSlide.promoCode.trim().toUpperCase()
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white text-zinc-950 hover:bg-blue-600 hover:text-white'
                          }`}
                        >
                          {activePromoCode.trim().toUpperCase() ===
                          activeDiscountSlide.promoCode.trim().toUpperCase() ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Aplicado</span>
                            </>
                          ) : (
                            <span>Aplicar</span>
                          )}
                        </button>
                      )}

                      {discountBannerSlides.length > 1 && (
                        <div className="inline-flex items-center gap-0.5 pl-1 border-l border-zinc-800">
                          <button
                            type="button"
                            onClick={() =>
                              setDiscountBannerIndex(
                                (prev) =>
                                  (prev - 1 + discountBannerSlides.length) %
                                  discountBannerSlides.length,
                              )
                            }
                            aria-label="Descuento anterior"
                            className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDiscountBannerIndex(
                                (prev) => (prev + 1) % discountBannerSlides.length,
                              )
                            }
                            aria-label="Siguiente descuento"
                            className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {discountBannerSlides.length > 1 && (
                  <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-zinc-800/80">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                      Descuentos vigentes ({discountBannerIndex + 1}/{discountBannerSlides.length})
                    </span>
                    <div
                      className="flex items-center gap-1"
                      role="tablist"
                      aria-label="Banner de descuentos vigentes"
                    >
                      {discountBannerSlides.map((slide, idx) => {
                        const isActive = idx === discountBannerIndex;
                        return (
                          <button
                            key={slide.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-label={`Ver descuento ${idx + 1}: ${slide.headline}`}
                            onClick={() => setDiscountBannerIndex(idx)}
                            className={`h-1 rounded-full transition-all cursor-pointer ${
                              isActive ? 'w-4 bg-blue-400' : 'w-1.5 bg-zinc-600 hover:bg-zinc-400'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="group relative h-72 sm:h-96 lg:h-full min-h-[340px] rounded-xl overflow-hidden bg-zinc-100 border border-zinc-200">
              {heroBannerSlides.map((slide, idx) => {
                const isActive = idx === heroSlideIndex;
                return (
                  <div
                    key={slide.id}
                    aria-hidden={!isActive}
                    className={`absolute inset-0 transition-opacity duration-500 ease-out ${
                      isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                    }`}
                  >
                    <ProductImage
                      src={slide.src}
                      alt={slide.alt}
                      fit="cover"
                      className="w-full h-full object-cover"
                    />
                  </div>
                );
              })}

              {/* Subtle Previous / Next Arrows on Hover */}
              <button
                type="button"
                onClick={() =>
                  setHeroSlideIndex(
                    (prev) => (prev - 1 + heroBannerSlides.length) % heroBannerSlides.length,
                  )
                }
                aria-label="Imagen anterior del banner"
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-zinc-950/55 hover:bg-zinc-950/80 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setHeroSlideIndex((prev) => (prev + 1) % heroBannerSlides.length)
                }
                aria-label="Siguiente imagen del banner"
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-zinc-950/55 hover:bg-zinc-950/80 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Bottom Caption & 10-Slide Progress Indicators */}
              <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-zinc-950/70 via-zinc-950/25 to-transparent px-4 pt-8 pb-3 flex items-end justify-between gap-3">
                <span className="text-xs font-medium text-white/95 truncate">
                  {heroBannerSlides[heroSlideIndex]?.caption}
                </span>
                <div className="flex items-center gap-1.5 shrink-0" role="tablist" aria-label="Imágenes del banner">
                  {heroBannerSlides.map((slide, idx) => {
                    const isActive = idx === heroSlideIndex;
                    return (
                      <button
                        key={slide.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-label={`Ver imagen ${idx + 1} de ${heroBannerSlides.length}: ${slide.caption}`}
                        onClick={() => setHeroSlideIndex(idx)}
                        className={`h-1.5 rounded-full transition-all cursor-pointer ${
                          isActive
                            ? 'w-5 bg-white'
                            : 'w-1.5 bg-white/45 hover:bg-white/80'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Catalog Workspace: Left Rubros Menu + Right Product Grid */}
      <section id="catalogo-principal" className="pt-10 flex flex-col lg:flex-row gap-8">
        <CategorySidebar
          products={sidebarProducts}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onlyFreeShipping={onlyFreeShipping}
          onToggleFreeShipping={handleToggleFreeShipping}
          freeShippingCount={freeShippingCount}
          onlyInStock={onlyInStock}
          onToggleInStock={() => setOnlyInStock((v) => !v)}
          maxPrice={effectiveMaxPrice}
          priceCeiling={priceCeiling}
          onChangeMaxPrice={setMaxPrice}
          onResetFilters={handleResetFilters}
          pushPermission={pushPermission}
          onEnablePush={onEnablePush}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={onCloseMobileSidebar}
        />

        <div className="flex-1 min-w-0">
          {/* Catalog Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-950">
                {onlyFreeShipping
                  ? activeCategoryMeta
                    ? `${activeCategoryMeta.label} · Envío gratis`
                    : 'Productos con envío gratis'
                  : activeCategoryMeta
                    ? activeCategoryMeta.label
                    : 'Catálogo completo'}
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                {onlyFreeShipping
                  ? shippingSettings.freeShippingThreshold === 0
                    ? 'Todos los productos cuentan con envío bonificado.'
                    : `Incluye productos con envío gratis activo o compras desde ${formatCurrency(shippingSettings.freeShippingThreshold)}.`
                  : activeCategoryMeta
                    ? activeCategoryMeta.description
                    : 'Stock sincronizado al instante con nuestro depósito central.'}{' '}
                <span className="font-mono text-xs text-zinc-700 tabular-nums">
                  · {filteredProducts.length}{' '}
                  {filteredProducts.length === 1 ? 'producto' : 'productos'}
                </span>
                {onlyFreeShipping && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => setOnlyFreeShipping(false)}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                    >
                      Ver todo el catálogo
                    </button>
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onOpenMobileSidebar}
                className="lg:hidden inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 rounded-lg cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Rubros y filtros
              </button>

              <div className="relative flex-1 sm:flex-initial min-w-[210px]">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar producto o SKU..."
                  aria-label="Buscar producto o SKU"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="relative inline-flex items-center">
                <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Ordenar productos"
                  className="pl-8 pr-7 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 cursor-pointer"
                >
                  <option value="featured">Destacados</option>
                  <option value="bestselling">Más vendidos</option>
                  <option value="price_asc">Menor precio</option>
                  <option value="price_desc">Mayor precio</option>
                </select>
              </div>
            </div>
          </div>

          {/* Product Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 pt-8">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                  <div className="aspect-[4/3] bg-zinc-100 animate-pulse" />
                  <div className="p-5 space-y-3">
                    <div className="h-3 w-24 bg-zinc-100 rounded animate-pulse" />
                    <div className="h-5 w-4/5 bg-zinc-100 rounded animate-pulse" />
                    <div className="h-4 w-1/3 bg-zinc-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-16 text-center bg-white border border-zinc-200 rounded-xl mt-8 px-6">
              <p className="text-base font-semibold text-zinc-950 mb-1">
                No encontramos productos con esos filtros
              </p>
              <p className="text-sm text-zinc-500 mb-5">
                Probá ampliando el rango de precio o seleccionando otro rubro del menú izquierdo.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-4 py-2 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              >
                Mostrar todos los rubros
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 pt-8">
              {filteredProducts.map((product) => {
                const isOutOfStock = product.stock <= 0;
                const isLowStock = !isOutOfStock && product.stock <= product.minStockThreshold;
                const isAdded = recentlyAdded?.id === product.id;
                const photoCount = getProductGallery(product).length;
                const productBenefit = getProductActiveBenefit(product, benefits, user?.uid);
                const productBenefitExpiry = productBenefit
                  ? formatExpirationDate(productBenefit.expiresAt)
                  : '';

                return (
                  <article
                    key={product.id}
                    className="group bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => openProductDetail(product)}
                      className="flex items-center justify-center relative w-full aspect-[4/3] bg-zinc-50 border-b border-zinc-100 overflow-hidden text-left cursor-pointer"
                    >
                      <ProductImage
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </button>

                    <div className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 mb-1.5">
                          <span className="truncate">
                            {product.categoryLabel}
                            {qualifiesForFreeShipping(product) && (
                              <span className="text-emerald-700 font-medium"> · Envío gratis</span>
                            )}
                            {photoCount > 1 && (
                              <span className="text-zinc-400"> · {photoCount} fotos</span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                            {product.sku}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => openProductDetail(product)}
                          className="text-left cursor-pointer"
                        >
                          <h3 className="font-display text-base font-semibold text-zinc-950 leading-snug group-hover:text-blue-700 transition-colors line-clamp-2">
                            {product.name}
                          </h3>
                        </button>

                        <p className="text-xs text-zinc-500 mt-2 line-clamp-2 leading-relaxed">
                          {product.description}
                        </p>

                        {productBenefit && (
                          <div
                            className={`mt-3 px-2.5 py-2 rounded-lg border text-[11px] leading-snug ${
                              productBenefit.type === 'installments'
                                ? 'bg-blue-50/80 border-blue-200 text-blue-900'
                                : productBenefit.type === 'promo_code'
                                  ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-semibold">
                              {productBenefit.type === 'installments' ? (
                                <CreditCard className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                              ) : productBenefit.type === 'promo_code' ? (
                                <Tag className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              ) : (
                                <Percent className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              )}
                              <span>{getBenefitTypeLabel(productBenefit.type)}</span>
                            </div>
                            <p className="mt-0.5 font-mono font-medium">
                              {formatBenefitSummary(productBenefit)}
                            </p>
                            {productBenefitExpiry && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] opacity-80 font-mono">
                                <Calendar className="w-3 h-3 shrink-0" />
                                Válido hasta {productBenefitExpiry}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-5 mt-4 border-t border-zinc-100">
                        <div className="flex items-baseline justify-between gap-2 mb-3">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-base font-semibold text-zinc-950 tabular-nums">
                              {formatCurrency(product.price)}
                            </span>
                            {product.compareAtPrice && product.compareAtPrice > product.price && (
                              <span className="font-mono text-xs text-zinc-400 line-through tabular-nums">
                                {formatCurrency(product.compareAtPrice)}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-xs font-medium tabular-nums ${
                              isOutOfStock
                                ? 'text-red-600'
                                : isLowStock
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {isOutOfStock
                              ? 'Sin stock'
                              : isLowStock
                                ? `Últimas ${product.stock} u.`
                                : `${product.stock} disponibles`}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.max(1, product.stock)}
                            disabled={isOutOfStock}
                            aria-label={`Cantidad para ${product.name}`}
                            title="Cantidad a comprar"
                            value={isOutOfStock ? 0 : (cardQuantities[product.id] ?? '1')}
                            onChange={(e) => handleCardQuantityChange(product, e.target.value)}
                            onBlur={() => handleCardQuantityBlur(product)}
                            className="w-14 h-9 px-2 text-center font-mono text-xs font-medium text-zinc-950 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed tabular-nums shrink-0"
                          />
                          <button
                            type="button"
                            disabled={isOutOfStock}
                            onClick={() => {
                              const qtyToAdd = getCardQuantityValue(product);
                              handleQuickAdd(product, qtyToAdd);
                              setCardQuantities((prev) => ({ ...prev, [product.id]: '1' }));
                            }}
                            className={`flex-1 min-w-0 h-9 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 ${
                              isAdded
                                ? 'bg-emerald-700 text-white'
                                : 'bg-zinc-950 hover:bg-blue-700 text-white'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-3.5 h-3.5 shrink-0" />
                                {recentlyAdded && recentlyAdded.qty > 1
                                  ? `Agregado (${recentlyAdded.qty})`
                                  : 'Agregado'}
                              </>
                            ) : isOutOfStock ? (
                              'Agotado'
                            ) : (
                              'Agregar al carrito'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => openProductDetail(product)}
                            className="h-9 px-2.5 text-xs font-medium text-zinc-700 hover:text-zinc-950 border border-zinc-200 hover:border-zinc-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer shrink-0"
                          >
                            Detalles
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Product Detail Modal — Contiguous Purchase Module */}
      {liveSelectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[1px]"
            onClick={() => setSelectedProduct(null)}
          />
          <div className="relative z-10 w-full max-w-3xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div className="text-xs text-zinc-500">
                <span>{liveSelectedProduct.categoryLabel}</span>
                <span className="mx-2">·</span>
                <span className="font-mono">{liveSelectedProduct.sku}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                aria-label="Cerrar detalle de producto"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 overflow-y-auto">
              {(() => {
                const gallery = getProductGallery(liveSelectedProduct);
                const safeIndex = Math.min(detailImageIndex, Math.max(0, gallery.length - 1));
                const activeSrc = gallery[safeIndex] || liveSelectedProduct.imageUrl;

                return (
                  <div className="bg-white border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col justify-between">
                    <div className="relative w-full aspect-[4/3] md:aspect-auto md:min-h-[340px] md:flex-1 bg-zinc-50 flex items-center justify-center p-3 overflow-hidden">
                      <ProductImage
                        src={activeSrc}
                        alt={`${liveSelectedProduct.name} — foto ${safeIndex + 1}`}
                        className="w-full h-full max-h-[420px] object-contain object-center"
                      />

                      {gallery.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailImageIndex(
                                (safeIndex - 1 + gallery.length) % gallery.length,
                              )
                            }
                            aria-label="Foto anterior"
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-zinc-900 shadow-sm border border-zinc-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailImageIndex((safeIndex + 1) % gallery.length)
                            }
                            aria-label="Foto siguiente"
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-zinc-900 shadow-sm border border-zinc-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>

                    {gallery.length > 1 && (
                      <div className="p-3 bg-white border-t border-zinc-200 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-zinc-500">
                          <span>Galería del producto</span>
                          <span className="font-mono tabular-nums">
                            {safeIndex + 1} / {gallery.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {gallery.map((thumbSrc, idx) => (
                            <button
                              key={`${idx}-${thumbSrc.slice(0, 24)}`}
                              type="button"
                              onClick={() => setDetailImageIndex(idx)}
                              aria-label={`Ver foto ${idx + 1}`}
                              className={`aspect-[4/3] rounded-md overflow-hidden border-2 transition-colors cursor-pointer bg-zinc-50 flex items-center justify-center ${
                                idx === safeIndex
                                  ? 'border-blue-700'
                                  : 'border-transparent hover:border-zinc-300'
                              }`}
                            >
                              <ProductImage
                                src={thumbSrc}
                                alt={`${liveSelectedProduct.name} miniatura ${idx + 1}`}
                                className="w-full h-full object-contain object-center"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="p-6 sm:p-8 flex flex-col justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold text-zinc-950 leading-tight mb-3">
                    {liveSelectedProduct.name}
                  </h2>

                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="font-mono text-2xl font-bold text-zinc-950 tabular-nums">
                      {formatCurrency(liveSelectedProduct.price)}
                    </span>
                    {liveSelectedProduct.compareAtPrice &&
                      liveSelectedProduct.compareAtPrice > liveSelectedProduct.price && (
                        <span className="font-mono text-sm text-zinc-400 line-through tabular-nums">
                          {formatCurrency(liveSelectedProduct.compareAtPrice)}
                        </span>
                      )}
                  </div>

                  {(() => {
                    const detailBenefit = getProductActiveBenefit(
                      liveSelectedProduct,
                      benefits,
                      user?.uid,
                    );
                    const detailInstallments =
                      detailBenefit && detailBenefit.type === 'installments'
                        ? detailBenefit.maxInstallments
                        : heroInstallments;
                    const detailBenefitExpiry = detailBenefit
                      ? formatExpirationDate(detailBenefit.expiresAt)
                      : '';
                    const isCodeApplied =
                      detailBenefit?.type === 'promo_code' &&
                      Boolean(detailBenefit.promoCode) &&
                      activePromoCode.trim().toUpperCase() ===
                        detailBenefit.promoCode.trim().toUpperCase();

                    return (
                      <>
                        <p className="text-xs text-zinc-600 mb-4">
                          Hasta {detailInstallments} cuotas sin interés de{' '}
                          <span className="font-mono font-medium text-zinc-900 tabular-nums">
                            {formatCurrency(liveSelectedProduct.price / detailInstallments)}
                          </span>
                          {qualifiesForFreeShipping(liveSelectedProduct) && (
                            <span className="text-emerald-700 font-medium">
                              {' '}
                              · Envío gratis incluido
                            </span>
                          )}
                        </p>

                        {detailBenefit && (
                          <div
                            className={`mb-5 p-3.5 rounded-xl border space-y-1.5 ${
                              detailBenefit.type === 'installments'
                                ? 'bg-blue-50/80 border-blue-200 text-blue-950'
                                : detailBenefit.type === 'promo_code'
                                  ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                                {detailBenefit.type === 'installments' ? (
                                  <CreditCard className="w-4 h-4 text-blue-700 shrink-0" />
                                ) : detailBenefit.type === 'promo_code' ? (
                                  <Tag className="w-4 h-4 text-amber-700 shrink-0" />
                                ) : (
                                  <Percent className="w-4 h-4 text-emerald-700 shrink-0" />
                                )}
                                {getBenefitTypeLabel(detailBenefit.type)} habilitado
                              </span>
                              {detailBenefitExpiry && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono opacity-80">
                                  <Calendar className="w-3 h-3" />
                                  Vence {detailBenefitExpiry}
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono font-semibold">
                              {formatBenefitSummary(detailBenefit)}
                            </p>
                            {detailBenefit.description && (
                              <p className="text-xs opacity-85">{detailBenefit.description}</p>
                            )}
                            {detailBenefit.type === 'promo_code' &&
                              detailBenefit.promoCode &&
                              onApplyPromoCode && (
                                <button
                                  type="button"
                                  onClick={() => onApplyPromoCode(detailBenefit.promoCode)}
                                  className={`mt-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                                    isCodeApplied
                                      ? 'bg-emerald-700 text-white'
                                      : 'bg-zinc-950 text-white hover:bg-blue-700'
                                  }`}
                                >
                                  {isCodeApplied
                                    ? `Código ${detailBenefit.promoCode} aplicado`
                                    : `Aplicar código ${detailBenefit.promoCode}`}
                                </button>
                              )}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <p className="text-sm text-zinc-600 leading-relaxed mb-6">
                    {liveSelectedProduct.description}
                  </p>

                  {liveSelectedProduct.specs.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-xs font-semibold text-zinc-900 mb-2">
                        Especificaciones técnicas
                      </h3>
                      <ul className="space-y-1.5 text-xs text-zinc-600">
                        {liveSelectedProduct.specs.map((spec, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-zinc-400 mt-0.5">—</span>
                            <span>{spec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="pt-5 border-t border-zinc-200 space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Disponibilidad en depósito</span>
                    <span
                      className={`font-medium tabular-nums ${
                        liveSelectedProduct.stock <= 0
                          ? 'text-red-600'
                          : liveSelectedProduct.stock <= liveSelectedProduct.minStockThreshold
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {liveSelectedProduct.stock <= 0
                        ? 'Agotado temporalmente'
                        : `${liveSelectedProduct.stock} unidades en stock`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="inline-flex items-center border border-zinc-300 rounded-lg">
                      <button
                        type="button"
                        disabled={detailQty <= 1}
                        onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                        aria-label="Disminuir cantidad"
                        className="w-10 h-10 inline-flex items-center justify-center text-zinc-700 hover:bg-zinc-100 disabled:opacity-35 rounded-l-lg cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={Math.max(1, liveSelectedProduct.stock)}
                        disabled={liveSelectedProduct.stock <= 0}
                        aria-label="Cantidad a comprar"
                        value={liveSelectedProduct.stock <= 0 ? 0 : detailQty}
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
                          if (!Number.isFinite(parsed)) {
                            setDetailQty(1);
                            return;
                          }
                          setDetailQty(
                            Math.min(Math.max(1, liveSelectedProduct.stock), Math.max(1, parsed)),
                          );
                        }}
                        className="w-12 h-10 text-center font-mono text-sm font-medium text-zinc-950 focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        disabled={detailQty >= liveSelectedProduct.stock}
                        onClick={() =>
                          setDetailQty((q) => Math.min(liveSelectedProduct.stock, q + 1))
                        }
                        aria-label="Aumentar cantidad"
                        className="w-10 h-10 inline-flex items-center justify-center text-zinc-700 hover:bg-zinc-100 disabled:opacity-35 rounded-r-lg cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={liveSelectedProduct.stock <= 0}
                      onClick={() => {
                        handleQuickAdd(liveSelectedProduct, detailQty);
                        setSelectedProduct(null);
                      }}
                      className="flex-1 py-3 px-5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors cursor-pointer"
                    >
                      {liveSelectedProduct.stock <= 0 ? 'Sin stock' : 'Agregar al carrito'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
