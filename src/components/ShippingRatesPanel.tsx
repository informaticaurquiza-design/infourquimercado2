import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit3,
  MapPin,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_COST,
  formatCurrency,
} from '../lib/validation';
import {
  createOrUpdateShippingRate,
  deleteShippingRateById,
  saveShippingSettings,
} from '../services/dataService';
import type {
  AppUser,
  ShippingRate,
  StoreSettings,
  UserProfile,
} from '../types/ecommerce';

interface ShippingRatesPanelProps {
  user: AppUser;
  profile: UserProfile | null;
  isAdmin: boolean;
  shippingRates: ShippingRate[];
  shippingSettings: StoreSettings;
  onNotifyToast: (msg: string) => void;
}

const RATE_PRESETS = [
  {
    label: 'Envío local',
    name: 'Envío local',
    zone: 'Zona local',
    cost: '4500',
    freeOverAmount: '80000',
    estimatedDays: '24 a 48 hs',
    description: 'Entrega en domicilio por mensajería propia.',
  },
];

export function ShippingRatesPanel({
  user,
  profile,
  isAdmin,
  shippingRates,
  shippingSettings,
  onNotifyToast,
}: ShippingRatesPanelProps) {
  // Custom shipping rate form state
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [zoneInput, setZoneInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [freeOverInput, setFreeOverInput] = useState('0');
  const [estimatedDaysInput, setEstimatedDaysInput] = useState('24 a 48 hs');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [activeInput, setActiveInput] = useState(true);
  const [savingRate, setSavingRate] = useState(false);
  const [rateError, setRateError] = useState('');
  const [busyRateId, setBusyRateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Admin global default shipping settings state
  const [freeThresholdInput, setFreeThresholdInput] = useState(
    String(shippingSettings.freeShippingThreshold),
  );
  const [shippingCostInput, setShippingCostInput] = useState(
    String(shippingSettings.standardShippingCost),
  );
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalError, setGlobalError] = useState('');

  useEffect(() => {
    setFreeThresholdInput(String(shippingSettings.freeShippingThreshold));
    setShippingCostInput(String(shippingSettings.standardShippingCost));
  }, [shippingSettings.freeShippingThreshold, shippingSettings.standardShippingCost]);

  const myRates = useMemo(
    () =>
      shippingRates
        .filter((r) => r.ownerId === user.uid)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.cost - b.cost),
    [shippingRates, user.uid],
  );

  const otherSellerRates = useMemo(
    () =>
      isAdmin
        ? shippingRates
            .filter((r) => r.ownerId !== user.uid)
            .sort((a, b) => a.ownerName.localeCompare(b.ownerName, 'es') || a.cost - b.cost)
        : [],
    [isAdmin, shippingRates, user.uid],
  );

  function resetRateForm() {
    setEditingRateId(null);
    setNameInput('');
    setZoneInput('');
    setCostInput('');
    setFreeOverInput('0');
    setEstimatedDaysInput('24 a 48 hs');
    setDescriptionInput('');
    setActiveInput(true);
    setRateError('');
  }

  function applyPreset(preset: (typeof RATE_PRESETS)[number]) {
    setEditingRateId(null);
    setNameInput(preset.name);
    setZoneInput(preset.zone);
    setCostInput(preset.cost);
    setFreeOverInput(preset.freeOverAmount);
    setEstimatedDaysInput(preset.estimatedDays);
    setDescriptionInput(preset.description);
    setActiveInput(true);
    setRateError('');
  }

  function startEditRate(rate: ShippingRate) {
    setEditingRateId(rate.id);
    setNameInput(rate.name);
    setZoneInput(rate.zone);
    setCostInput(String(rate.cost));
    setFreeOverInput(String(rate.freeOverAmount || 0));
    setEstimatedDaysInput(rate.estimatedDays);
    setDescriptionInput(rate.description || '');
    setActiveInput(rate.active);
    setRateError('');
    setConfirmDeleteId(null);
  }

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    setRateError('');

    const parsedCost = Number(costInput);
    const parsedFreeOver = freeOverInput.trim() === '' ? 0 : Number(freeOverInput);

    if (costInput.trim() === '' || !Number.isFinite(parsedCost) || parsedCost < 0) {
      setRateError('Ingresá un costo de envío válido (mayor o igual a 0).');
      return;
    }
    if (!Number.isFinite(parsedFreeOver) || parsedFreeOver < 0) {
      setRateError('El monto mínimo para envío gratis debe ser mayor o igual a 0.');
      return;
    }

    const ownerName =
      profile?.businessName?.trim() ||
      profile?.displayName?.trim() ||
      user.displayName?.trim() ||
      user.email?.trim() ||
      'Vendedor';

    setSavingRate(true);
    try {
      await createOrUpdateShippingRate({
        id: editingRateId || undefined,
        ownerName,
        name: nameInput,
        zone: zoneInput,
        cost: parsedCost,
        freeOverAmount: parsedFreeOver,
        estimatedDays: estimatedDaysInput,
        description: descriptionInput,
        active: activeInput,
      });
      onNotifyToast(
        editingRateId
          ? 'Tarifa de envío actualizada en tiempo real.'
          : 'Nueva tarifa de envío creada y disponible para tus compradores.',
      );
      resetRateForm();
    } catch (err) {
      setRateError(
        err instanceof Error ? err.message : 'No pudimos guardar la tarifa de envío.',
      );
    } finally {
      setSavingRate(false);
    }
  }

  async function handleToggleRateActive(rate: ShippingRate) {
    setBusyRateId(rate.id);
    try {
      await createOrUpdateShippingRate({
        id: rate.id,
        ownerName: rate.ownerName,
        name: rate.name,
        zone: rate.zone,
        cost: rate.cost,
        freeOverAmount: rate.freeOverAmount,
        estimatedDays: rate.estimatedDays,
        description: rate.description,
        active: !rate.active,
      });
      onNotifyToast(
        !rate.active
          ? `Tarifa "${rate.name}" activada para tus productos.`
          : `Tarifa "${rate.name}" pausada.`,
      );
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos actualizar el estado de la tarifa.',
      );
    } finally {
      setBusyRateId(null);
    }
  }

  async function handleDeleteRate(rate: ShippingRate) {
    setBusyRateId(rate.id);
    try {
      await deleteShippingRateById(rate.id);
      if (editingRateId === rate.id) {
        resetRateForm();
      }
      setConfirmDeleteId(null);
      onNotifyToast(`Tarifa "${rate.name}" eliminada.`);
    } catch (err) {
      onNotifyToast(
        err instanceof Error ? err.message : 'No pudimos eliminar la tarifa de envío.',
      );
    } finally {
      setBusyRateId(null);
    }
  }

  async function handleSaveGlobalShipping(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError('');

    const parsedThreshold = Number(freeThresholdInput);
    const parsedCost = Number(shippingCostInput);

    if (
      freeThresholdInput.trim() === '' ||
      !Number.isFinite(parsedThreshold) ||
      parsedThreshold < 0
    ) {
      setGlobalError(
        'Ingresá un valor numérico válido (mayor o igual a 0) para compras con envío gratis.',
      );
      return;
    }
    if (shippingCostInput.trim() === '' || !Number.isFinite(parsedCost) || parsedCost < 0) {
      setGlobalError('Ingresá un valor numérico válido (mayor o igual a 0) para el costo de envío.');
      return;
    }

    setSavingGlobal(true);
    try {
      await saveShippingSettings(user, {
        freeShippingThreshold: parsedThreshold,
        standardShippingCost: parsedCost,
      });
      onNotifyToast('Tarifa general de respaldo actualizada en tiempo real para toda la tienda.');
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'No pudimos guardar la configuración de envíos.',
      );
    } finally {
      setSavingGlobal(false);
    }
  }

  const previewThreshold = Math.max(0, Number(freeThresholdInput) || 0);
  const previewCost = Math.max(0, Number(shippingCostInput) || 0);
  const sampleBelow =
    previewThreshold > 20000
      ? Math.round(previewThreshold * 0.6)
      : previewThreshold > 0
        ? Math.max(1000, Math.round(previewThreshold / 2))
        : 45000;
  const sampleAbove = Math.max(previewThreshold, 50000);
  const feeBelow = previewThreshold === 0 ? 0 : previewCost;

  return (
    <div className="space-y-8">
      {/* SECTION 1: PER-CLIENT / SELLER CUSTOM SHIPPING RATES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Create / Edit Form */}
        <form
          onSubmit={handleSaveRate}
          className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-zinc-200">
            <div>
              <h2 className="font-display text-base font-bold text-zinc-950">
                {editingRateId ? 'Editar tarifa de envío' : 'Crear tarifa de envío propia'}
              </h2>
              <p className="text-xs text-zinc-600 mt-1">
                Generá tus propias opciones de envío por zona, costo y tiempo de entrega. Se
                mostrarán automáticamente en el carrito y pasarela de pagos cuando compren tus
                productos.
              </p>
            </div>
            {editingRateId && (
              <button
                type="button"
                onClick={resetRateForm}
                aria-label="Cancelar edición"
                className="p-1.5 text-zinc-400 hover:text-zinc-900 rounded-lg hover:bg-zinc-100 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {!editingRateId && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-zinc-500">Plantilla rápida:</p>
              <div className="flex flex-wrap gap-1.5">
                {RATE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="px-2.5 py-1 text-[11px] font-medium text-zinc-700 bg-zinc-50 border border-zinc-200 hover:border-blue-600 hover:text-blue-700 rounded-md transition-colors cursor-pointer"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rateError && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {rateError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-800 mb-1">
              Nombre de la tarifa *
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Ej. Envío local CABA / Moto en el día"
              className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-800 mb-1">
                Zona / Cobertura *
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={zoneInput}
                onChange={(e) => setZoneInput(e.target.value)}
                placeholder="Ej. CABA / GBA / Interior"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-800 mb-1">
                Plazo estimado *
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={40}
                value={estimatedDaysInput}
                onChange={(e) => setEstimatedDaysInput(e.target.value)}
                placeholder="Ej. 24 a 48 hs"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-800 mb-1">
                Costo de envío (ARS) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-zinc-400">
                  $
                </span>
                <input
                  type="number"
                  required
                  min={0}
                  max={10000000}
                  step={100}
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  placeholder="4500"
                  className="w-full pl-7 pr-3 py-2 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Ingresá 0 para envío gratis.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-800 mb-1">
                Gratis desde (ARS, opcional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-zinc-400">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  max={100000000}
                  step={500}
                  value={freeOverInput}
                  onChange={(e) => setFreeOverInput(e.target.value)}
                  placeholder="0"
                  className="w-full pl-7 pr-3 py-2 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">0 = sin mínimo automático.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-800 mb-1">
              Descripción o aclaraciones (opcional)
            </label>
            <textarea
              rows={2}
              maxLength={200}
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              placeholder="Ej. Entregas de lunes a viernes de 9 a 18 hs."
              className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-zinc-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeInput}
              onChange={(e) => setActiveInput(e.target.checked)}
              className="rounded border-zinc-300 text-blue-700 focus:ring-blue-700"
            />
            Tarifa activa (visible para los compradores en checkout)
          </label>

          <div className="flex items-center gap-2 pt-2 border-t border-zinc-100">
            {editingRateId && (
              <button
                type="button"
                onClick={resetRateForm}
                className="px-3.5 py-2.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={savingRate}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {editingRateId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {savingRate
                ? 'Guardando...'
                : editingRateId
                  ? 'Guardar cambios'
                  : 'Crear tarifa de envío'}
            </button>
          </div>
        </form>

        {/* List of User's Own Shipping Rates */}
        <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-zinc-950">
                Mis tarifas de envío ({myRates.length})
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {myRates.length > 0
                  ? 'Tus compradores podrán elegir entre tus tarifas activas al comprar tus productos.'
                  : 'Mientras no crees tarifas propias, tus productos usarán la tarifa general de la tienda.'}
              </p>
            </div>
            <div className="text-xs font-mono text-zinc-500">
              {myRates.filter((r) => r.active).length} activas
            </div>
          </div>

          {myRates.length === 0 ? (
            <div className="p-10 text-center space-y-2.5">
              <Truck className="w-9 h-9 text-zinc-300 mx-auto stroke-[1.5]" />
              <p className="text-sm font-semibold text-zinc-900">
                Todavía no generaste tarifas de envío propias
              </p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                Usá el formulario o la plantilla rápida de envío local para definir tus zonas de
                entrega, costos y montos de envío bonificado. Actualmente se aplica la tarifa
                general de la tienda (
                {shippingSettings.freeShippingThreshold === 0
                  ? 'Envío gratis'
                  : `${formatCurrency(shippingSettings.standardShippingCost)} · Gratis desde ${formatCurrency(shippingSettings.freeShippingThreshold)}`}
                ).
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {myRates.map((rate) => {
                const isBusy = busyRateId === rate.id;
                const isConfirmingDelete = confirmDeleteId === rate.id;
                return (
                  <li
                    key={rate.id}
                    className={`p-5 transition-colors ${
                      rate.active ? 'bg-white' : 'bg-zinc-50/70'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              rate.active ? 'bg-emerald-600' : 'bg-zinc-400'
                            }`}
                          />
                          <h4 className="text-sm font-bold text-zinc-950">{rate.name}</h4>
                          <span
                            className={`text-[11px] font-semibold ${
                              rate.active ? 'text-emerald-700' : 'text-zinc-500'
                            }`}
                          >
                            {rate.active ? 'Activa' : 'Pausada'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                            {rate.zone}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                            {rate.estimatedDays}
                          </span>
                        </div>

                        {rate.description && (
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            {rate.description}
                          </p>
                        )}

                        {rate.freeOverAmount > 0 && rate.cost > 0 && (
                          <p className="text-[11px] text-emerald-700 font-medium inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Envío sin cargo en compras desde {formatCurrency(rate.freeOverAmount)}
                          </p>
                        )}
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                        <span
                          className={`font-mono text-base font-bold tabular-nums ${
                            rate.cost === 0 ? 'text-emerald-700' : 'text-zinc-950'
                          }`}
                        >
                          {rate.cost === 0 ? 'Sin cargo' : formatCurrency(rate.cost)}
                        </span>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDeleteRate(rate)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 text-[11px] font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-md cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleRateActive(rate)}
                              title={rate.active ? 'Pausar tarifa' : 'Activar tarifa'}
                              className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                            >
                              {rate.active ? (
                                <PauseCircle className="w-4 h-4" />
                              ) : (
                                <PlayCircle className="w-4 h-4 text-emerald-600" />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => startEditRate(rate)}
                              title="Editar tarifa"
                              className="p-1.5 text-zinc-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteId(rate.id)}
                              title="Eliminar tarifa"
                              className="p-1.5 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
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

      {/* ADMIN SECTION: OTHER SELLERS' RATES OVERVIEW */}
      {isAdmin && otherSellerRates.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200">
            <h3 className="font-display text-sm font-bold text-zinc-950">
              Tarifas creadas por otros vendedores ({otherSellerRates.length})
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Vista de administración de las tarifas personalizadas cargadas por cada cliente.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Vendedor</th>
                  <th className="py-2.5 px-4 font-medium">Tarifa / Zona</th>
                  <th className="py-2.5 px-4 font-medium">Plazo</th>
                  <th className="py-2.5 px-4 font-medium">Costo</th>
                  <th className="py-2.5 px-4 font-medium">Gratis desde</th>
                  <th className="py-2.5 px-4 font-medium">Estado</th>
                  <th className="py-2.5 px-4 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {otherSellerRates.map((rate) => (
                  <tr key={rate.id} className="hover:bg-zinc-50/70">
                    <td className="py-3 px-4 font-medium text-zinc-900">{rate.ownerName}</td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-zinc-950">{rate.name}</p>
                      <p className="text-[11px] text-zinc-500">{rate.zone}</p>
                    </td>
                    <td className="py-3 px-4 text-zinc-600">{rate.estimatedDays}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-zinc-950 tabular-nums">
                      {rate.cost === 0 ? 'Sin cargo' : formatCurrency(rate.cost)}
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-600 tabular-nums">
                      {rate.freeOverAmount > 0 ? formatCurrency(rate.freeOverAmount) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          rate.active ? 'text-emerald-700' : 'text-zinc-400'
                        }`}
                      >
                        {rate.active ? 'Activa' : 'Pausada'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busyRateId === rate.id}
                          onClick={() => void handleToggleRateActive(rate)}
                          className="px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 rounded cursor-pointer"
                        >
                          {rate.active ? 'Pausar' : 'Activar'}
                        </button>
                        <button
                          type="button"
                          disabled={busyRateId === rate.id}
                          onClick={() => void handleDeleteRate(rate)}
                          className="px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADMIN SECTION 2: GLOBAL STOREFRONT FALLBACK SHIPPING POLICY */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pt-4 border-t border-zinc-200">
          <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 sm:p-8">
            <div className="pb-5 mb-6 border-b border-zinc-200">
              <h2 className="font-display text-lg font-bold text-zinc-950">
                Tarifa general de respaldo de la tienda (Solo administrador)
              </h2>
              <p className="text-sm text-zinc-600 mt-1">
                Se aplica automáticamente cuando un vendedor todavía no generó tarifas propias.
                Definí el monto para envío gratis y el valor estándar para compras inferiores.
              </p>
            </div>

            {globalError && (
              <div className="mb-5 p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {globalError}
              </div>
            )}

            <form onSubmit={handleSaveGlobalShipping} className="space-y-5">
              <div>
                <label
                  htmlFor="free-shipping-threshold"
                  className="block text-xs font-semibold text-zinc-800 mb-1.5"
                >
                  Compras mayores o iguales a — Envío gratis (ARS)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-400">
                    $
                  </span>
                  <input
                    id="free-shipping-threshold"
                    type="number"
                    min={0}
                    max={100000000}
                    step={500}
                    required
                    value={freeThresholdInput}
                    onChange={(e) => setFreeThresholdInput(e.target.value)}
                    className="w-full pl-8 pr-4 py-2.5 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Las compras que alcancen o superen este monto tendrán envío sin cargo. Ingresá{' '}
                  <span className="font-mono text-zinc-700">0</span> para bonificar todos los envíos
                  sin mínimo.
                </p>
              </div>

              <div>
                <label
                  htmlFor="standard-shipping-cost"
                  className="block text-xs font-semibold text-zinc-800 mb-1.5"
                >
                  Valor del costo de envío estándar (ARS)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-400">
                    $
                  </span>
                  <input
                    id="standard-shipping-cost"
                    type="number"
                    min={0}
                    max={10000000}
                    step={100}
                    required
                    value={shippingCostInput}
                    onChange={(e) => setShippingCostInput(e.target.value)}
                    className="w-full pl-8 pr-4 py-2.5 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Importe que se sumará automáticamente cuando el vendedor no tenga tarifas propias
                  y el pedido sea menor al monto de envío gratis.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => {
                    setFreeThresholdInput(String(FREE_SHIPPING_THRESHOLD));
                    setShippingCostInput(String(STANDARD_SHIPPING_COST));
                    setGlobalError('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restablecer sugeridos
                </button>

                <button
                  type="submit"
                  disabled={savingGlobal}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {savingGlobal ? 'Guardando...' : 'Guardar tarifa general'}
                </button>
              </div>
            </form>
          </div>

          {/* Live Calculation Preview */}
          <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="font-display text-sm font-bold text-zinc-950">
                Simulación de tarifa general
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Vista previa para pedidos que usen la tarifa de respaldo de la tienda.
              </p>
            </div>

            <div className="space-y-3 text-xs border-t border-zinc-200 pt-4">
              <p className="font-semibold text-zinc-800">Caso 1 · Compra menor al mínimo</p>
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal carrito</span>
                <span className="font-mono tabular-nums">{formatCurrency(sampleBelow)}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Costo de envío</span>
                <span className="font-mono tabular-nums font-semibold text-zinc-950">
                  {feeBelow === 0 ? 'Sin cargo' : formatCurrency(feeBelow)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-zinc-950 pt-2 border-t border-zinc-100">
                <span>Total estimado</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(sampleBelow + feeBelow)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs border-t border-zinc-200 pt-4">
              <p className="font-semibold text-zinc-800">Caso 2 · Compra mayor o igual al mínimo</p>
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal carrito</span>
                <span className="font-mono tabular-nums">{formatCurrency(sampleAbove)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Costo de envío</span>
                <span className="font-mono tabular-nums">Sin cargo</span>
              </div>
              <div className="flex justify-between font-bold text-zinc-950 pt-2 border-t border-zinc-100">
                <span>Total estimado</span>
                <span className="font-mono tabular-nums">{formatCurrency(sampleAbove)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
