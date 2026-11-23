import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileJson,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { formatDateTime } from '../lib/validation';
import {
  exportCloudDatabaseBackup,
  restoreCloudDatabaseBackup,
} from '../services/firestoreService';
import {
  createServerBackupSnapshot,
  deleteServerBackupSnapshot,
  downloadLocalDatabaseBackup,
  downloadServerBackupSnapshot,
  listServerBackupSnapshots,
  restoreLocalDatabaseBackup,
  restoreServerBackupSnapshot,
  triggerJsonDownload,
} from '../services/localApiService';
import type {
  AppUser,
  DatabaseMode,
  LocalBackupSnapshotMeta,
  LocalServerInfo,
  RestoreMode,
  RestoreSummary,
} from '../types/ecommerce';

interface DatabaseBackupPanelProps {
  user: AppUser;
  dbMode: DatabaseMode;
  localServerInfo: LocalServerInfo | null;
  productsCount: number;
  ordersCount: number;
  onRefreshServerInfo: () => Promise<void>;
  onNotifyToast: (msg: string) => void;
}

interface ParsedBackupPreview {
  fileName: string;
  rawText: string;
  parsedObject: Record<string, unknown>;
  exportedAt: string | null;
  sourceMode: string;
  productsCount: number;
  ordersCount: number;
  notificationsCount: number;
  hasShippingSettings: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSourceLabel(sourceMode: string): string {
  if (sourceMode === 'cloud') return 'Nube (Firebase)';
  if (sourceMode === 'lan') return 'Red LAN (PC)';
  if (sourceMode === 'local') return 'PC Local';
  return 'Respaldo JSON';
}

export function DatabaseBackupPanel({
  user,
  dbMode,
  localServerInfo,
  productsCount,
  ordersCount,
  onRefreshServerInfo,
  onNotifyToast,
}: DatabaseBackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const localAvailable = Boolean(localServerInfo?.available);
  const cloudAvailable = Boolean(auth.currentUser);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastRestoreResult, setLastRestoreResult] = useState<{
    target: DatabaseMode;
    mode: RestoreMode;
    summary: RestoreSummary;
  } | null>(null);

  // Uploaded file preview state
  const [preview, setPreview] = useState<ParsedBackupPreview | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DatabaseMode>(
    dbMode === 'local' && localAvailable ? 'local' : cloudAvailable ? 'cloud' : 'local',
  );
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('replace');

