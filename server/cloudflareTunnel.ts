import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CloudflareTunnelPhase =
  | 'idle'
  | 'installing'
  | 'awaiting_browser_auth'
  | 'starting'
  | 'active'
  | 'error';

export interface CloudflareTunnelStatus {
  installed: boolean;
  binaryPath?: string;
  accountAuthorized: boolean;
  chromeDetected: boolean;
  chromeOpened?: boolean;
  defaultBrowserOpened?: boolean;
  phase: CloudflareTunnelPhase;
  authUrl?: string;
  publicUrl?: string;
  startedAt?: string;
  message?: string;
  error?: string;
}

const BIN_DIR = path.resolve(process.cwd(), 'bin');
const LOCAL_BINARY_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const LOCAL_BINARY_PATH = path.resolve(BIN_DIR, LOCAL_BINARY_NAME);

let loginProcess: ChildProcess | null = null;
let tunnelProcess: ChildProcess | null = null;
let certWatcherTimer: NodeJS.Timeout | null = null;
let stateListener: (() => void) | null = null;

const state: {
  phase: CloudflareTunnelPhase;
  authUrl: string;
  publicUrl: string;
  startedAt: string;
  chromeOpened: boolean;
  defaultBrowserOpened: boolean;
  message: string;
  error: string;
} = {
  phase: 'idle',
  authUrl: '',
  publicUrl: '',
  startedAt: '',
  chromeOpened: false,
  defaultBrowserOpened: false,
  message: '',
  error: '',
};

function notifyStateChange(): void {
  try {
    stateListener?.();
  } catch {
    // ignore listener error
  }
}

export function setCloudflareStateListener(listener: (() => void) | null): void {
  stateListener = listener;
}

function getCloudflareCertPath(): string {
  return path.join(os.homedir(), '.cloudflared', 'cert.pem');
}

export function isCloudflareAccountAuthorized(): boolean {
  try {
    return fs.existsSync(getCloudflareCertPath());
  } catch {
    return false;
  }
}

function isValidCloudflareAuthUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'dash.cloudflare.com' &&
      parsed.pathname.toLowerCase().startsWith('/argotunnel')
    );
  } catch {
    return false;
  }
}

function isValidCloudflarePublicUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase().endsWith('.trycloudflare.com') &&
      parsed.hostname.length > '.trycloudflare.com'.length
    );
  } catch {
    return false;
  }
}

export function findGoogleChromeBinary(): string | null {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/local/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore stat errors
    }
  }

  const lookupNames =
    process.platform === 'win32'
      ? ['chrome']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const locator = process.platform === 'win32' ? 'where' : 'which';

  for (const name of lookupNames) {
    try {
      const res = spawnSync(locator, [name], {
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
      });
      if (res.status === 0 && res.stdout) {
        const firstLine = res.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        if (firstLine && fs.existsSync(firstLine)) {
          return firstLine;
        }
      }
    } catch {
      // ignore lookup error
    }
  }

  return null;
}

