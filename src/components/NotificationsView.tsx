import { useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, Package, Tag, Trash2, Truck } from 'lucide-react';
import { sendBrowserPush, type PushPermissionState } from '../lib/pushNotifications';
import { formatDateTime } from '../lib/validation';
import { deleteNotificationById, markNotificationRead } from '../services/dataService';
import type { AppNotification, AppUser, NotificationType } from '../types/ecommerce';

interface NotificationsViewProps {
  user: AppUser | null;
  notifications: AppNotification[];
  pushPermission: PushPermissionState;
  onEnablePush: () => Promise<void>;
  onRequireSignIn: () => void;
  onOpenOrderTracking: (orderId: string) => void;
  onNotifyToast: (msg: string) => void;
}

export function NotificationsView({
  user,
  notifications,
  pushPermission,
  onEnablePush,
  onRequireSignIn,
  onOpenOrderTracking,
  onNotifyToast,
}: NotificationsViewProps) {
  const [filterType, setFilterType] = useState<'all' | NotificationType>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const filtered = notifications.filter((n) => (filterType === 'all' ? true : n.type === filterType));
  const unreadMine = notifications.filter((n) => !n.read && n.userId === user?.uid);

  async function handleMarkAllRead() {
    if (!user || unreadMine.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(unreadMine.map((n) => markNotificationRead(n.id)));
      onNotifyToast('Todas tus notificaciones fueron marcadas como leídas.');
    } finally {
      setMarkingAll(false);
    }
  }

  function handleTestPush() {
    const sent = sendBrowserPush(
      'Infourqui Mercado — Alerta de prueba',
      'Las notificaciones push del navegador funcionan correctamente en tiempo real.',
      'infourqui-test-push',
    );
    if (sent) {
      onNotifyToast('Notificación push enviada al sistema operativo.');
    } else {
      onNotifyToast('Primero activá el permiso de notificaciones en tu navegador.');
    }
  }

  function renderIcon(type: NotificationType) {
    switch (type) {
      case 'shipment':
        return <Truck className="w-4 h-4 text-blue-700 shrink-0" />;
      case 'order':
        return <Package className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'promo':
        return <Tag className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'inventory':
        return <Bell className="w-4 h-4 text-zinc-700 shrink-0" />;
    }
  }

  function typeLabel(type: NotificationType): string {
    switch (type) {
      case 'shipment':
        return 'Envío';
      case 'order':
        return 'Pedido';
      case 'promo':
        return 'Beneficio';
      case 'inventory':
        return 'Inventario';
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950">
            Centro de alertas y push
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Recibí actualizaciones instantáneas de pagos, movimientos de logística y avisos de la
            tienda.
          </p>
        </div>

        {unreadMine.length > 0 && (
          <button
            type="button"
            disabled={markingAll}
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Marcar todo leído ({unreadMine.length})
          </button>
        )}
      </div>

      {/* Browser Push Configuration Strip */}
      <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <BellRing className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              Notificaciones push del navegador:{' '}
              <span
                className={
                  pushPermission === 'granted'
                    ? 'text-emerald-700'
                    : pushPermission === 'denied'
                      ? 'text-red-600'
                      : 'text-amber-700'
                }
              >
                {pushPermission === 'granted'
                  ? 'Activas'
                  : pushPermission === 'denied'
                    ? 'Bloqueadas en el navegador'
                    : pushPermission === 'unsupported'
                      ? 'No compatibles en este dispositivo'
                      : 'Pendientes de activación'}
              </span>
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Activá las notificaciones nativas para enterarte cuando tu envío pase a depósito,
              tránsito o reparto local.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {pushPermission === 'granted' ? (
            <button
              type="button"
              onClick={handleTestPush}
              className="px-4 py-2 text-xs font-medium text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Probar alerta push
            </button>
          ) : pushPermission !== 'unsupported' ? (
            <button
              type="button"
              onClick={onEnablePush}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Activar notificaciones push
            </button>
          ) : null}
        </div>
      </div>

      {!user ? (
        <div className="mt-8 bg-white border border-zinc-200 rounded-xl p-10 text-center">
          <Bell className="w-9 h-9 text-zinc-300 mx-auto mb-3 stroke-[1.5]" />
          <h2 className="font-display text-lg font-bold text-zinc-950 mb-1.5">
            Iniciá sesión para ver tus alertas personalizadas
          </h2>
          <p className="text-sm text-zinc-600 mb-6 max-w-md mx-auto">
            Tus confirmaciones de compra y novedades de envío en vivo se sincronizan de forma
            privada con tu cuenta.
          </p>
          <button
            type="button"
            onClick={onRequireSignIn}
            className="px-5 py-2.5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            Ingresar con Google
          </button>
        </div>
      ) : (
        <>
          {/* Filter Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg w-fit mt-6 overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: 'Todas' },
                { id: 'shipment', label: 'Envíos' },
                { id: 'order', label: 'Pedidos' },
                { id: 'promo', label: 'Beneficios' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  filterType === tab.id
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Notifications List */}
          {filtered.length === 0 ? (
            <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-12 text-center">
              <p className="text-sm font-semibold text-zinc-900 mb-1">
                No tenés alertas en esta categoría
              </p>
              <p className="text-xs text-zinc-500">
                Cuando compres o tu envío cambie de etapa, las notificaciones aparecerán aquí.
              </p>
            </div>
          ) : (
            <ul className="mt-6 bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-200 overflow-hidden">
              {filtered.map((notif) => {
                const isPersonal = notif.userId === user.uid;
                return (
                  <li
                    key={notif.id}
                    className={`p-5 flex items-start justify-between gap-4 transition-colors ${
                      !notif.read && isPersonal ? 'bg-blue-50/40' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="mt-0.5">{renderIcon(notif.type)}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 mb-1">
                          <span className="font-medium text-zinc-700">{typeLabel(notif.type)}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {formatDateTime(notif.createdAt)}
                          </span>
                          {!notif.read && isPersonal && (
                            <>
                              <span>·</span>
                              <span className="font-medium text-blue-700">Nueva</span>
                            </>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-zinc-950">{notif.title}</p>
                        <p className="text-sm text-zinc-600 mt-1 leading-relaxed">
                          {notif.message}
                        </p>
                        {notif.orderId && (
                          <button
                            type="button"
                            onClick={() => onOpenOrderTracking(notif.orderId)}
                            className="mt-2.5 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                          >
                            Ver seguimiento del envío →
                          </button>
                        )}
                      </div>
                    </div>

                    {isPersonal && (
                      <div className="flex items-center gap-1 shrink-0">
                        {!notif.read && (
                          <button
                            type="button"
                            onClick={() => void markNotificationRead(notif.id)}
                            title="Marcar como leída"
                            aria-label="Marcar como leída"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-blue-700 hover:bg-zinc-100 cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void deleteNotificationById(notif.id)}
                          title="Eliminar notificación"
                          aria-label="Eliminar notificación"
                          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-zinc-100 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
