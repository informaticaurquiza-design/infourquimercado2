import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Download,
  FileJson,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { formatDateTime } from '../lib/validation';
import { triggerJsonDownload } from '../services/dataService';
import {
  exportCloudDatabaseBackup,
  restoreCloudDatabaseBackup,
} from '../services/firestoreService';
import type { AppUser, RestoreMode, RestoreSummary } from '../types/ecommerce';

interface DatabaseBackupPanelProps {
  user: AppUser;
  productsCount: number;
  ordersCount: number;
  onNotifyToast: (msg: string) => void;
}

interface ParsedBackupPreview {
  fileName: string;
  parsedObject: Record<string, unknown>;
  exportedAt: string | null;
  sourceMode: string;
  productsCount: number;
  ordersCount: number;
  notificationsCount: number;
  hasShippingSettings: boolean;
}

function formatSourceLabel(sourceMode: string): string {
  if (sourceMode === 'cloud') return 'Nube (Firebase Firestore)';
  if (sourceMode === 'lan' || sourceMode === 'local') return 'Respaldo previo (.json)';
  return 'Respaldo JSON';
}

export function DatabaseBackupPanel({
  user,
  productsCount,
  ordersCount,
  onNotifyToast,
}: DatabaseBackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cloudAvailable = Boolean(auth.currentUser);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastRestoreResult, setLastRestoreResult] = useState<{
    mode: RestoreMode;
    summary: RestoreSummary;
  } | null>(null);

  const [preview, setPreview] = useState<ParsedBackupPreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('replace');

  async function handleDownloadCloudBackup() {
    setErrorMessage('');
    setBusyAction('backup-cloud-download');
    try {
      const payload = await exportCloudDatabaseBackup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      triggerJsonDownload(
        JSON.stringify(payload, null, 2),
        `infourqui-mercado-backup-firestore-${stamp}.json`,
      );
      onNotifyToast('Copia de seguridad de Firebase Firestore descargada correctamente.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'No pudimos exportar la base de datos en la nube.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSelectBackupFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage('');
    setLastRestoreResult(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('El archivo seleccionado no tiene una estructura JSON válida.');
      }

      const productsCountParsed = Array.isArray(parsed.products) ? parsed.products.length : 0;
      const ordersCountParsed = Array.isArray(parsed.orders) ? parsed.orders.length : 0;
      const notificationsCountParsed = Array.isArray(parsed.notifications)
        ? parsed.notifications.length
        : 0;
      const rawSettings = parsed.shippingSettings as Record<string, unknown> | undefined;
      const hasSettings =
        Boolean(rawSettings) &&
        typeof rawSettings === 'object' &&
        typeof rawSettings.freeShippingThreshold === 'number' &&
        typeof rawSettings.standardShippingCost === 'number';

      if (
        !Array.isArray(parsed.products) &&
        !Array.isArray(parsed.orders) &&
        !Array.isArray(parsed.notifications) &&
        !hasSettings
      ) {
        throw new Error(
          'El archivo JSON no contiene colecciones de Infourqui Mercado (productos, pedidos, alertas o tarifas).',
        );
      }

      setPreview({
        fileName: file.name,
        parsedObject: parsed,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
        sourceMode: typeof parsed.sourceMode === 'string' ? parsed.sourceMode : 'cloud',
        productsCount: productsCountParsed,
        ordersCount: ordersCountParsed,
        notificationsCount: notificationsCountParsed,
        hasShippingSettings: hasSettings,
      });
    } catch (err) {
      setPreview(null);
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos leer el archivo de respaldo.',
      );
    }
  }

  async function handleConfirmFileRestore() {
    if (!preview) return;
    setErrorMessage('');
    setLastRestoreResult(null);
    setBusyAction('restore-file');

    try {
      const summary = await restoreCloudDatabaseBackup(preview.parsedObject, user, restoreMode);
      onNotifyToast('Base de datos en Firebase Firestore restaurada correctamente.');
      setLastRestoreResult({
        mode: restoreMode,
        summary,
      });
      setPreview(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Ocurrió un error al restaurar el respaldo.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="p-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
          {errorMessage}
        </div>
      )}

      {lastRestoreResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-950 space-y-1">
            <p className="font-semibold">
              Restauración completada en Firebase Firestore (
              {lastRestoreResult.mode === 'replace' ? 'Reemplazo total' : 'Combinación'})
            </p>
            <p className="text-emerald-800 tabular-nums">
              {lastRestoreResult.summary.products} productos · {lastRestoreResult.summary.orders}{' '}
              pedidos · {lastRestoreResult.summary.notifications} notificaciones
              {lastRestoreResult.summary.shippingSettings
                ? ' · tarifas de envío actualizadas'
                : ''}
            </p>
          </div>
        </div>
      )}

      {/* SECTION 1: CLOUD BACKUP */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="pb-4 border-b border-zinc-200">
          <h2 className="font-display text-lg font-bold text-zinc-950">
            1. Exportar copia de seguridad en la nube (Firebase Firestore)
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Descargá el catálogo completo, fotos, pedidos, comprobantes de transferencia, alertas y
            tarifas de envío guardados en Firebase Firestore en un archivo JSON.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-zinc-200 bg-zinc-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-950 font-semibold text-sm">
              <Cloud className="w-4 h-4 text-blue-700 shrink-0" />
              <span>Base de datos en la nube (Firebase Firestore)</span>
              {cloudAvailable && (
                <span className="text-[11px] font-mono text-emerald-700">· Conectada</span>
              )}
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed tabular-nums">
              {cloudAvailable
                ? `Sincronización en vivo activa · ${productsCount} productos · ${ordersCount} pedidos registrados.`
                : 'Iniciá sesión con tu cuenta administradora para exportar o restaurar datos en la nube.'}
            </p>
          </div>

          <button
            type="button"
            disabled={!cloudAvailable || busyAction !== null}
            onClick={() => void handleDownloadCloudBackup()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {busyAction === 'backup-cloud-download'
              ? 'Exportando...'
              : 'Descargar backup Firestore (.json)'}
          </button>
        </div>
      </div>

      {/* SECTION 2: RESTORE FROM JSON FILE */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200">
          <div>
            <h2 className="font-display text-lg font-bold text-zinc-950">
              2. Restaurar o importar respaldo desde archivo (.json)
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              Seleccioná cualquier archivo de respaldo JSON de Infourqui Mercado para importarlo o
              restaurarlo directamente en Firebase Firestore.
            </p>
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            {preview ? 'Elegir otro archivo .json' : 'Seleccionar archivo backup (.json)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void handleSelectBackupFile(e)}
            className="hidden"
          />
        </div>

        {!preview ? (
          <div className="border border-dashed border-zinc-300 rounded-xl p-6 text-center space-y-2 bg-zinc-50/40">
            <FileJson className="w-7 h-7 text-zinc-400 mx-auto stroke-[1.5]" />
            <p className="text-xs font-medium text-zinc-700">
              Ningún archivo seleccionado todavía
            </p>
            <p className="text-[11px] text-zinc-500 max-w-lg mx-auto">
              Antes de escribir cualquier dato en la nube, te mostraremos una vista previa con la
              fecha del respaldo y la cantidad de productos, pedidos y notificaciones que contiene.
            </p>
          </div>
        ) : (
          <div className="border border-zinc-200 rounded-xl p-5 space-y-5 bg-zinc-50/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200">
              <div className="flex items-start gap-3">
                <FileJson className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-zinc-950 font-mono break-all">
                    {preview.fileName}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Origen: {formatSourceLabel(preview.sourceMode)}
                    {preview.exportedAt
                      ? ` · Exportado el ${formatDateTime(preview.exportedAt)}`
                      : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-xs text-zinc-500 hover:text-zinc-950 underline cursor-pointer self-start sm:self-center"
              >
                Quitar archivo
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-white border border-zinc-200 rounded-lg">
                <p className="text-zinc-500">Productos</p>
                <p className="font-mono text-base font-bold text-zinc-950 mt-0.5 tabular-nums">
                  {preview.productsCount}
                </p>
              </div>
              <div className="p-3 bg-white border border-zinc-200 rounded-lg">
                <p className="text-zinc-500">Pedidos</p>
                <p className="font-mono text-base font-bold text-zinc-950 mt-0.5 tabular-nums">
                  {preview.ordersCount}
                </p>
              </div>
              <div className="p-3 bg-white border border-zinc-200 rounded-lg">
                <p className="text-zinc-500">Notificaciones</p>
                <p className="font-mono text-base font-bold text-zinc-950 mt-0.5 tabular-nums">
                  {preview.notificationsCount}
                </p>
              </div>
              <div className="p-3 bg-white border border-zinc-200 rounded-lg">
                <p className="text-zinc-500">Tarifas de envío</p>
                <p className="font-mono text-base font-bold text-zinc-950 mt-0.5">
                  {preview.hasShippingSettings ? 'Incluidas' : 'No'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-900">Modo de restauración</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRestoreMode('replace')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                    restoreMode === 'replace'
                      ? 'border-blue-700 bg-blue-50/60 text-zinc-950'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  <p className="font-semibold">Reemplazar todo</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Deja la base en la nube igual al archivo.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreMode('merge')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                    restoreMode === 'merge'
                      ? 'border-blue-700 bg-blue-50/60 text-zinc-950'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  <p className="font-semibold">Combinar datos</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Conserva registros actuales y suma el respaldo.
                  </p>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-zinc-200">
              <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Se validan los datos antes de escribir por lotes en Firebase Firestore.</span>
              </div>

              <button
                type="button"
                disabled={busyAction !== null || !cloudAvailable}
                onClick={() => void handleConfirmFileRestore()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {busyAction === 'restore-file'
                  ? 'Restaurando en Firestore...'
                  : 'Confirmar restauración en Firestore'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
