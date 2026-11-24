import { useEffect, useState } from 'react';
import { Bike, Car, Edit3, Plus, Save, Trash2, Truck, X } from 'lucide-react';
import {
  getVehicleTypeLabel,
  validateDeliveryAgentInput,
} from '../lib/validation';
import {
  createOrUpdateDeliveryAgent,
  deleteDeliveryAgentById,
} from '../services/dataService';
import {
  DELIVERY_VEHICLE_OPTIONS,
  type AppUser,
  type DeliveryAgent,
  type DeliveryVehicleType,
} from '../types/ecommerce';

interface DeliveryAgentsManagerModalProps {
  open: boolean;
  user?: AppUser | null;
  agents: DeliveryAgent[];
  onClose: () => void;
  onNotifyToast: (msg: string) => void;
}

export function VehicleTypeIcon({
  vehicleType,
  className = 'w-4 h-4',
}: {
  vehicleType: DeliveryVehicleType;
  className?: string;
}) {
  if (vehicleType === 'moto') return <Bike className={className} />;
  if (vehicleType === 'auto') return <Car className={className} />;
  return <Truck className={className} />;
}

export function DeliveryAgentsManagerModal({
  open,
  user = null,
  agents,
  onClose,
  onNotifyToast,
}: DeliveryAgentsManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<DeliveryVehicleType>('moto');
  const [licensePlate, setLicensePlate] = useState('');
  const [fullName, setFullName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  function resetForm() {
    setEditingId(null);
    setVehicleType('moto');
    setLicensePlate('');
    setFullName('');
    setActive(true);
    setFormError('');
  }

  function startEdit(agent: DeliveryAgent) {
    setEditingId(agent.id);
    setVehicleType(agent.vehicleType);
    setLicensePlate(agent.licensePlate);
    setFullName(agent.fullName);
    setActive(agent.active);
    setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const normalizedPlate = licensePlate.trim().toUpperCase();
    const trimmedName = fullName.trim();
    const validationErr = validateDeliveryAgentInput({
      vehicleType,
      licensePlate: normalizedPlate,
      fullName: trimmedName,
    });
    if (validationErr) {
      setFormError(validationErr);
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateDeliveryAgent({
        id: editingId || undefined,
        vehicleType,
        licensePlate: normalizedPlate,
        fullName: trimmedName,
        active,
      });
      onNotifyToast(
        editingId
          ? `Medio de envío actualizado (${trimmedName} · ${normalizedPlate}).`
          : `Medio de envío registrado (${trimmedName} · ${normalizedPlate}).`,
      );
      resetForm();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'No pudimos guardar el medio de envío. Intentá nuevamente.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agent: DeliveryAgent) {
    setDeletingId(agent.id);
    setFormError('');
    try {
      await deleteDeliveryAgentById(agent.id);
      if (editingId === agent.id) {
        resetForm();
      }
      onNotifyToast(`Medio de envío ${agent.fullName} (${agent.licensePlate}) eliminado.`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'No pudimos eliminar el medio de envío.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-agents-abm-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
          <div>
            <h2
              id="delivery-agents-abm-title"
              className="font-display text-base font-bold text-zinc-950"
            >
              ABM de Medios de Envío
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Registrá tus motos, autos o utilitarios con patente y conductor
              {user?.displayName || user?.email
                ? ` — cuenta: ${user.displayName?.trim() || user.email}`
                : ''}. Cada cuenta gestiona únicamente sus propios medios de envío.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar gestor de medios de envío"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Form (Alta / Modificación) */}
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-900">
                {editingId ? 'Modificar medio de envío' : 'Nuevo medio de envío'}
              </p>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-950 cursor-pointer"
                >
                  Cancelar edición
                </button>
              )}
            </div>

            {/* Vehicle Type Selector */}
            <div>
              <span className="block text-[11px] font-semibold text-zinc-700 mb-1.5">
                Tipo de vehículo
              </span>
              <div className="grid grid-cols-3 gap-2">
                {DELIVERY_VEHICLE_OPTIONS.map((opt) => {
                  const selected = vehicleType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVehicleType(opt.value)}
                      className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                        selected
                          ? 'bg-zinc-950 text-white border-zinc-950'
                          : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      <VehicleTypeIcon vehicleType={opt.value} className="w-4 h-4 shrink-0" />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label
                  htmlFor="agent-license-plate"
                  className="block text-[11px] font-semibold text-zinc-700 mb-1"
                >
                  Patente
                </label>
                <input
                  id="agent-license-plate"
                  type="text"
                  required
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                  maxLength={16}
                  placeholder="Ej. AB 123 CD"
                  className="w-full px-3 py-2 text-xs font-mono uppercase bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="sm:col-span-8">
                <label
                  htmlFor="agent-full-name"
                  className="block text-[11px] font-semibold text-zinc-700 mb-1"
                >
                  Nombre completo del repartidor
                </label>
                <input
                  id="agent-full-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                  placeholder="Ej. Martín Gómez"
                  className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            {formError && (
              <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {formError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Disponible para asignar en envíos</span>
              </label>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-55 rounded-lg transition-colors cursor-pointer"
              >
                {editingId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>
                  {saving
                    ? 'Guardando...'
                    : editingId
                      ? 'Guardar cambios'
                      : 'Agregar medio de envío'}
                </span>
              </button>
            </div>
          </form>

          {/* Listado ABM */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-900">
                Medios registrados ({agents.length})
              </h3>
            </div>

            {agents.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-zinc-300 text-center">
                <Truck className="w-8 h-8 text-zinc-300 mx-auto mb-2 stroke-[1.5]" />
                <p className="text-xs font-medium text-zinc-700">
                  Todavía no cargaste medios de envío
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Agregá tu primera moto, auto o utilitario arriba para poder seleccionarlo al
                  preparar cada pedido.
                </p>
              </div>
            ) : (
              <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-100 overflow-hidden">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`p-3.5 flex items-center justify-between gap-3 bg-white hover:bg-zinc-50/70 ${
                      editingId === agent.id ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-lg inline-flex items-center justify-center shrink-0 ${
                          agent.active
                            ? 'bg-zinc-950 text-white'
                            : 'bg-zinc-100 text-zinc-400'
                        }`}
                      >
                        <VehicleTypeIcon vehicleType={agent.vehicleType} className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold text-zinc-950 truncate">
                            {agent.fullName}
                          </p>
                          <span className="text-[11px] font-medium text-zinc-600">
                            · {getVehicleTypeLabel(agent.vehicleType)}
                          </span>
                          <span className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-800">
                            {agent.licensePlate}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5">
                          <span
                            className={
                              agent.active
                                ? 'text-emerald-700 font-medium'
                                : 'text-zinc-400 font-medium'
                            }
                          >
                            {agent.active ? 'Disponible' : 'Inactivo'}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(agent)}
                        title={`Editar ${agent.fullName}`}
                        aria-label={`Editar ${agent.fullName}`}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-blue-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === agent.id}
                        onClick={() => void handleDelete(agent)}
                        title={`Eliminar ${agent.fullName}`}
                        aria-label={`Eliminar ${agent.fullName}`}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
