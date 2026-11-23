import { Menu, ShoppingBag } from 'lucide-react';
import type { ActiveView, AppUser } from '../types/ecommerce';

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  cartCount: number;
  unreadNotifications: number;
  user: AppUser | null;
  isAdmin: boolean;
  onOpenCart: () => void;
  onOpenAccount: () => void;
  onOpenMobileCategories: () => void;
}

export function Header({
  activeView,
  onNavigate,
  cartCount,
  unreadNotifications,
  user,
  isAdmin,
  onOpenCart,
  onOpenAccount,
  onOpenMobileCategories,
}: HeaderProps) {
  const navItems: { id: ActiveView; label: string; suffix?: string }[] = [
    { id: 'catalog', label: 'Catálogo' },
    { id: 'tracking', label: 'Envíos' },
    {
      id: 'notifications',
      label: 'Alertas',
      suffix: unreadNotifications > 0 ? `(${unreadNotifications})` : undefined,
    },
    { id: 'admin', label: isAdmin ? 'Administración' : 'Panel' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-zinc-200">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-8">
        {/* Zone 1: Single-line Brand Wordmark (+ mobile menu affordance on small screens) */}
        <div className="flex items-center gap-3 shrink-0">
          {activeView === 'catalog' && (
            <button
              type="button"
              onClick={onOpenMobileCategories}
              aria-label="Abrir menú de rubros"
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 -ml-2 text-zinc-700 hover:text-zinc-950 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-700 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="font-display text-lg font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 rounded"
          >
            Infourqui Mercado
          </button>
        </div>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Navegación principal"
          className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 rounded ${
                  isActive
                    ? 'text-zinc-950 font-semibold'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                <span>{item.label}</span>
                {item.suffix && (
                  <span className="ml-1 font-mono text-xs text-blue-700 tabular-nums">
                    {item.suffix}
                  </span>
                )}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-[19px] h-[2px] bg-blue-700" />
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={onOpenAccount}
            className="py-1 text-zinc-600 hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 rounded max-w-[160px] truncate"
          >
            {user ? user.displayName?.split(' ')[0] || 'Mi cuenta' : 'Ingresar'}
          </button>
        </nav>

        {/* Zone 3: 1 primary action button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenAccount}
            className="md:hidden px-3 py-2 text-xs font-medium text-zinc-700 hover:text-zinc-950 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {user ? 'Cuenta' : 'Ingresar'}
          </button>
          <button
            type="button"
            onClick={onOpenCart}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <ShoppingBag className="w-4 h-4 shrink-0" />
            <span>Carrito</span>
            <span className="font-mono text-xs tabular-nums opacity-90">({cartCount})</span>
          </button>
        </div>
      </div>

      {/* Mobile compact navigation row (kept slim to stay well under 15% mobile sticky cap) */}
      <div className="md:hidden border-t border-zinc-100 bg-white overflow-x-auto">
        <div className="flex items-center justify-around px-2 h-11 text-xs font-medium">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`px-3 py-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive ? 'text-blue-700 font-semibold' : 'text-zinc-600'
                }`}
              >
                {item.label}
                {item.suffix ? ` ${item.suffix}` : ''}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
