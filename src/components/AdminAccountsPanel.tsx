import { useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Clock,
  FileCheck2,
  Landmark,
  Power,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  formatShortDate,
  getAccountSubscriptionInfo,
} from '../lib/validation';
import {
  adminRejectSubscriptionPayment,
  adminSetAccountStatus,
} from '../services/dataService';
import type {
  AppUser,
  Product,
  SubscriptionPayment,
  UserProfile,
} from '../types/ecommerce';

interface AdminAccountsPanelProps {
  adminUser: AppUser;
  accounts: UserProfile[];
  subscriptionPayments: SubscriptionPayment[];
  products: Product[];
  onNotifyToast: (msg: string) => void;
}

type AccountFilter = 'all' | 'active' | 'inactive' | 'pending_receipt';

export function AdminAccountsPanel({
  adminUser,
  accounts,
  subscriptionPayments,
  products,
  onNotifyToast,
}: AdminAccountsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [inspectingUid, setInspectingUid] = useState<string | null>(null);

  const enrichedAccounts = useMemo(() => {
    return accounts
      .map((account) => {
        const subInfo = getAccountSubscriptionInfo(account);
        const accountPayments = subscriptionPayments.filter((p) => p.userId === account.uid);
        const pendingPayments = accountPayments.filter((p) => p.status === 'pending');
        const accountProducts = products.filter((p) => p.sellerId === account.uid);
        const activeProductsCount = accountProducts.filter((p) => p.active).length;
        return {
          account,
          subInfo,
          accountPayments,
          pendingPayments,
          accountProductsCount: accountProducts.length,
          activeProductsCount,
        };
      })
      .sort((a, b) => {
        // Pending receipts first, then inactive accounts, then newest joined
        if (b.pendingPayments.length !== a.pendingPayments.length) {
          return b.pendingPayments.length - a.pendingPayments.length;
        }
        if (a.subInfo.isActive !== b.subInfo.isActive) {
          return a.subInfo.isActive ? 1 : -1;
        }
        return b.subInfo.joinedAtIso.localeCompare(a.subInfo.joinedAtIso);
      });
  }, [accounts, subscriptionPayments, products]);

  const stats = useMemo(() => {
    const total = enrichedAccounts.length;
    const activeCount = enrichedAccounts.filter((e) => e.subInfo.isActive).length;
    const inactiveCount = total - activeCount;
    const pendingReceiptsCount = subscriptionPayments.filter((p) => p.status === 'pending').length;
    return { total, activeCount, inactiveCount, pendingReceiptsCount };
  }, [enrichedAccounts, subscriptionPayments]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedAccounts.filter((entry) => {
      if (filter === 'active' && !entry.subInfo.isActive) return false;
      if (filter === 'inactive' && entry.subInfo.isActive) return false;
      if (filter === 'pending_receipt' && entry.pendingPayments.length === 0) return false;
      if (q) {
        const acc = entry.account;
        return (
          (acc.displayName || '').toLowerCase().includes(q) ||
          (acc.businessName || '').toLowerCase().includes(q) ||
          (acc.email || '').toLowerCase().includes(q) ||
          (acc.bankAlias || '').toLowerCase().includes(q) ||
          (acc.bankCbuCvu || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedAccounts, filter, searchQuery]);

  const inspectingEntry = useMemo(
    () => (inspectingUid ? enrichedAccounts.find((e) => e.account.uid === inspectingUid) || null : null),
    [enrichedAccounts, inspectingUid],
  );

  async function handleAccountStatusChange(
    targetUser: UserProfile,
    action: 'activate' | 'deactivate',
    paymentId?: string,
  ) {
    setBusyUid(targetUser.uid);
    try {
      await adminSetAccountStatus({
        targetUser,
        action,
        adminUser,
        paymentId,
        allPayments: subscriptionPayments,
        allProducts: products,
      });
      onNotifyToast(
        action === 'activate'
          ? `Cuenta de ${targetUser.displayName || targetUser.email} activada por 30 días y publicaciones habilitadas.`
          : `Cuenta de ${targetUser.displayName || targetUser.email} desactivada y publicaciones pausadas.`,
      );
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos actualizar el estado de la cuenta.',
      );
    } finally {
      setBusyUid(null);
    }
  }

  async function handleRejectPayment(payment: SubscriptionPayment) {
    setBusyPaymentId(payment.id);
    try {
      await adminRejectSubscriptionPayment(payment, adminUser);
      onNotifyToast('Comprobante marcado como rechazado y notificación enviada al cliente.');
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos rechazar el comprobante.',
      );
    } finally {
      setBusyPaymentId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <p className="text-xs text-zinc-500">Total de cuentas</p>
          <p className="font-mono text-2xl font-bold text-zinc-950 mt-1.5 tabular-nums">
            {stats.total}
          </p>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5">
          <p className="text-xs font-medium text-emerald-800">Clientes activos</p>
          <p className="font-mono text-2xl font-bold text-emerald-700 mt-1.5 tabular-nums">
            {stats.activeCount}
          </p>
        </div>

        <div className="bg-red-50/70 border border-red-200 rounded-xl p-5">
          <p className="text-xs font-medium text-red-800">Clientes inactivos</p>
          <p className="font-mono text-2xl font-bold text-red-600 mt-1.5 tabular-nums">
            {stats.inactiveCount}
          </p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <p className="text-xs text-zinc-500">Comprobantes por revisar</p>
          <p
            className={`font-mono text-2xl font-bold mt-1.5 tabular-nums ${
              stats.pendingReceiptsCount > 0 ? 'text-amber-700' : 'text-zinc-950'
            }`}
          >
            {stats.pendingReceiptsCount}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar cliente por nombre, comercio, correo o alias..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', label: `Todas (${stats.total})` },
              { id: 'active', label: `Activas (${stats.activeCount})` },
              { id: 'inactive', label: `Inactivas (${stats.inactiveCount})` },
              { id: 'pending_receipt', label: `Con comprobante (${stats.pendingReceiptsCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`px-3 py-2 rounded-lg border font-medium transition-colors cursor-pointer ${
                filter === item.id
                  ? item.id === 'active'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : item.id === 'inactive'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-zinc-950 text-white border-zinc-950'
                  : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-950'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold text-zinc-950">
              Listado de cuentas de clientes y vendedores
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              En <span className="font-semibold text-emerald-700">verde</span> se muestran los
              clientes activos y en <span className="font-semibold text-red-600">rojo</span> los
              inactivos o con período de 30 días vencido.
            </p>
          </div>
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">
            No se encontraron cuentas con el filtro seleccionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Cliente / Cuenta</th>
                  <th className="py-3 px-4">Fecha de ingreso</th>
                  <th className="py-3 px-4">Estado y vigencia</th>
                  <th className="py-3 px-4 text-center">Publicaciones</th>
                  <th className="py-3 px-4">Comprobantes</th>
                  <th className="py-3 px-4 text-right">Activación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-xs">
                {filteredAccounts.map((entry) => {
                  const {
                    account,
                    subInfo,
                    accountPayments,
                    pendingPayments,
                    accountProductsCount,
                    activeProductsCount,
                  } = entry;
                  const isBusy = busyUid === account.uid;
                  const isAccountAdmin = account.role === 'admin';

                  return (
                    <tr
                      key={account.uid}
                      className={
                        subInfo.isActive
                          ? 'bg-emerald-50/40 hover:bg-emerald-50/75 border-l-4 border-l-emerald-600'
                          : 'bg-red-50/50 hover:bg-red-50/85 border-l-4 border-l-red-600'
                      }
                    >
                      <td className="py-3.5 px-4 max-w-[260px]">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                subInfo.isActive ? 'bg-emerald-600' : 'bg-red-600'
                              }`}
                            />
                            <p
                              className={`font-semibold truncate ${
                                subInfo.isActive ? 'text-emerald-950' : 'text-red-950'
                              }`}
                            >
                              {account.displayName || 'Sin nombre'}
                            </p>
                            {isAccountAdmin && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700">
                                <ShieldCheck className="w-3 h-3" />
                                Admin
                              </span>
                            )}
                          </div>
                          {account.businessName && (
                            <p className="text-[11px] font-medium text-zinc-700 truncate pl-4">
                              {account.businessName}
                            </p>
                          )}
                          <p className="text-[11px] text-zinc-500 truncate pl-4">{account.email}</p>
                          {(account.bankAlias || account.bankCbuCvu) && (
                            <p className="text-[10px] font-mono text-zinc-500 truncate pl-4">
                              Banco: {account.bankAlias || account.bankCbuCvu}
                            </p>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-zinc-700 whitespace-nowrap tabular-nums">
                        {formatShortDate(subInfo.joinedAtIso)}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <p
                            className={`font-bold ${
                              subInfo.isActive ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {subInfo.isActive ? 'ACTIVO' : 'INACTIVO'} · {subInfo.statusLabel}
                          </p>
                          <p className="text-[11px] text-zinc-600 max-w-[240px]">
                            {subInfo.detailText}
                          </p>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center font-mono tabular-nums whitespace-nowrap">
                        <span className="font-semibold text-zinc-900">{activeProductsCount}</span>
                        <span className="text-zinc-500"> / {accountProductsCount}</span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectingUid(account.uid)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                            pendingPayments.length > 0
                              ? 'bg-amber-50 border-amber-400 text-amber-900 hover:bg-amber-100'
                              : accountPayments.length > 0
                                ? 'bg-white border-zinc-300 text-zinc-800 hover:border-zinc-950'
                                : 'bg-white/70 border-zinc-200 text-zinc-500 hover:text-zinc-800'
                          }`}
                        >
                          <FileCheck2 className="w-3.5 h-3.5" />
                          <span>
                            {pendingPayments.length > 0
                              ? `Ver comprobantes (${pendingPayments.length} pend.)`
                              : `Comprobantes (${accountPayments.length})`}
                          </span>
                        </button>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {isAccountAdmin ? (
                          <span className="text-[11px] text-zinc-500">Cuenta administradora</span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleAccountStatusChange(account, 'activate')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              {isBusy
                                ? 'Aplicando...'
                                : subInfo.isActive
                                  ? '+30 días'
                                  : 'Activar'}
                            </button>

                            {subInfo.isActive && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleAccountStatusChange(account, 'deactivate')}
                                title="Desactivar cuenta y pausar publicaciones"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-300 hover:bg-red-50 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                Desactivar
                              </button>
                            )}

                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Account Activation Receipts & Details */}
      {inspectingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/60 backdrop-blur-[1px]"
            onClick={() => setInspectingUid(null)}
          />
          <div className="relative z-10 w-full max-w-4xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-zinc-200">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      inspectingEntry.subInfo.isActive ? 'bg-emerald-600' : 'bg-red-600'
                    }`}
                  />
                  <h3 className="font-display text-base font-bold text-zinc-950">
                    Comprobantes de activación —{' '}
                    {inspectingEntry.account.displayName || inspectingEntry.account.email}
                  </h3>
                </div>
                <p className="text-xs text-zinc-600">
                  {inspectingEntry.account.email} · Ingreso:{' '}
                  <span className="font-mono">
                    {formatShortDate(inspectingEntry.subInfo.joinedAtIso)}
                  </span>{' '}
                  ·{' '}
                  <strong
                    className={
                      inspectingEntry.subInfo.isActive ? 'text-emerald-700' : 'text-red-600'
                    }
                  >
                    {inspectingEntry.subInfo.isActive ? 'ACTIVO' : 'INACTIVO'} (
                    {inspectingEntry.subInfo.statusLabel})
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingUid(null)}
                aria-label="Cerrar detalle de cuenta"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* Quick Action Bar */}
              {inspectingEntry.account.role !== 'admin' && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
                  <div className="text-xs text-zinc-700 space-y-0.5">
                    <p className="font-semibold text-zinc-950">Acción rápida sobre la cuenta</p>
                    <p>{inspectingEntry.subInfo.detailText}</p>
                    {(inspectingEntry.account.bankCbuCvu || inspectingEntry.account.bankAlias) && (
                      <p className="text-[11px] text-zinc-500 font-mono">
                        Datos bancarios: {inspectingEntry.account.bankAccountHolder || '—'} ·{' '}
                        {inspectingEntry.account.bankAlias || '—'} ·{' '}
                        {inspectingEntry.account.bankCbuCvu || '—'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyUid === inspectingEntry.account.uid}
                      onClick={() =>
                        void handleAccountStatusChange(inspectingEntry.account, 'activate')
                      }
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                    >
                      <Power className="w-3.5 h-3.5" />
                      Activar cuenta (+30 días)
                    </button>
                    {inspectingEntry.subInfo.isActive && (
                      <button
                        type="button"
                        disabled={busyUid === inspectingEntry.account.uid}
                        onClick={() =>
                          void handleAccountStatusChange(inspectingEntry.account, 'deactivate')
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-300 hover:bg-red-50 disabled:opacity-60 rounded-lg cursor-pointer"
                      >
                        Desactivar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Payment Records */}
              {inspectingEntry.accountPayments.length === 0 ? (
                <div className="p-10 text-center border border-dashed border-zinc-200 rounded-xl text-xs text-zinc-500">
                  Este cliente todavía no cargó comprobantes ni avisos de pago mensual.
                </div>
              ) : (
                <div className="space-y-4">
                  {inspectingEntry.accountPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="border border-zinc-200 rounded-xl overflow-hidden bg-white"
                    >
                      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 text-xs">
                          {payment.paymentMethod === 'transfer' ? (
                            <Landmark className="w-4 h-4 text-blue-700" />
                          ) : (
                            <Banknote className="w-4 h-4 text-emerald-700" />
                          )}
                          <span className="font-semibold text-zinc-950">
                            {payment.paymentMethod === 'transfer'
                              ? 'Transferencia bancaria'
                              : 'Pago en efectivo'}{' '}
                            · <span className="font-mono">{formatCurrency(payment.amount)}</span>
                          </span>
                          <span className="text-zinc-500 font-mono text-[11px]">
                            {formatDateTime(payment.createdAt)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
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
                                Pendiente de revisión
                              </>
                            )}
                          </span>

                          {payment.status === 'pending' && inspectingEntry.account.role !== 'admin' && (
                            <>
                              <button
                                type="button"
                                disabled={busyUid === inspectingEntry.account.uid}
                                onClick={() =>
                                  void handleAccountStatusChange(
                                    inspectingEntry.account,
                                    'activate',
                                    payment.id,
                                  )
                                }
                                className="px-3 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                              >
                                Aprobar y activar (+30 días)
                              </button>
                              <button
                                type="button"
                                disabled={busyPaymentId === payment.id}
                                onClick={() => void handleRejectPayment(payment)}
                                className="px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-white border border-red-300 hover:bg-red-50 disabled:opacity-60 rounded-lg cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="p-4">
                        {payment.note && (
                          <p className="text-xs text-zinc-700 mb-3 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
                            <span className="font-semibold text-zinc-900">Nota del cliente: </span>
                            {payment.note}
                          </p>
                        )}

                        {payment.paymentReceipt ? (
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                            <div className="md:col-span-5 bg-zinc-50 border border-zinc-200 rounded-lg p-3 flex items-center justify-center">
                              <img
                                src={payment.paymentReceipt.imageUrl}
                                alt="Comprobante de activación"
                                className="max-h-72 w-auto object-contain rounded"
                              />
                            </div>
                            <div className="md:col-span-7 text-xs space-y-2">
                              <p className="font-semibold text-emerald-700 flex items-center gap-1.5">
                                <FileCheck2 className="w-4 h-4" />
                                Datos leídos del comprobante
                              </p>
                              <dl className="divide-y divide-zinc-100">
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">Banco / Billetera</dt>
                                  <dd className="font-medium text-zinc-950 text-right">
                                    {payment.paymentReceipt.bankName || 'No detectado'}
                                  </dd>
                                </div>
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">N° de operación</dt>
                                  <dd className="font-mono font-medium text-zinc-950 text-right">
                                    {payment.paymentReceipt.operationNumber || 'No detectado'}
                                  </dd>
                                </div>
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">Monto detectado</dt>
                                  <dd className="font-mono font-semibold text-zinc-950 text-right">
                                    {payment.paymentReceipt.amountDetected || 'No detectado'}
                                  </dd>
                                </div>
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">Pagador</dt>
                                  <dd className="font-medium text-zinc-950 text-right">
                                    {payment.paymentReceipt.payerName || 'No detectado'}
                                  </dd>
                                </div>
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">Fecha</dt>
                                  <dd className="font-medium text-zinc-950 text-right">
                                    {payment.paymentReceipt.transferDate || 'No detectada'}
                                  </dd>
                                </div>
                                <div className="py-1.5 flex justify-between gap-2">
                                  <dt className="text-zinc-500">Cuenta destino</dt>
                                  <dd className="font-medium text-zinc-950 text-right">
                                    {payment.paymentReceipt.destinationAccount || 'No detectada'}
                                  </dd>
                                </div>
                              </dl>
                              {payment.paymentReceipt.summary && (
                                <p className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-700">
                                  {payment.paymentReceipt.summary}
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-600">
                            Pago registrado en modalidad efectivo (sin archivo de transferencia).
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
