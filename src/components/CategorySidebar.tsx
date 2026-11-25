import { Bell, Check, ChevronRight, SlidersHorizontal, Truck, X } from 'lucide-react';
import type { PushPermissionState } from '../lib/pushNotifications';
import { formatCurrency } from '../lib/validation';
import { CATEGORIES, type CategoryDefinition, type CategoryId, type Product } from '../types/ecommerce';

interface CategorySidebarProps {
  categories?: CategoryDefinition[];
  products: Product[];
  selectedCategory: CategoryId | 'all';
  onSelectCategory: (cat: CategoryId | 'all') => void;
  onlyFreeShipping: boolean;
  onToggleFreeShipping: () => void;
  freeShippingCount: number;
  onlyInStock: boolean;
  onToggleInStock: () => void;
  maxPrice: number;
  priceCeiling: number;
  onChangeMaxPrice: (val: number) => void;
  onResetFilters: () => void;
  pushPermission: PushPermissionState;
  onEnablePush: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function CategorySidebar({
  categories = CATEGORIES,
  products,
  selectedCategory,
  onSelectCategory,
  onlyFreeShipping,
  onToggleFreeShipping,
  freeShippingCount,
  onlyInStock,
  onToggleInStock,
  maxPrice,
  priceCeiling,
  onChangeMaxPrice,
  onResetFilters,
  pushPermission,
  onEnablePush,
  mobileOpen,
  onCloseMobile,
}: CategorySidebarProps) {
  const categoryCounts = categories.reduce(
    (acc, cat) => {
      acc[cat.id] = products.filter((p) => p.category === cat.id).length;
      return acc;
    },
    {} as Record<CategoryId, number>,
  );

  const hasActiveFilters =
    selectedCategory !== 'all' || onlyFreeShipping || onlyInStock || maxPrice < priceCeiling;

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between pb-4 border-b border-zinc-200">
        <div className="flex items-center gap-2 text-zinc-950">
          <SlidersHorizontal className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold tracking-tight">Rubros y filtros</h2>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Free Shipping Toggle above Rubros */}
      <div className="py-4 border-b border-zinc-200">
        <button
          type="button"
          role="switch"
          aria-checked={onlyFreeShipping}
          onClick={onToggleFreeShipping}
          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
            onlyFreeShipping
              ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
              : 'bg-white border-zinc-200 text-zinc-800 hover:border-zinc-400'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Truck
              className={`w-4 h-4 shrink-0 ${
                onlyFreeShipping ? 'text-emerald-700' : 'text-zinc-500'
              }`}
            />
            <span className="text-xs font-semibold truncate">Envío gratis</span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                onlyFreeShipping ? 'text-emerald-700 font-medium' : 'text-zinc-500'
              }`}
            >
              ({freeShippingCount})
            </span>
          </span>
          <span
            className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
              onlyFreeShipping ? 'bg-emerald-600 justify-end' : 'bg-zinc-300 justify-start'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
          </span>
        </button>
      </div>

      {/* Category Navigation List */}
      <nav aria-label="Rubros de productos" className="py-4 space-y-1 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => {
            onSelectCategory('all');
            onCloseMobile();
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-zinc-950 text-white font-medium'
              : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
          }`}
        >
          <span className="truncate">Todos los rubros</span>
          <span
            className={`font-mono text-xs tabular-nums ${
              selectedCategory === 'all' ? 'text-zinc-300' : 'text-zinc-400'
            }`}
          >
            {products.length}
          </span>
        </button>

        {categories.map((category) => {
          const active = selectedCategory === category.id;
          const count = categoryCounts[category.id] || 0;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                onSelectCategory(category.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                active
                  ? 'bg-zinc-950 text-white font-medium'
                  : count === 0 && onlyFreeShipping
                    ? 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                    : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
              }`}
            >
              <span className="truncate pr-2">{category.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                <span
                  className={`font-mono text-xs tabular-nums ${
                    active
                      ? 'text-zinc-300'
                      : count === 0 && onlyFreeShipping
                        ? 'text-zinc-300'
                        : 'text-zinc-400'
                  }`}
                >
                  {count}
                </span>
                {active && <ChevronRight className="w-3.5 h-3.5 text-zinc-300" />}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Price Filter */}
      <div className="py-5 border-b border-zinc-200">
        <div className="flex items-center justify-between mb-2.5">
          <label htmlFor="price-range-slider" className="text-xs font-semibold text-zinc-900">
            Precio máximo
          </label>
          <span className="font-mono text-xs font-medium text-zinc-700 tabular-nums">
            {formatCurrency(maxPrice)}
          </span>
        </div>
        <input
          id="price-range-slider"
          type="range"
          min={50000}
          max={priceCeiling}
          step={10000}
          value={maxPrice}
          onChange={(e) => onChangeMaxPrice(Number(e.target.value))}
          className="w-full accent-blue-700 cursor-pointer"
        />
        <div className="flex justify-between mt-1 font-mono text-[11px] text-zinc-400 tabular-nums">
          <span>{formatCurrency(50000)}</span>
          <span>{formatCurrency(priceCeiling)}</span>
        </div>
      </div>

      {/* Availability Filter */}
      <div className="py-5 border-b border-zinc-200">
        <button
          type="button"
          onClick={onToggleInStock}
          className="w-full flex items-center justify-between text-sm text-zinc-800 cursor-pointer py-1"
        >
          <span>Solo con stock inmediato</span>
          <span
            className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
              onlyInStock
                ? 'bg-blue-700 border-blue-700 text-white'
                : 'bg-white border-zinc-300 text-transparent'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* Push Notifications Quick Control */}
      <div className="pt-5 mt-auto">
        <div className="bg-zinc-100/80 rounded-xl p-4">
          <div className="flex items-center gap-2 text-zinc-900 mb-1.5">
            <Bell className="w-4 h-4 text-blue-700 shrink-0" />
            <span className="text-xs font-semibold">Alertas de envíos y stock</span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed mb-3">
            {pushPermission === 'granted'
              ? 'Las notificaciones push están activas en este navegador.'
              : 'Recibí avisos en tiempo real cuando tu pedido cambie de estado.'}
          </p>
          {pushPermission === 'granted' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              Notificaciones activadas
            </span>
          ) : (
            <button
              type="button"
              onClick={onEnablePush}
              className="w-full px-3 py-2 text-xs font-medium text-zinc-950 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
            >
              Activar alertas push
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Left Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-zinc-200 pr-6">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile / Tablet Slide-Over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-zinc-950/40 backdrop-blur-[1px]"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-80 max-w-[85vw] bg-white h-full p-5 shadow-xl flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="font-display text-base font-bold text-zinc-950">
                Explorar rubros
              </span>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Cerrar menú de rubros"
                className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1">{sidebarContent}</div>
          </div>
        </div>
      )}
    </>
  );
}