function launchUrlInGoogleChrome(url: string): {
  opened: boolean;
  chromeDetected: boolean;
} {
  if (!isValidCloudflareAuthUrl(url) && !isValidCloudflarePublicUrl(url)) {
    return { opened: false, chromeDetected: Boolean(findGoogleChromeBinary()) };
  }

  const chromePath = findGoogleChromeBinary();
  if (!chromePath) {
    return { opened: false, chromeDetected: false };
  }

  try {
    const child = spawn(chromePath, [url], {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => {
      // ignore detached spawn errors
    });
    child.unref();
    return { opened: true, chromeDetected: true };
  } catch {
    return { opened: false, chromeDetected: true };
  }
}

function launchUrlInDefaultBrowser(url: string): boolean {
  if (!isValidCloudflarePublicUrl(url) && !isValidCloudflareAuthUrl(url)) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => {
        // ignore detached spawn errors
      });
      child.unref();
      return true;
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', [url], {
        shell: false,
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {
        // ignore
      });
      child.unref();
      return true;
    }

    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      const child = spawn('xdg-open', [url], {
        shell: false,
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {
        // ignore
      });
      child.unref();
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function openCloudflareUrlInDefaultBrowser(target: 'public' | 'auth' = 'public'): {
  opened: boolean;
  status: CloudflareTunnelStatus;
} {
  const url = target === 'auth' ? state.authUrl : state.publicUrl;
  if (!url) {
    return { opened: false, status: getCloudflareStatus(true) };
  }

  const opened = launchUrlInDefaultBrowser(url);
  if (opened && target === 'public') {
    state.defaultBrowserOpened = true;
    notifyStateChange();
  }
  return {
    opened,
    status: getCloudflareStatus(true),
  };
}

export function openCloudflareUrlInChrome(target: 'auth' | 'public' = 'auth'): {
  opened: boolean;
  chromeDetected: boolean;
  status: CloudflareTunnelStatus;
} {
  const url = target === 'public' ? state.publicUrl : state.authUrl;
  const chromeDetected = Boolean(findGoogleChromeBinary());

  if (!url) {
    return {
      opened: false,
      chromeDetected,
      status: getCloudflareStatus(true),
    };
  }

  const result = launchUrlInGoogleChrome(url);
  if (result.opened && target === 'auth') {
    state.chromeOpened = true;
    state.message =
      'Se abrió Google Chrome con la página de Cloudflare. Iniciá sesión y autorizá tu cuenta para generar automáticamente la dirección web.';
    notifyStateChange();
  }

  return {
    opened: result.opened,
    chromeDetected: result.chromeDetected,
    status: getCloudflareStatus(true),
  };
}

export function findCloudflaredBinary(): string | null {
  const candidates: string[] = [LOCAL_BINARY_PATH];

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFilesX86, 'cloudflared', 'cloudflared.exe'),
      path.join(programFiles, 'cloudflared', 'cloudflared.exe'),
    );
    if (localAppData) {
      candidates.push(
        path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
        path.join(localAppData, 'cloudflared', 'cloudflared.exe'),
      );
    }
  } else {
    candidates.push(
      '/usr/local/bin/cloudflared',
      '/opt/homebrew/bin/cloudflared',
      '/usr/bin/cloudflared',
    );
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore stat errors
    }
  }

  try {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(locator, ['cloudflared'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    }
  } catch {
    // ignore PATH lookup failure
  }

  return null;
}

function getOfficialDownloadUrl(): string | null {
  if (process.platform === 'win32') {
    if (process.arch === 'ia32') {
      return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe';
    }
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
    }
    if (process.arch === 'x64') {
      return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    }
  }
  return null;
}

async function ensureCloudflaredInstalled(): Promise<string> {
  const existing = findCloudflaredBinary();
  if (existing) return existing;

  const downloadUrl = getOfficialDownloadUrl();
  if (!downloadUrl) {
    throw new Error(
      'Instalá cloudflared en tu equipo (en macOS: brew install cloudflared; en Windows: winget install Cloudflare.cloudflared) y volvé a intentarlo.',
    );
  }

  state.phase = 'installing';
  state.error = '';
  state.message = 'Descargando componente oficial de Cloudflare (cloudflared)...';
  notifyStateChange();

  try {
    const response = await fetch(downloadUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 1_000_000) {
      throw new Error('Archivo descargado incompleto.');
    }

    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
    }
    const tmpPath = `${LOCAL_BINARY_PATH}.tmp`;
    fs.writeFileSync(tmpPath, buffer);
    if (process.platform !== 'win32') {
      fs.chmodSync(tmpPath, 0o755);
    }
    fs.renameSync(tmpPath, LOCAL_BINARY_PATH);
    return LOCAL_BINARY_PATH;
  } catch (err) {
    state.phase = 'error';
    state.error =
      'No pudimos descargar cloudflared automáticamente. Verificá tu conexión a internet o instalalo manualmente (Windows: winget install Cloudflare.cloudflared).';
    state.message = '';
    notifyStateChange();
    throw new Error(err instanceof Error ? `${state.error} (${err.message})` : state.error);
  }
}

function clearCertWatcher(): void {
  if (certWatcherTimer) {
    clearInterval(certWatcherTimer);
    certWatcherTimer = null;
  }
}