  // Server disk snapshots state
  const [snapshots, setSnapshots] = useState<LocalBackupSnapshotMeta[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [snapshotRestoreMode, setSnapshotRestoreMode] = useState<RestoreMode>('replace');
  const [pendingConfirm, setPendingConfirm] = useState<{
    action: 'restore-snapshot' | 'delete-snapshot';
    fileName: string;
  } | null>(null);

  useEffect(() => {
    if (restoreTarget === 'local' && !localAvailable && cloudAvailable) {
      setRestoreTarget('cloud');
    } else if (restoreTarget === 'cloud' && !cloudAvailable && localAvailable) {
      setRestoreTarget('local');
    }
  }, [localAvailable, cloudAvailable, restoreTarget]);

  const loadSnapshots = useCallback(async () => {
    if (!localAvailable) {
      setSnapshots([]);
      return;
    }
    setLoadingSnapshots(true);
    try {
      const list = await listServerBackupSnapshots(dbMode);
      setSnapshots(list);
    } catch {
      setSnapshots([]);
    } finally {
      setLoadingSnapshots(false);
    }
  }, [localAvailable, dbMode]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  async function handleDownloadLocalBackup() {
    setErrorMessage('');
    setBusyAction('backup-local-download');
    try {
      await downloadLocalDatabaseBackup(dbMode);
      onNotifyToast('Copia de seguridad Local / Red LAN descargada correctamente.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos descargar el respaldo local.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateServerSnapshot() {
    setErrorMessage('');
    setBusyAction('backup-local-snapshot');
    try {
      const snapshot = await createServerBackupSnapshot(dbMode);
      await loadSnapshots();
      onNotifyToast(`Copia guardada en servidor PC: ${snapshot.fileName}`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos guardar la copia en el servidor PC.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDownloadCloudBackup() {
    setErrorMessage('');
    setBusyAction('backup-cloud-download');
    try {
      const payload = await exportCloudDatabaseBackup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      triggerJsonDownload(
        JSON.stringify(payload, null, 2),
        `infourqui-mercado-backup-nube-${stamp}.json`,
      );
      onNotifyToast('Copia de seguridad en la Nube (Firebase) descargada correctamente.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos exportar la base de datos en la Nube.',
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
        rawText: text,
        parsedObject: parsed,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
        sourceMode: typeof parsed.sourceMode === 'string' ? parsed.sourceMode : 'desconocido',
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
      let summary: RestoreSummary;
      if (restoreTarget === 'local') {
        summary = await restoreLocalDatabaseBackup(preview.rawText, dbMode, restoreMode);
        await onRefreshServerInfo();
        await loadSnapshots();
        onNotifyToast(
          'Base de datos PC Local / Red LAN restaurada y sincronizada en vivo con todos los equipos.',
        );
      } else {
        summary = await restoreCloudDatabaseBackup(preview.parsedObject, user, restoreMode);
        onNotifyToast('Base de datos en Nube (Firebase) restaurada correctamente.');
      }

      setLastRestoreResult({
        target: restoreTarget,
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

  async function handleRestoreSnapshot(fileName: string) {
    setErrorMessage('');
    setLastRestoreResult(null);
    setPendingConfirm(null);
    setBusyAction(`restore-snapshot:${fileName}`);
    try {
      const summary = await restoreServerBackupSnapshot(fileName, dbMode, snapshotRestoreMode);
      await onRefreshServerInfo();
      await loadSnapshots();
      setLastRestoreResult({
        target: 'local',
        mode: snapshotRestoreMode,
        summary,
      });
      onNotifyToast(`Copia "${fileName}" restaurada y sincronizada en red LAN.`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos restaurar la copia del servidor.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDownloadSnapshot(fileName: string) {
    setErrorMessage('');
    setBusyAction(`download-snapshot:${fileName}`);
    try {
      await downloadServerBackupSnapshot(fileName, dbMode);
      onNotifyToast(`Copia "${fileName}" descargada.`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos descargar la copia seleccionada.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteSnapshot(fileName: string) {
    setErrorMessage('');
    setPendingConfirm(null);
    setBusyAction(`delete-snapshot:${fileName}`);
    try {
      await deleteServerBackupSnapshot(fileName, dbMode);
      await loadSnapshots();
      onNotifyToast(`Copia "${fileName}" eliminada del servidor PC.`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No pudimos eliminar la copia seleccionada.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Error / Restore Summary Banners */}
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
              Restauración completada en{' '}
              {lastRestoreResult.target === 'local'
                ? 'PC Local y Red LAN'
                : 'Base de datos en Nube (Firebase)'}{' '}
              ({lastRestoreResult.mode === 'replace' ? 'Reemplazo total' : 'Combinación'})
            </p>
            <p className="text-emerald-800 tabular-nums">
              {lastRestoreResult.summary.products} productos · {lastRestoreResult.summary.orders}{' '}
              pedidos · {lastRestoreResult.summary.notifications} notificaciones
              {lastRestoreResult.summary.shippingSettings ? ' · tarifas de envío actualizadas' : ''}
            </p>
            {lastRestoreResult.summary.safetyBackupFile && (
              <p className="text-[11px] text-emerald-700">
                Se guardó automáticamente una copia preventiva antes de restaurar:{' '}
                <span className="font-mono font-medium">
                  {lastRestoreResult.summary.safetyBackupFile}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* SECTION 1: CREATE BACKUPS (LOCAL/LAN & CLOUD) */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="pb-4 border-b border-zinc-200">
          <h2 className="font-display text-lg font-bold text-zinc-950">
            1. Hacer backup de la base de datos (Local, Red LAN y Nube)
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            Exportá catálogo completo, fotos, pedidos, comprobantes de transferencia, alertas y
            tarifas de envío en un archivo JSON compatible entre modo PC Local/Red y modo Nube.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Local & LAN Backup Card */}
          <div className="p-5 rounded-xl border border-zinc-200 bg-zinc-50/50 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-zinc-950 font-semibold text-sm">
                  <HardDrive className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Base de datos PC Local y Red LAN</span>
                </div>
                {localAvailable ? (
                  <span className="text-[11px] font-mono text-emerald-700">
                    {localServerInfo?.networkMode === 'local' ? 'Solo esta PC' : 'Red LAN activa'}
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-400">Servidor no detectado</span>
                )}
              </div>

              {localAvailable && localServerInfo ? (
                <p className="text-xs text-zinc-600 leading-relaxed tabular-nums">
                  Archivo <span className="font-mono text-zinc-800">{localServerInfo.dbFileName}</span>{' '}
                  · {localServerInfo.counts.products} productos · {localServerInfo.counts.orders}{' '}
                  pedidos · {localServerInfo.counts.notifications} alertas.
                </p>
              ) : (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Ejecutá Infourqui Mercado en tu PC (modo local o red LAN) para crear y administrar
                  copias de seguridad en disco.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={!localAvailable || busyAction !== null}
                onClick={() => void handleDownloadLocalBackup()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {busyAction === 'backup-local-download'
                  ? 'Generando...'
                  : 'Descargar backup Local/Red (.json)'}
              </button>

              <button
                type="button"
                disabled={!localAvailable || busyAction !== null}
                onClick={() => void handleCreateServerSnapshot()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                {busyAction === 'backup-local-snapshot'
                  ? 'Guardando...'
                  : 'Guardar copia en servidor PC'}
              </button>
            </div>
          </div>

          {/* Cloud Backup Card */}
          <div className="p-5 rounded-xl border border-zinc-200 bg-zinc-50/50 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-zinc-950 font-semibold text-sm">
                  <Cloud className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Base de datos en Red Online (Nube)</span>
                </div>
                {cloudAvailable ? (
                  <span className="text-[11px] font-mono text-blue-700">Conectada</span>
                ) : (
                  <span className="text-[11px] text-zinc-400">Sesión Nube requerida</span>
                )}
              </div>

              {cloudAvailable ? (
                <p className="text-xs text-zinc-600 leading-relaxed tabular-nums">
                  {dbMode === 'cloud'
                    ? `Conectado a Firebase Firestore · ${productsCount} productos · ${ordersCount} pedidos activos.`
                    : 'Sesión Firebase verificada: podés descargar un backup completo de la Nube para migrarlo o resguardarlo.'}
                </p>
              ) : (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Estás operando únicamente con sesión local. Para respaldar o restaurar la base en
                  la Nube, iniciá sesión con tu cuenta de Google administradora.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={!cloudAvailable || busyAction !== null}
                onClick={() => void handleDownloadCloudBackup()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {busyAction === 'backup-cloud-download'
                  ? 'Exportando Nube...'
                  : 'Descargar backup Nube (.json)'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: RESTORE FROM JSON FILE */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200">
          <div>
            <h2 className="font-display text-lg font-bold text-zinc-950">
              2. Restaurar base de datos desde archivo (.json)
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              Seleccioná cualquier respaldo de Infourqui Mercado (creado en PC Local, Red LAN o
              Nube) y elegí en qué motor restaurarlo. Al restaurar en PC Local/Red se sincroniza en
              vivo con todos los equipos conectados.
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
              Antes de escribir cualquier dato, te mostraremos una vista previa con la fecha del
              respaldo y la cantidad de productos, pedidos y notificaciones que contiene.
            </p>
          </div>
        ) : (
          <div className="border border-zinc-200 rounded-xl p-5 space-y-5 bg-zinc-50/50">
            {/* File summary */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200">
              <div className="flex items-start gap-3">
                <FileJson className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-zinc-950 font-mono break-all">
                    {preview.fileName}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Origen: {formatSourceLabel(preview.sourceMode)}
                    {preview.exportedAt ? ` · Exportado el ${formatDateTime(preview.exportedAt)}` : ''}
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

            {/* Counts */}
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

            {/* Destination + Mode selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-zinc-900">Destino de restauración</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!localAvailable}
                    onClick={() => setRestoreTarget('local')}
                    className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      restoreTarget === 'local'
                        ? 'border-blue-700 bg-blue-50/60 text-zinc-950 font-semibold'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-emerald-700" />
                      <span>PC Local y Red LAN</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={!cloudAvailable}
                    onClick={() => setRestoreTarget('cloud')}
                    className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      restoreTarget === 'cloud'
                        ? 'border-blue-700 bg-blue-50/60 text-zinc-950 font-semibold'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Cloud className="w-3.5 h-3.5 text-blue-700" />
                      <span>Red Online (Nube)</span>
                    </div>
                  </button>
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
                      Deja la base igual al archivo.
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
                      Conserva registros actuales y suma el backup.
                    </p>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-zinc-200">
              <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  {restoreTarget === 'local'
                    ? 'El servidor PC guardará una copia preventiva automática en data/backups/ antes de aplicar los cambios.'
                    : 'Se validan los datos antes de escribir por lotes en Firebase Firestore.'}
                </span>
              </div>

              <button
                type="button"
                disabled={
                  busyAction !== null ||
                  (restoreTarget === 'local' && !localAvailable) ||
                  (restoreTarget === 'cloud' && !cloudAvailable)
                }
                onClick={() => void handleConfirmFileRestore()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {busyAction === 'restore-file'
                  ? 'Restaurando base de datos...'
                  : `Confirmar restauración en ${
                      restoreTarget === 'local' ? 'PC Local / Red' : 'Nube'
                    }`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: SERVER DISK SNAPSHOTS (PC LOCAL & LAN) */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200">
          <div>
            <h2 className="font-display text-lg font-bold text-zinc-950">
              3. Historial de copias en el servidor PC / Red LAN
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              Copias almacenadas en la carpeta <span className="font-mono text-zinc-800">data/backups/</span>{' '}
              del equipo servidor (incluye copias manuales y respaldos preventivos automáticos).
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Modo al restaurar una copia del historial"
              value={snapshotRestoreMode}
              onChange={(e) => setSnapshotRestoreMode(e.target.value as RestoreMode)}
              className="px-2.5 py-2 text-xs bg-white border border-zinc-300 rounded-lg text-zinc-800 cursor-pointer focus:outline-none focus:border-blue-700"
            >
              <option value="replace">Al restaurar: Reemplazar todo</option>
              <option value="merge">Al restaurar: Combinar datos</option>
            </select>
            <button
              type="button"
              disabled={!localAvailable || loadingSnapshots}
              onClick={() => void loadSnapshots()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSnapshots ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {!localAvailable ? (
          <p className="text-xs text-zinc-500">
            Conectate a un servidor PC Local o Red LAN para ver y restaurar copias guardadas en
            disco.
          </p>
        ) : loadingSnapshots && snapshots.length === 0 ? (
          <p className="text-xs text-zinc-500">Cargando copias guardadas en el servidor...</p>
        ) : snapshots.length === 0 ? (
          <div className="p-6 text-center border border-zinc-200 rounded-xl bg-zinc-50/40">
            <p className="text-xs text-zinc-600">
              Todavía no hay copias guardadas en <span className="font-mono">data/backups/</span>.
              Usá el botón <strong>Guardar copia en servidor PC</strong> para crear tu primer punto
              de restauración.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-zinc-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Archivo de respaldo</th>
                  <th className="py-3 px-4 font-medium">Fecha</th>
                  <th className="py-3 px-4 font-medium">Contenido</th>
                  <th className="py-3 px-4 font-medium text-right">Tamaño</th>
                  <th className="py-3 px-4 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {snapshots.map((snap) => {
                  const confirmingRestore =
                    pendingConfirm?.action === 'restore-snapshot' &&
                    pendingConfirm.fileName === snap.fileName;
                  const confirmingDelete =
                    pendingConfirm?.action === 'delete-snapshot' &&
                    pendingConfirm.fileName === snap.fileName;

                  return (
                    <tr key={snap.fileName} className="hover:bg-zinc-50/70">
                      <td className="py-3 px-4">
                        <p className="font-mono font-medium text-zinc-900">{snap.fileName}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Origen: {formatSourceLabel(snap.sourceMode)}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatDateTime(snap.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-zinc-700 whitespace-nowrap tabular-nums">
                        {snap.productsCount} prod · {snap.ordersCount} ped ·{' '}
                        {snap.notificationsCount} alert
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatBytes(snap.sizeBytes)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {confirmingRestore ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() => void handleRestoreSnapshot(snap.fileName)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingConfirm(null)}
                              className="px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 bg-white border border-zinc-300 rounded-md cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : confirmingDelete ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() => void handleDeleteSnapshot(snap.fileName)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                            >
                              Eliminar
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingConfirm(null)}
                              className="px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 bg-white border border-zinc-300 rounded-md cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                setPendingConfirm({
                                  action: 'restore-snapshot',
                                  fileName: snap.fileName,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {busyAction === `restore-snapshot:${snap.fileName}`
                                ? 'Restaurando...'
                                : 'Restaurar'}
                            </button>
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() => void handleDownloadSnapshot(snap.fileName)}
                              aria-label={`Descargar ${snap.fileName}`}
                              className="p-1.5 text-zinc-600 hover:text-zinc-950 bg-white border border-zinc-200 hover:border-zinc-400 rounded-md cursor-pointer disabled:opacity-50"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                setPendingConfirm({
                                  action: 'delete-snapshot',
                                  fileName: snap.fileName,
                                })
                              }
                              aria-label={`Eliminar ${snap.fileName}`}
                              className="p-1.5 text-zinc-500 hover:text-red-700 bg-white border border-zinc-200 hover:border-red-300 rounded-md cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
    </div>
  );
}
