import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit3,
  Eye,
  EyeOff,
  FolderTree,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { slugifyCategoryId, validateCategoryInput } from '../lib/validation';
import { createOrUpdateCategory, deleteCategoryById } from '../services/dataService';
import type { CategoryDefinition, Product } from '../types/ecommerce';

interface AdminCategoriesPanelProps {
  isAdmin: boolean;
  categories: CategoryDefinition[];
  products: Product[];
  onNotifyToast: (msg: string) => void;
  onRefreshLocalData?: () => Promise<void>;
}

export function AdminCategoriesPanel({
  isAdmin,
  categories,
  products,
  onNotifyToast,
  onRefreshLocalData,
}: AdminCategoriesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState('');
  const [formShortLabel, setFormShortLabel] = useState('');
  const [formId, setFormId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [shortManuallyEdited, setShortManuallyEdited] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formSortOrder, setFormSortOrder] = useState('0');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const productCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of products) {
      counts[product.category] = (counts[product.category] || 0) + 1;
    }
    return counts;
  }, [products]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label, 'es');
    });
  }, [categories]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCategories;
    return sortedCategories.filter(
      (cat) =>
        cat.label.toLowerCase().includes(q) ||
        cat.shortLabel.toLowerCase().includes(q) ||
        cat.id.toLowerCase().includes(q) ||
        cat.description.toLowerCase().includes(q),
    );
  }, [sortedCategories, searchQuery]);

  if (!isAdmin) {
    return null;
  }

  const activeCount = categories.filter((c) => c.active !== false).length;
  const inactiveCount = categories.length - activeCount;

  function openCreateModal() {
    const nextOrder =
      categories.reduce((max, c) => Math.max(max, Number.isFinite(c.sortOrder) ? Number(c.sortOrder) : 0), -1) + 1;
    setEditingId(null);
    setFormLabel('');
    setFormShortLabel('');
    setFormId('');
    setIdManuallyEdited(false);
    setShortManuallyEdited(false);
    setFormDescription('');
    setFormSortOrder(String(Math.min(1000, Math.max(0, nextOrder))));
    setFormActive(true);
    setFormError('');
    setModalOpen(true);
  }

  function openEditModal(category: CategoryDefinition) {
    setEditingId(category.id);
    setFormLabel(category.label);
    setFormShortLabel(category.shortLabel);
    setFormId(category.id);
    setIdManuallyEdited(true);
    setShortManuallyEdited(true);
    setFormDescription(category.description);
    setFormSortOrder(String(category.sortOrder ?? 0));
    setFormActive(category.active !== false);
    setFormError('');
    setModalOpen(true);
  }

  function handleLabelChange(value: string) {
    setFormLabel(value);
    if (!editingId && !idManuallyEdited) {
      setFormId(slugifyCategoryId(value));
    }
    if (!editingId && !shortManuallyEdited) {
      const compact = value.trim().slice(0, 28);
      setFormShortLabel(compact);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const parsedOrder = Number.parseInt(formSortOrder, 10);
    const sortOrderValue = Number.isFinite(parsedOrder) ? parsedOrder : 0;
    const candidateId = editingId || slugifyCategoryId(formId || formLabel);

    const validationError = validateCategoryInput({
      id: candidateId,
      label: formLabel,
      shortLabel: formShortLabel.trim() || formLabel.trim().slice(0, 28),
      description: formDescription,
      sortOrder: sortOrderValue,
    });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!editingId && categories.some((c) => c.id === candidateId)) {
      setFormError(`Ya existe un rubro con el identificador "${candidateId}". Elegí otro.`);
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateCategory({
        id: candidateId,
        isEditing: Boolean(editingId),
        label: formLabel.trim(),
        shortLabel: (formShortLabel.trim() || formLabel.trim()).slice(0, 28),
        description: formDescription.trim(),
        sortOrder: sortOrderValue,
        active: formActive,
      });
      await onRefreshLocalData?.();
      setModalOpen(false);
      onNotifyToast(
        editingId
          ? `Rubro "${formLabel.trim()}" actualizado.`
          : `Rubro "${formLabel.trim()}" creado en el catálogo.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No pudimos guardar el rubro.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(category: CategoryDefinition) {
    const nextActive = category.active === false;
    if (!nextActive && activeCount <= 1) {
      onNotifyToast('Debe quedar al menos un rubro visible en el catálogo.');
      return;
    }
    setTogglingId(category.id);
    try {
      await createOrUpdateCategory({
        id: category.id,
        isEditing: true,
        label: category.label,
        shortLabel: category.shortLabel,
        description: category.description,
        sortOrder: category.sortOrder ?? 0,
        active: nextActive,
      });
      await onRefreshLocalData?.();
      onNotifyToast(
        nextActive
          ? `Rubro "${category.label}" activado en el catálogo.`
          : `Rubro "${category.label}" ocultado del catálogo.`,
      );
    } catch (err) {
      onNotifyToast(err instanceof Error ? err.message : 'No se pudo cambiar el estado del rubro.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleConfirmDelete(category: CategoryDefinition) {
    const assignedCount = productCountByCategory[category.id] || 0;
    if (assignedCount > 0) {
      onNotifyToast(
        `No podés eliminar "${category.label}" porque tiene ${assignedCount} producto(s) asignado(s).`,
      );
      setConfirmDeleteId(null);
      return;
    }
    if (categories.length <= 1) {
      onNotifyToast('No podés eliminar el último rubro del sistema.');
      setConfirmDeleteId(null);
      return;
    }

    setDeletingId(category.id);
    try {
      await deleteCategoryById(category.id);
      await onRefreshLocalData?.();
      setConfirmDeleteId(null);
      onNotifyToast(`Rubro "${category.label}" eliminado correctamente.`);
    } catch (err) {
      onNotifyToast(err instanceof Error ? err.message : 'No pudimos eliminar el rubro.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Summary */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-lg font-bold text-zinc-950">
              ABM de Rubros del Catálogo
            </h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-zinc-100 text-zinc-700 rounded">
              <ShieldCheck className="w-3 h-3 text-blue-700" />
              Solo administrador
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Creá, editá, ordená, ocultá o eliminá rubros. Los cambios se sincronizan al instante con
            el catálogo, los filtros y el alta de productos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 px-3.5 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs">
            <div>
              <span className="text-zinc-500">Total:</span>{' '}
              <span className="font-mono font-bold text-zinc-950 tabular-nums">
                {categories.length}
              </span>
            </div>
            <span className="text-zinc-300">|</span>
            <div>
              <span className="text-zinc-500">Activos:</span>{' '}
              <span className="font-mono font-bold text-emerald-700 tabular-nums">
                {activeCount}
              </span>
            </div>
            {inactiveCount > 0 && (
              <>
                <span className="text-zinc-300">|</span>
                <div>
                  <span className="text-zinc-500">Ocultos:</span>{' '}
                  <span className="font-mono font-bold text-amber-700 tabular-nums">
                    {inactiveCount}
                  </span>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo rubro</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar rubro por nombre, código o descripción..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
        <p className="text-xs text-zinc-500">
          Mostrando{' '}
          <span className="font-mono font-semibold text-zinc-800 tabular-nums">
            {filteredCategories.length}
          </span>{' '}
          de{' '}
          <span className="font-mono font-semibold text-zinc-800 tabular-nums">
            {categories.length}
          </span>{' '}
          rubros
        </p>
      </div>

      {/* Categories Table */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="py-3 px-4 w-16">Orden</th>
                <th className="py-3 px-4">Rubro</th>
                <th className="py-3 px-4">Código (Slug)</th>
                <th className="py-3 px-4 hidden md:table-cell">Descripción</th>
                <th className="py-3 px-4 text-right">Productos</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-sm">
              {filteredCategories.map((cat) => {
                const isActive = cat.active !== false;
                const productCount = productCountByCategory[cat.id] || 0;
                const canDelete = productCount === 0 && categories.length > 1;
                const isConfirmingDelete = confirmDeleteId === cat.id;

                return (
                  <tr
                    key={cat.id}
                    className={`transition-colors ${
                      isActive ? 'hover:bg-zinc-50/70' : 'bg-zinc-50/60 text-zinc-500'
                    }`}
                  >
                    <td className="py-3.5 px-4 font-mono text-xs text-zinc-600 tabular-nums">
                      #{cat.sortOrder ?? 0}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-zinc-950">{cat.label}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        Etiqueta corta: <span className="text-zinc-700">{cat.shortLabel}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono text-xs px-2 py-1 bg-zinc-100 text-zinc-700 rounded">
                        {cat.id}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 hidden md:table-cell max-w-xs">
                      <p className="text-xs text-zinc-600 line-clamp-2">{cat.description}</p>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs font-semibold tabular-nums text-zinc-800">
                      {productCount}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        disabled={togglingId === cat.id}
                        onClick={() => void handleToggleActive(cat)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer disabled:opacity-50 ${
                          isActive
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                            : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Visible</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Oculto</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={deletingId === cat.id}
                            onClick={() => void handleConfirmDelete(cat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{deletingId === cat.id ? 'Eliminando...' : 'Confirmar'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-md cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(cat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-md transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            disabled={!canDelete}
                            title={
                              productCount > 0
                                ? `Tiene ${productCount} producto(s) asignado(s). Reasignálos antes de eliminar.`
                                : categories.length <= 1
                                  ? 'Debe existir al menos un rubro en el sistema.'
                                  : 'Eliminar rubro'
                            }
                            onClick={() => setConfirmDeleteId(cat.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                              canDelete
                                ? 'text-red-700 bg-white border-red-200 hover:bg-red-50 hover:border-red-400 cursor-pointer'
                                : 'text-zinc-400 bg-zinc-50 border-zinc-200 cursor-not-allowed'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredCategories.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-sm text-zinc-500">
                    No se encontraron rubros con ese criterio de búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Footer */}
      <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl flex items-start gap-3 text-xs text-zinc-600">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p>
          Por integridad del catálogo, no se puede eliminar un rubro mientras tenga productos
          asociados. Si deseás retirarlo sin reasignar productos, podés marcarlo como{' '}
          <span className="font-semibold text-zinc-800">Oculto</span> o editar su nombre (el nuevo
          nombre se actualiza automáticamente en los productos existentes).
        </p>
      </div>

      {/* Modal: Alta / Modificación de Rubro */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[1px]"
            onClick={() => !saving && setModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-blue-700" />
                <h3 className="font-display text-base font-bold text-zinc-950">
                  {editingId ? 'Modificar rubro' : 'Alta de nuevo rubro'}
                </h3>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar modal de rubro"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Nombre del rubro
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={48}
                  value={formLabel}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  placeholder="Ej.: Ferretería & Herramientas"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Nombre corto (gráficos)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={28}
                    value={formShortLabel}
                    onChange={(e) => {
                      setShortManuallyEdited(true);
                      setFormShortLabel(e.target.value);
                    }}
                    placeholder="Ej.: Ferretería"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Orden de aparición
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={formSortOrder}
                    onChange={(e) => setFormSortOrder(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Código identificador (slug)
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingId)}
                  maxLength={40}
                  value={formId}
                  onChange={(e) => {
                    setIdManuallyEdited(true);
                    setFormId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                  }}
                  placeholder="ferreteria_herramientas"
                  className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                    editingId
                      ? 'bg-zinc-100 text-zinc-500 border-zinc-200 cursor-not-allowed'
                      : 'bg-white border-zinc-300 focus:border-blue-700'
                  }`}
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  {editingId
                    ? 'El código no puede modificarse para mantener vinculados los productos existentes.'
                    : 'Solo minúsculas, números, guiones y guion bajo (2 a 40 caracteres).'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Descripción</label>
                <textarea
                  required
                  rows={3}
                  minLength={3}
                  maxLength={200}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Breve descripción que verá el cliente al filtrar por este rubro."
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
                />
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-zinc-200 bg-zinc-50 cursor-pointer">
                <div>
                  <span className="text-xs font-semibold text-zinc-900 block">
                    Visible en el catálogo público
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Si está desactivado, solo el administrador lo verá en este panel.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-4 h-4 accent-blue-700 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear rubro'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
