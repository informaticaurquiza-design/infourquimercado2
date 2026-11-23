import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Laptop,
  Loader2,
  Network,
  Power,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Terminal,
  Upload,
} from 'lucide-react';
import {
  activateCloudflareAccount,
  downloadLocalDatabaseBackup,
  downloadPcLocalNetworkApp,
  fetchCloudflareStatus,
  openCloudflareInDefaultBrowser,
  openCloudflareInGoogleChrome,
  restoreLocalDatabaseBackup,
  startCloudflarePublicTunnel,
  stopCloudflarePublicTunnel,
} from '../services/localApiService';
import type {
  CloudflareTunnelStatus,
  DatabaseMode,
  LocalServerInfo,
} from '../types/ecommerce';

interface LocalDatabasePanelProps {
  dbMode: DatabaseMode;
  onChangeDbMode: (mode: DatabaseMode) => void;
  localServerInfo: LocalServerInfo | null;
  onRefreshServerInfo: () => Promise<void>;
  onOpenBackupsTab?: () => void;
  onNotifyToast: (msg: string) => void;
}

export function LocalDatabasePanel({
  dbMode,
  onChangeDbMode,
  localServerInfo,
  onRefreshServerInfo,
  onOpenBackupsTab,
  onNotifyToast,
}: LocalDatabasePanelProps) {
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    | 'backup'
    | 'restore'
    | 'refresh'
    | 'downloadWindows'
    | 'downloadAll'
    | 'cfActivate'
    | 'cfStart'
    | 'cfStop'
    | 'cfChrome'
    | 'cfDefaultBrowser'
    | null
  >(null);
  const [actionError, setActionError] = useState('');
  const [downloadAppError, setDownloadAppError] = useState('');
  const [cfStatus, setCfStatus] = useState<CloudflareTunnelStatus | null>(null);
  const [cfError, setCfError] = useState('');
  const prevCfPublicUrlRef = useRef<string>('');

  const loadCloudflareStatus = useCallback(async () => {
    if (!localServerInfo?.available) return;
    try {
      const next = await fetchCloudflareStatus(dbMode);
      setCfStatus(next);
      if (next.publicUrl && next.publicUrl !== prevCfPublicUrlRef.current) {
        prevCfPublicUrlRef.current = next.publicUrl;
        void onRefreshServerInfo();
        onNotifyToast('Cuenta Cloudflare activada. Dirección web generada y lista para compartir.');
      } else if (!next.publicUrl) {
        prevCfPublicUrlRef.current = '';
      }
    } catch {
      // ignore transient polling errors
    }
  }, [dbMode, localServerInfo?.available, onNotifyToast, onRefreshServerInfo]);

  useEffect(() => {
    if (!localServerInfo?.available) return;
    void loadCloudflareStatus();
  }, [
    localServerInfo?.available,
    localServerInfo?.cloudflarePhase,
    localServerInfo?.cloudflarePublicUrl,
    loadCloudflareStatus,
  ]);

  useEffect(() => {
    if (!localServerInfo?.available) return;
    const isTransitioning =
      cfStatus?.phase === 'awaiting_browser_auth' ||
      cfStatus?.phase === 'starting' ||
      cfStatus?.phase === 'installing';
    if (!isTransitioning) return;

    const timer = window.setInterval(() => {
      void loadCloudflareStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cfStatus?.phase, localServerInfo?.available, loadCloudflareStatus]);

  async function handleActivateCloudflare(forceRelogin = false) {
    setCfError('');
    setBusyAction('cfActivate');
    try {
      const next = await activateCloudflareAccount(dbMode, forceRelogin);
      setCfStatus(next);
      if (next.phase === 'awaiting_browser_auth' && next.authUrl) {
        onNotifyToast(
          next.chromeOpened
            ? 'Google Chrome abierto para habilitar tu cuenta Cloudflare. Al autorizar verás la dirección web generada.'
            : 'Enlace de Cloudflare listo. Abrilo en Google Chrome para habilitar tu cuenta.',
        );
      } else if (next.phase === 'active' && next.publicUrl) {
        prevCfPublicUrlRef.current = next.publicUrl;
        await onRefreshServerInfo();
        onNotifyToast('Cuenta Cloudflare activada. Dirección web generada.');
      }
    } catch (err) {
      setCfError(
        err instanceof Error ? err.message : 'No pudimos activar la cuenta Cloudflare.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenInGoogleChrome(target: 'auth' | 'public') {
    setCfError('');
    setBusyAction('cfChrome');
    try {
      const res = await openCloudflareInGoogleChrome(dbMode, target);
      setCfStatus(res.cloudflare);
      if (res.opened) {
        onNotifyToast(
          target === 'auth'
            ? 'Google Chrome abierto con Cloudflare. Iniciá sesión y autorizá tu cuenta.'
            : 'Dirección web generada abierta en Google Chrome.',
        );
      } else {
        onNotifyToast(
          'No detectamos Google Chrome en el equipo servidor. Usá el enlace directo desde tu navegador Google Chrome.',
        );
      }
    } catch (err) {
      setCfError(
        err instanceof Error
          ? err.message
          : 'No pudimos abrir el enlace en Google Chrome.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenInDefaultBrowser(target: 'public' | 'auth' = 'public') {
    setCfError('');
    setBusyAction('cfDefaultBrowser');
    try {
      const res = await openCloudflareInDefaultBrowser(dbMode, target);
      setCfStatus(res.cloudflare);
      if (res.opened) {
        onNotifyToast('Dirección web de Cloudflare abierta en el navegador predeterminado.');
      } else {
        onNotifyToast(
          'Usá el botón "Abrir web" para abrir la dirección generada en este navegador.',
        );
      }
    } catch (err) {
      setCfError(
        err instanceof Error
          ? err.message
          : 'No pudimos abrir la dirección web en el navegador predeterminado.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStartQuickTunnel() {
    setCfError('');
    setBusyAction('cfStart');
    try {
      const next = await startCloudflarePublicTunnel(dbMode);
      setCfStatus(next);
      if (next.phase === 'active' && next.publicUrl) {
        prevCfPublicUrlRef.current = next.publicUrl;
        await onRefreshServerInfo();
        onNotifyToast('Dirección web de Cloudflare generada correctamente.');
      }
    } catch (err) {
      setCfError(
        err instanceof Error ? err.message : 'No pudimos generar la dirección web de Cloudflare.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStopCloudflare() {
    setCfError('');
    setBusyAction('cfStop');
    try {
      const next = await stopCloudflarePublicTunnel(dbMode);
      setCfStatus(next);
      prevCfPublicUrlRef.current = '';
      await onRefreshServerInfo();
      onNotifyToast('Túnel Cloudflare detenido.');
    } catch (err) {
      setCfError(
        err instanceof Error ? err.message : 'No pudimos detener el túnel Cloudflare.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      window.setTimeout(() => {
        setCopiedText((curr) => (curr === text ? null : curr));
      }, 1800);
    } catch {
      onNotifyToast('Copiá el enlace seleccionándolo manualmente.');
    }
  }

  async function handleDownloadBackup() {
    setActionError('');
    setBusyAction('backup');
    try {
      await downloadLocalDatabaseBackup(dbMode);
      onNotifyToast('Copia de seguridad descargada correctamente.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No pudimos descargar el respaldo.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setActionError('');
    setBusyAction('restore');
    try {
      const content = await file.text();
      await restoreLocalDatabaseBackup(content, dbMode, 'replace');
      await onRefreshServerInfo();
      onNotifyToast('Base de datos local restaurada y sincronizada en red.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No pudimos restaurar el archivo.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefresh() {
    setBusyAction('refresh');
    try {
      await onRefreshServerInfo();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDownloadPcApp(platform: 'windows' | 'all') {
    setDownloadAppError('');
    setBusyAction(platform === 'windows' ? 'downloadWindows' : 'downloadAll');
    try {
      await downloadPcLocalNetworkApp(dbMode, platform);
      onNotifyToast(
        platform === 'windows'
          ? 'Aplicación en modo Windows descargada (infourqui-mercado-windows.zip).'
          : 'Paquete multiplataforma descargado (infourqui-mercado-pc-local-red.zip).',
      );
    } catch (err) {
      setDownloadAppError(
        err instanceof Error ? err.message : 'No pudimos descargar el paquete para PC.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Download Standalone Windows & Multiplatform Package */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2 text-zinc-950">
            <Laptop className="w-5 h-5 text-blue-700 shrink-0" />
            <h2 className="font-display text-lg font-bold">
              Descargar aplicación en modo Windows (Local y Red LAN)
            </h2>
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            Descargá el paquete listo para Windows 10/11 (<span className="font-mono text-zinc-800">infourqui-mercado-windows.zip</span>):
            se ejecuta en ventana de escritorio independiente con base de datos local y modo red LAN.
          </p>
          <p className="text-xs text-zinc-500">
            Incluye <span className="font-mono text-zinc-700">InfourquiMercado-Windows.bat</span> (menú con instalador automático de Node.js),{' '}
            <span className="font-mono text-zinc-700">Iniciar-Modo-Local.bat</span>,{' '}
            <span className="font-mono text-zinc-700">Iniciar-Modo-Red-LAN.bat</span>, acceso directo al Escritorio y asistente de Firewall.
          </p>
          {downloadAppError && (
            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {downloadAppError}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleDownloadPcApp('windows')}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {busyAction === 'downloadWindows'
              ? 'Empaquetando Windows...'
              : 'Descargar para Windows (.zip)'}
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleDownloadPcApp('all')}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {busyAction === 'downloadAll'
              ? 'Empaquetando...'
              : 'Windows + macOS / Linux (.zip)'}
          </button>
        </div>
      </div>
      {/* Mode Selector */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-5 border-b border-zinc-200">
          <div>
            <h2 className="font-display text-lg font-bold text-zinc-950">
              Motor de base de datos (PC Local, Red LAN y Nube)
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              Elegí si querés operar con la base de datos guardada en esta PC (local y compartida en
              red local) o sincronizada en la nube con Firebase.
            </p>
          </div>
          <button
            type="button"
            disabled={busyAction === 'refresh'}
            onClick={() => void handleRefresh()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
            Actualizar estado
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onChangeDbMode('cloud')}
            className={`text-left p-5 rounded-xl border transition-colors cursor-pointer ${
              dbMode === 'cloud'
                ? 'border-blue-700 bg-blue-50/40'
                : 'border-zinc-200 bg-white hover:border-zinc-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-zinc-950 font-semibold text-sm">
                <Cloud className="w-4 h-4 text-blue-700" />
                <span>Nube (Firebase Firestore)</span>
              </div>
              {dbMode === 'cloud' && (
                <span className="text-xs font-medium text-blue-700">Activo</span>
              )}
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Ideal para ventas online desde cualquier lugar con acceso a internet e inicio de
              sesión con cuenta de Google.
            </p>
          </button>

          <button
            type="button"
            disabled={!localServerInfo?.available}
            onClick={() => onChangeDbMode('local')}
            className={`text-left p-5 rounded-xl border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              dbMode === 'local'
                ? 'border-blue-700 bg-blue-50/40'
                : 'border-zinc-200 bg-white hover:border-zinc-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-zinc-950 font-semibold text-sm">
                <HardDrive className="w-4 h-4 text-emerald-700" />
                <span>PC Local y Red Local (LAN)</span>
              </div>
              {dbMode === 'local' ? (
                <span className="text-xs font-medium text-blue-700">Activo</span>
              ) : !localServerInfo?.available ? (
                <span className="text-xs text-zinc-400">Servidor no detectado</span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Guarda catálogo, stock, pedidos y fotos en el disco de esta PC. Funciona sin internet
              y sincroniza en vivo con otras PCs y celulares de tu Wi-Fi o red LAN.
            </p>
          </button>
        </div>
      </div>

      {/* Cloudflare Account Activation & Public Web URL for Red Local & Celulares */}
      {localServerInfo?.available && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-zinc-200">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-zinc-950">
                <Globe className="w-5 h-5 text-blue-700 shrink-0" />
                <h2 className="font-display text-lg font-bold">
                  Cloudflare Tunnel — Acceso en Red Local y Celulares
                </h2>
                {cfStatus?.phase === 'active' && cfStatus.publicUrl ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                    Activo
                  </span>
                ) : cfStatus?.accountAuthorized ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-md">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Cuenta habilitada
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-zinc-600 leading-relaxed max-w-2xl">
                Activá tu cuenta Cloudflare y habilitala mediante{' '}
                <span className="font-semibold text-zinc-900">Google Chrome</span> para publicar tu
                tienda en modo Red Local y Celulares. Una vez activada, se genera y muestra aquí la
                dirección web HTTPS pública.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {cfStatus?.phase === 'active' && cfStatus.publicUrl ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleStopCloudflare()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  <Power className="w-3.5 h-3.5" />
                  {busyAction === 'cfStop' ? 'Deteniendo...' : 'Detener Cloudflare'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleActivateCloudflare(false)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    {busyAction === 'cfActivate' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Globe className="w-3.5 h-3.5" />
                    )}
                    {cfStatus?.accountAuthorized
                      ? busyAction === 'cfActivate'
                        ? 'Generando dirección web...'
                        : 'Activar túnel y mostrar dirección web'
                      : busyAction === 'cfActivate'
                        ? 'Abriendo Google Chrome...'
                        : 'Activar cuenta Cloudflare en Google Chrome'}
                  </button>

                  {!cfStatus?.accountAuthorized && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void handleStartQuickTunnel()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      {busyAction === 'cfStart' ? 'Generando...' : 'Generar enlace rápido'}
                    </button>
                  )}

                  {cfStatus?.accountAuthorized && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void handleActivateCloudflare(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Cambiar cuenta en Chrome
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {(cfError || cfStatus?.error) && (
            <div className="p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg leading-relaxed">
              {cfError || cfStatus?.error}
            </div>
          )}

          {/* Step: Installing or Starting */}
          {(cfStatus?.phase === 'installing' || cfStatus?.phase === 'starting') && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3 text-xs text-blue-900">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-700" />
              <span>
                {cfStatus.message ||
                  'Preparando conexión Cloudflare y generando dirección web pública...'}
              </span>
            </div>
          )}

          {/* Step: Awaiting Google Chrome Browser Authorization */}
          {cfStatus?.phase === 'awaiting_browser_auth' && (
            <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-amber-950">
                    Habilitá tu cuenta Cloudflare en Google Chrome
                  </p>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    {cfStatus.chromeOpened
                      ? 'Google Chrome se abrió automáticamente en esta PC con la página de Cloudflare. Iniciá sesión y autorizá este equipo; apenas confirmes, se generará y mostrará automáticamente la dirección web aquí abajo.'
                      : 'Abrí el enlace oficial de Cloudflare en Google Chrome, iniciá sesión en tu cuenta y autorizá este equipo. Apenas confirmes la autorización, el túnel se activará solo y verás la dirección web generada aquí abajo.'}
                  </p>
                </div>
                <Loader2 className="w-4 h-4 text-amber-700 animate-spin shrink-0 mt-1" />
              </div>

              {cfStatus.authUrl ? (
                <div className="space-y-2.5">
                  <div className="p-2.5 bg-white border border-amber-200 rounded-lg font-mono text-[11px] text-zinc-700 break-all">
                    {cfStatus.authUrl}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cfStatus.chromeDetected && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleOpenInGoogleChrome('auth')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {busyAction === 'cfChrome'
                          ? 'Abriendo Google Chrome...'
                          : 'Abrir en Google Chrome'}
                      </button>
                    )}
                    <a
                      href={cfStatus.authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                        cfStatus.chromeDetected
                          ? 'text-zinc-900 bg-white border border-zinc-300 hover:border-zinc-950'
                          : 'text-white bg-zinc-950 hover:bg-blue-700'
                      }`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {cfStatus.chromeDetected
                        ? 'Abrir enlace en esta ventana'
                        : 'Habilitar Cloudflare en Google Chrome'}
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleCopy(cfStatus.authUrl || '')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                    >
                      {copiedText === cfStatus.authUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Enlace copiado
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copiar enlace para Chrome
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStopCloudflare()}
                      className="px-3 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-950 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  Generando enlace de autorización con Cloudflare para Google Chrome...
                </p>
              )}
            </div>
          )}

          {/* Step: Active — Show Generated Public Web Address */}
          {(cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl) && (
            <div className="p-5 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-emerald-950">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <p className="text-xs font-bold uppercase tracking-wider">
                    Cuenta Cloudflare activada · Dirección web generada
                  </p>
                </div>
                <span className="text-[11px] font-medium text-emerald-800">
                  {cfStatus?.defaultBrowserOpened
                    ? 'Abierta en navegador predeterminado'
                    : 'Lista para celulares y acceso externo (HTTPS)'}
                </span>
              </div>

              {(() => {
                const activePublicUrl =
                  cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl || '';
                return (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-white border border-emerald-200 rounded-lg">
                    <a
                      href={activePublicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm sm:text-base font-bold text-blue-700 hover:underline break-all"
                    >
                      {activePublicUrl}
                    </a>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopy(activePublicUrl)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                      >
                        {copiedText === activePublicUrl ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copiar dirección
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleOpenInDefaultBrowser('public')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {busyAction === 'cfDefaultBrowser'
                          ? 'Abriendo...'
                          : 'Abrir en navegador predeterminado'}
                      </button>
                      <a
                        href={activePublicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir web
                      </a>
                    </div>
                  </div>
                );
              })()}

              <p className="text-[11px] text-emerald-900 leading-relaxed">
                Al abrir esta dirección web desde celulares o cualquier navegador Google Chrome con
                internet, Infourqui Mercado se conecta automáticamente a tu base de datos en modo
                Red Local.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Network Addresses & Launch Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 text-zinc-950">
            <Network className="w-4 h-4 text-blue-700" />
            <h3 className="font-display text-sm font-bold">
              Direcciones de acceso en esta PC y en Red Local
            </h3>
          </div>

          {localServerInfo?.available ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-zinc-500">Modo de red</p>
                  <p className="font-mono font-semibold text-zinc-950 mt-1">
                    {localServerInfo.networkMode === 'local' ? 'Solo esta PC' : 'Red LAN'}
                  </p>
                </div>
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-zinc-500">Productos</p>
                  <p className="font-mono font-semibold text-zinc-950 mt-1 tabular-nums">
                    {localServerInfo.counts.products}
                  </p>
                </div>
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-zinc-500">Pedidos</p>
                  <p className="font-mono font-semibold text-zinc-950 mt-1 tabular-nums">
                    {localServerInfo.counts.orders}
                  </p>
                </div>
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-zinc-500">Puerto</p>
                  <p className="font-mono font-semibold text-zinc-950 mt-1 tabular-nums">
                    {localServerInfo.port}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-zinc-100">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-zinc-900">Acceso en esta PC (Local)</p>
                    <p className="font-mono text-zinc-600 mt-0.5">{localServerInfo.localUrl}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(localServerInfo.localUrl)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer shrink-0"
                  >
                    {copiedText === localServerInfo.localUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar
                      </>
                    )}
                  </button>
                </div>

                {localServerInfo.lanUrls.length > 0 ? (
                  localServerInfo.lanUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100"
                    >
                      <div>
                        <p className="font-semibold text-zinc-900">
                          Acceso desde otros equipos en Red (LAN / Wi-Fi)
                        </p>
                        <p className="font-mono text-blue-700 mt-0.5">{url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(url)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer shrink-0"
                      >
                        {copiedText === url ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copiar
                          </>
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-500 pt-2 border-t border-zinc-100">
                    El servidor está restringido únicamente a esta PC ({localServerInfo.host}). Para
                    compartir en red local, inicialo con{' '}
                    <span className="font-mono text-zinc-800">npm run start:pc-red</span>.
                  </p>
                )}

                {(cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl) && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100">
                    <div className="min-w-0">
                      <p className="font-semibold text-emerald-800">
                        Dirección web pública generada (Cloudflare · Celulares)
                      </p>
                      <a
                        href={cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-emerald-700 hover:underline mt-0.5 block truncate"
                      >
                        {cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy(
                          cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl || '',
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer shrink-0"
                    >
                      {copiedText ===
                      (cfStatus?.publicUrl || localServerInfo.cloudflarePublicUrl) ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copiar
                        </>
                      )}
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-100">
                  Archivo de base de datos en disco:{' '}
                  <span className="font-mono text-zinc-800">{localServerInfo.dbFileName}</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              No se detectó el servidor local de PC en este entorno. Ejecutá el proyecto con Node.js
              en tu computadora para habilitar la base de datos local y en red.
            </p>
          )}
        </div>

        {/* PC Launch Commands & Backup */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-zinc-950">
              <Terminal className="w-4 h-4 text-zinc-700" />
              <h3 className="font-display text-sm font-bold">Ejecutar en tu PC</h3>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <p className="font-medium text-zinc-800 mb-1">1. Modo solo en esta PC (local)</p>
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-950 text-zinc-100 rounded-lg font-mono text-[11px]">
                  <span className="truncate">npm run start:pc-local</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy('npm run start:pc-local')}
                    className="text-zinc-400 hover:text-white cursor-pointer shrink-0"
                    aria-label="Copiar comando local"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <p className="font-medium text-zinc-800 mb-1">
                  2. Modo en red local (otras PCs y celulares)
                </p>
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-950 text-zinc-100 rounded-lg font-mono text-[11px]">
                  <span className="truncate">npm run start:pc-red</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy('npm run start:pc-red')}
                    className="text-zinc-400 hover:text-white cursor-pointer shrink-0"
                    aria-label="Copiar comando red LAN"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                En Windows podés habilitar el puerto <span className="font-mono">3000</span> en el
                Firewall para que otros equipos y celulares de la oficina o depósito se conecten por
                Wi-Fi.
              </p>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-zinc-950">
              <Database className="w-4 h-4 text-blue-700" />
              <h3 className="font-display text-sm font-bold">Respaldo de base de datos local</h3>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Exportá o restaurá catálogo, inventario, pedidos y tarifas guardados en esta PC en un
              archivo JSON portátil.
            </p>

            {actionError && (
              <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {actionError}
              </div>
            )}

            {!localServerInfo?.available ? (
              <p className="text-xs text-zinc-500">
                Ejecutá Infourqui Mercado en tu PC (modo local o red LAN) para crear o restaurar
                copias de seguridad del archivo en disco.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownloadBackup()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {busyAction === 'backup' ? 'Generando...' : 'Descargar respaldo'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => restoreInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {busyAction === 'restore' ? 'Restaurando...' : 'Restaurar archivo'}
                  </button>
                  <input
                    ref={restoreInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void handleRestoreFile(e)}
                    className="hidden"
                  />
                </div>
                {onOpenBackupsTab && (
                  <button
                    type="button"
                    onClick={onOpenBackupsTab}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 underline cursor-pointer"
                  >
                    Abrir centro completo de Respaldos (Local, Red LAN y Nube)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