function killProcessSafely(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // ignore
  }
  const pid = proc.pid;
  if (pid) {
    setTimeout(() => {
      try {
        if (!proc.killed && proc.exitCode === null) {
          proc.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }, 1500).unref();
  }
}

export function getCloudflarePublicUrl(): string {
  return state.phase === 'active' ? state.publicUrl : '';
}

export function getCloudflareStatus(includeAuthUrl = true): CloudflareTunnelStatus {
  const binaryPath = findCloudflaredBinary();
  const accountAuthorized = isCloudflareAccountAuthorized();
  const chromeDetected = Boolean(findGoogleChromeBinary());

  return {
    installed: Boolean(binaryPath),
    binaryPath: binaryPath || undefined,
    accountAuthorized,
    chromeDetected,
    chromeOpened: state.chromeOpened || undefined,
    defaultBrowserOpened: state.defaultBrowserOpened || undefined,
    phase: state.phase,
    authUrl: includeAuthUrl && state.authUrl ? state.authUrl : undefined,
    publicUrl: state.publicUrl || undefined,
    startedAt: state.startedAt || undefined,
    message: state.message || undefined,
    error: state.error || undefined,
  };
}

export function stopCloudflareTunnel(): CloudflareTunnelStatus {
  clearCertWatcher();
  if (loginProcess) {
    killProcessSafely(loginProcess);
    loginProcess = null;
  }
  if (tunnelProcess) {
    killProcessSafely(tunnelProcess);
    tunnelProcess = null;
  }
  state.phase = 'idle';
  state.authUrl = '';
  state.publicUrl = '';
  state.startedAt = '';
  state.chromeOpened = false;
  state.defaultBrowserOpened = false;
  state.message = '';
  state.error = '';
  notifyStateChange();
  return getCloudflareStatus(true);
}

export async function startCloudflareTunnel(port: number): Promise<CloudflareTunnelStatus> {
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
  const binaryPath = await ensureCloudflaredInstalled();

  if (tunnelProcess && state.phase === 'active' && state.publicUrl) {
    return getCloudflareStatus(true);
  }

  clearCertWatcher();
  if (tunnelProcess) {
    killProcessSafely(tunnelProcess);
    tunnelProcess = null;
  }

  state.phase = 'starting';
  state.authUrl = '';
  state.publicUrl = '';
  state.startedAt = '';
  state.chromeOpened = false;
  state.defaultBrowserOpened = false;
  state.error = '';
  state.message = 'Cuenta Cloudflare habilitada. Generando dirección web pública para celulares y red local...';
  notifyStateChange();

  const child = spawn(
    binaryPath,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${safePort}`],
    {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  tunnelProcess = child;

  const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timer = setTimeout(finish, 16000);
    timer.unref();

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const match = text.match(urlRegex);
      if (match && match[0] && isValidCloudflarePublicUrl(match[0]) && tunnelProcess === child) {
        if (state.publicUrl === match[0]) return;
        const publicUrl = match[0];
        const openedDefault = launchUrlInDefaultBrowser(publicUrl);
        state.phase = 'active';
        state.publicUrl = publicUrl;
        state.startedAt = new Date().toISOString();
        state.defaultBrowserOpened = openedDefault;
        state.error = '';
        state.message = openedDefault
          ? 'Cuenta Cloudflare activada. Dirección web generada y abierta en tu navegador predeterminado.'
          : 'Cuenta Cloudflare activada. Dirección web pública generada y lista para celulares y navegadores.';
        console.log('');
        console.log('====================================================');
        console.log('  CLOUDFLARE ACTIVO — DIRECCION WEB GENERADA:');
        console.log(`  ${publicUrl}`);
        if (openedDefault) {
          console.log('  Abierta automaticamente en el navegador predeterminado.');
        }
        console.log('====================================================');
        console.log('');
        clearTimeout(timer);
        notifyStateChange();
        finish();
      }
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);

    child.on('error', (err) => {
      if (tunnelProcess === child) {
        tunnelProcess = null;
        state.phase = 'error';
        state.error = `No se pudo iniciar el túnel Cloudflare (${err.message}).`;
        state.message = '';
        clearTimeout(timer);
        notifyStateChange();
      }
      finish();
    });

    child.on('exit', (code) => {
      if (tunnelProcess === child) {
        tunnelProcess = null;
        if (state.phase === 'starting' || (state.phase === 'active' && code !== 0)) {
          state.phase = 'error';
          state.publicUrl = '';
          state.startedAt = '';
          state.error = 'El túnel Cloudflare se detuvo inesperadamente. Intentá activarlo nuevamente.';
          state.message = '';
          notifyStateChange();
        } else if (state.phase === 'active') {
          state.phase = 'idle';
          state.publicUrl = '';
          state.startedAt = '';
          state.message = '';
          notifyStateChange();
        }
      }
      clearTimeout(timer);
      finish();
    });
  });

  return getCloudflareStatus(true);
}

export async function activateCloudflareAccountInBrowser(
  port: number,
  forceRelogin = false,
): Promise<CloudflareTunnelStatus> {
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
  const binaryPath = await ensureCloudflaredInstalled();

  // If account is already authorized and no relogin requested, launch tunnel immediately
  if (isCloudflareAccountAuthorized() && !forceRelogin) {
    return startCloudflareTunnel(safePort);
  }

  // Cancel any existing login or tunnel process
  clearCertWatcher();
  if (loginProcess) {
    killProcessSafely(loginProcess);
    loginProcess = null;
  }
  if (tunnelProcess) {
    killProcessSafely(tunnelProcess);
    tunnelProcess = null;
  }

  // If re-linking explicitly, remove old cert so cloudflared prompts a fresh Google Chrome authorization
  if (forceRelogin) {
    const certPath = getCloudflareCertPath();
    try {
      if (fs.existsSync(certPath)) {
        fs.unlinkSync(certPath);
      }
    } catch {
      // ignore removal error
    }
  }

  const chromePath = findGoogleChromeBinary();

  state.phase = 'awaiting_browser_auth';
  state.authUrl = '';
  state.publicUrl = '';
  state.startedAt = '';
  state.chromeOpened = false;
  state.error = '';
  state.message =
    'Generando enlace de autorización para habilitar tu cuenta Cloudflare en Google Chrome...';
  notifyStateChange();

  const child = spawn(binaryPath, ['tunnel', 'login'], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // On macOS/Linux suppress cloudflared's default browser opener so we launch Google Chrome directly
      BROWSER: process.platform === 'win32' ? chromePath || process.env.BROWSER || '' : 'true',
    },
  });
  loginProcess = child;

  const authUrlRegex = /https:\/\/dash\.cloudflare\.com\/argotunnel[^\s"'<>]+/i;
  let tunnelTriggeredAfterAuth = false;

  const triggerTunnelAfterAuthorization = () => {
    if (tunnelTriggeredAfterAuth) return;
    tunnelTriggeredAfterAuth = true;
    clearCertWatcher();
    if (loginProcess === child) {
      loginProcess = null;
    }
    state.authUrl = '';
    state.chromeOpened = false;
    state.message =
      'Cuenta Cloudflare habilitada en Google Chrome. Generando dirección web pública...';
    notifyStateChange();
    void startCloudflareTunnel(safePort).catch(() => {});
  };

  // Watch for cert.pem creation so even if cloudflared lags exiting after browser auth, tunnel starts right away
  certWatcherTimer = setInterval(() => {
    if (state.phase !== 'awaiting_browser_auth') {
      clearCertWatcher();
      return;
    }
    if (isCloudflareAccountAuthorized()) {
      killProcessSafely(child);
      triggerTunnelAfterAuthorization();
    }
  }, 1500);
  certWatcherTimer.unref();

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timer = setTimeout(finish, 12000);
    timer.unref();

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const match = text.match(authUrlRegex);
      if (match && match[0] && isValidCloudflareAuthUrl(match[0]) && loginProcess === child) {
        const validatedAuthUrl = match[0];
        if (state.authUrl === validatedAuthUrl) return;
        state.authUrl = validatedAuthUrl;

        const launch = launchUrlInGoogleChrome(validatedAuthUrl);
        state.chromeOpened = launch.opened;
        state.message = launch.opened
          ? 'Google Chrome se abrió automáticamente con Cloudflare. Iniciá sesión y autorizá tu cuenta; luego verás la dirección web generada aquí.'
          : 'Abrí el enlace en Google Chrome para iniciar sesión en Cloudflare y autorizar este equipo. Luego verás la dirección web generada aquí.';

        console.log('');
        console.log('----------------------------------------------------');
        console.log(
          launch.opened
            ? '  Google Chrome abierto para habilitar tu cuenta Cloudflare:'
            : '  Abri este enlace en Google Chrome para habilitar tu cuenta Cloudflare:',
        );
        console.log(`  ${validatedAuthUrl}`);
        console.log('----------------------------------------------------');
        console.log('');

        clearTimeout(timer);
        notifyStateChange();
        finish();
      }
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);

    child.on('error', (err) => {
      if (loginProcess === child) {
        clearCertWatcher();
        loginProcess = null;
        state.phase = 'error';
        state.authUrl = '';
        state.chromeOpened = false;
        state.error = `No pudimos iniciar la vinculación con Cloudflare (${err.message}).`;
        state.message = '';
        clearTimeout(timer);
        notifyStateChange();
      }
      finish();
    });

    child.on('exit', (code) => {
      if (loginProcess === child) {
        clearCertWatcher();
        loginProcess = null;
        if (code === 0 || isCloudflareAccountAuthorized()) {
          triggerTunnelAfterAuthorization();
        } else if (state.phase === 'awaiting_browser_auth') {
          state.phase = 'error';
          state.authUrl = '';
          state.chromeOpened = false;
          state.error =
            'La autorización de la cuenta Cloudflare en Google Chrome no se completó. Podés intentarlo de nuevo o generar un enlace rápido directamente.';
          state.message = '';
          notifyStateChange();
        }
      }
      clearTimeout(timer);
      finish();
    });
  });

  return getCloudflareStatus(true);
}

process.on('exit', () => {
  clearCertWatcher();
  killProcessSafely(loginProcess);
  killProcessSafely(tunnelProcess);
});
