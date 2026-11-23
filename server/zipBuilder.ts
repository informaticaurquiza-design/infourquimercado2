import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  content: Buffer;
  unixMode?: number;
}

export type DownloadPlatform = 'windows' | 'all';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export function createZipArchive(entries: ZipEntry[]): Buffer {
  const now = new Date();
  const { dosTime, dosDate } = getDosDateTime(now);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const normalizedName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(normalizedName, 'utf8');
    const rawContent = entry.content;
    const checksum = crc32(rawContent);

    const useDeflate = rawContent.length > 0;
    const compressed = useDeflate ? zlib.deflateRawSync(rawContent, { level: 6 }) : rawContent;
    const compressionMethod = useDeflate ? 8 : 0;

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawContent.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    const unixMode = entry.unixMode ?? 0o100644;
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawContent.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((unixMode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

const ROOT_DIR = path.resolve(process.cwd());

const ALLOWLISTED_ROOT_FILES = [
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'metadata.json',
  '.env.example',
  '.gitignore',
  'firebase-applet-config.json',
  'server.ts',
];

function createStandalonePackageJson(): Buffer {
  const pkgPath = path.resolve(ROOT_DIR, 'package.json');
  const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    name?: string;
    private?: boolean;
    version?: string;
    type?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const deps = { ...(raw.dependencies || {}) };
  delete deps['@firebase/eslint-plugin-security-rules'];
  delete deps['eslint'];
  delete deps['@zxing/browser'];
  delete deps['@zxing/library'];

  const devDeps = { ...(raw.devDependencies || {}) };
  delete devDeps['esbuild'];

  const cleanPkg = {
    name: 'infourqui-mercado-pc',
    private: true,
    version: raw.version || '1.0.0',
    type: raw.type || 'module',
    scripts: raw.scripts || {},
    dependencies: deps,
    devDependencies: devDeps,
  };

  return Buffer.from(`${JSON.stringify(cleanPkg, null, 2)}\n`, 'utf8');
}

const ALLOWLISTED_DIRECTORIES = ['src', 'server'];

function collectSafeDirectoryFiles(
  zipRootFolder: string,
  relDir: string,
  entries: ZipEntry[],
): void {
  const absDir = path.resolve(ROOT_DIR, relDir);
  if (!absDir.startsWith(ROOT_DIR + path.sep) || !fs.existsSync(absDir)) {
    return;
  }

  const items = fs.readdirSync(absDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isSymbolicLink()) continue;
    if (item.name.startsWith('.')) continue;

    const childRel = path.posix.join(relDir, item.name);
    const childAbs = path.resolve(ROOT_DIR, childRel);
    if (!childAbs.startsWith(ROOT_DIR + path.sep)) continue;

    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === 'dist' || item.name === 'data') {
        continue;
      }
      collectSafeDirectoryFiles(zipRootFolder, childRel, entries);
    } else if (item.isFile()) {
      if (item.name.includes('.test.') || item.name.startsWith('.env')) continue;
      entries.push({
        name: `${zipRootFolder}/${childRel}`,
        content: fs.readFileSync(childAbs),
      });
    }
  }
}

function buildWindowsOpenAppSnippet(
  appUrl = 'http://localhost:3000/?mode=local',
  preferFullChromeWindow = false,
): string[] {
  const chromeArgs = preferFullChromeWindow ? '%APP_URL%' : '--app=%APP_URL%';
  return [
    `set "APP_URL=${appUrl}"`,
    'set "CHROME_EXE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%CHROME_EXE%" set "CHROME_EXE=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"',
    'set "EDGE_EXE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not exist "%EDGE_EXE%" set "EDGE_EXE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if exist "%CHROME_EXE%" (',
    `  start "" "%CHROME_EXE%" ${chromeArgs}`,
    ') else if exist "%EDGE_EXE%" (',
    '  start "" "%EDGE_EXE%" --app=%APP_URL%',
    ') else (',
    '  start "" %APP_URL%',
    ')',
  ];
}

function buildWindowsEnsureDepsSnippet(): string[] {
  return [
    'set "NEED_INSTALL=0"',
    'if not exist "node_modules\\tsx" set "NEED_INSTALL=1"',
    'if not exist "node_modules\\@google\\genai" set "NEED_INSTALL=1"',
    'if not exist "node_modules\\.infourqui-pkg.json" (',
    '  set "NEED_INSTALL=1"',
    ') else (',
    '  fc /b "package.json" "node_modules\\.infourqui-pkg.json" >nul 2>nul',
    '  if errorlevel 1 set "NEED_INSTALL=1"',
    ')',
    'if "%NEED_INSTALL%"=="1" (',
    '  echo Instalando/actualizando dependencias de Infourqui Mercado...',
    '  call npm install --no-audit --no-fund',
    '  if errorlevel 1 (',
    '    echo Reintentando instalacion con resolucion compatible...',
    '    call npm install --legacy-peer-deps --no-audit --no-fund',
    '  )',
    '  if errorlevel 1 (',
    '    echo [ERROR] No se pudieron instalar las dependencias.',
    '    pause',
    '    exit /b 1',
    '  )',
    '  copy /y "package.json" "node_modules\\.infourqui-pkg.json" >nul 2>nul',
    ')',
  ];
}

function createWindowsLauncherEntries(zipRootFolder: string): ZipEntry[] {
  const openLocalAppLines = buildWindowsOpenAppSnippet('http://localhost:3000/?mode=local', false);
  const openLanAppLines = buildWindowsOpenAppSnippet(
    'http://localhost:3000/?mode=local&cloudflare=1',
    true,
  );
  const ensureDepsLines = buildWindowsEnsureDepsSnippet();

  const winMenuBat = [
    '@echo off',
    'chcp 65001 >nul',
    'title Infourqui Mercado - Aplicacion para Windows',
    'cd /d "%~dp0"',
    '',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo ============================================================',
    '  echo   Node.js no esta instalado en esta PC Windows.',
    '  echo ============================================================',
    '  echo.',
    '  where winget >nul 2>nul',
    '  if not errorlevel 1 (',
    '    choice /M "Queres instalar Node.js LTS automaticamente ahora"',
    '    if errorlevel 2 goto :open_nodejs',
    '    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
    '    echo.',
    '    echo Instalacion finalizada. Cerra y volve a abrir InfourquiMercado-Windows.bat.',
    '    pause',
    '    exit /b 0',
    '  )',
    '  :open_nodejs',
    '  echo Abriendo https://nodejs.org para descargar Node.js LTS...',
    '  start "" https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    ...ensureDepsLines,
    '',
    ':menu',
    'cls',
    'echo ============================================================',
    'echo   INFOURQUI MERCADO — MODO WINDOWS (PC LOCAL Y RED LAN)',
    'echo ============================================================',
    'echo.',
    'echo   [1] Iniciar en MODO LOCAL (solo esta PC - localhost:3000)',
    'echo   [2] Iniciar en MODO RED LOCAL LAN (otras PCs y celulares)',
    'echo   [3] Activar cuenta Cloudflare y generar enlace web (Celulares / Internet)',
    'echo   [4] Crear acceso directo en el Escritorio de Windows',
    'echo   [5] Habilitar Firewall de Windows (puerto 3000 para Red LAN)',
    'echo   [6] Salir',
    'echo.',
    'set /p OPT="Elegi una opcion (1-6): "',
    'if "%OPT%"=="1" goto :run_local',
    'if "%OPT%"=="2" goto :run_lan',
    'if "%OPT%"=="3" goto :run_cloudflare',
    'if "%OPT%"=="4" goto :create_shortcut',
    'if "%OPT%"=="5" goto :firewall',
    'if "%OPT%"=="6" exit /b 0',
    'goto :menu',
    '',
    ':run_local',
    'echo.',
    'echo Iniciando Infourqui Mercado en ventana de escritorio (Modo Local)...',
    ...openLocalAppLines,
    'call npm run start:pc-local',
    'pause',
    'goto :menu',
    '',
    ':run_lan',
    'echo.',
    'echo Iniciando Infourqui Mercado en Google Chrome (Modo Red LAN y Celulares)...',
    'echo Se activara la cuenta Cloudflare en Google Chrome para generar y mostrar la direccion web publica.',
    ...openLanAppLines,
    'call npm run start:pc-red',
    'pause',
    'goto :menu',
    '',
    ':run_cloudflare',
    'echo.',
    'echo ============================================================',
    'echo   ACTIVAR CUENTA CLOUDFLARE EN GOOGLE CHROME (RED LOCAL)',
    'echo ============================================================',
    'where cloudflared >nul 2>nul',
    'if errorlevel 1 (',
    '  if not exist "bin\\cloudflared.exe" (',
    '    echo Instalando Cloudflare Tunnel (cloudflared)...',
    '    where winget >nul 2>nul',
    '    if not errorlevel 1 (',
    '      winget install --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements',
    '    )',
    '  )',
    ')',
    'echo Abriendo Infourqui Mercado y activacion Cloudflare en Google Chrome...',
    ...openLanAppLines,
    'call npm run start:pc-red',
    'pause',
    'goto :menu',
    '',
    ':create_shortcut',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Crear-Acceso-Directo-Escritorio.ps1"',
    'pause',
    'goto :menu',
    '',
    ':firewall',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList \'-NoProfile -ExecutionPolicy Bypass -File \\"%~dp0Habilitar-Firewall-Red-LAN.ps1\\"\'"',
    'pause',
    'goto :menu',
    '',
  ].join('\r\n');

  const winLocalBat = [
    '@echo off',
    'chcp 65001 >nul',
    'title Infourqui Mercado - Windows Modo Local (127.0.0.1:3000)',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [ERROR] No se encontro Node.js. Descargalo desde https://nodejs.org (version LTS).',
    '  start "" https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    ...ensureDepsLines,
    'echo Iniciando Infourqui Mercado en Modo Local (solo esta PC)...',
    ...openLocalAppLines,
    'call npm run start:pc-local',
    'pause',
    '',
  ].join('\r\n');

  const winLanBat = [
    '@echo off',
    'chcp 65001 >nul',
    'title Infourqui Mercado - Windows Modo Red Local LAN y Celulares (Cloudflare)',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [ERROR] No se encontro Node.js. Descargalo desde https://nodejs.org (version LTS).',
    '  start "" https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    ...ensureDepsLines,
    'echo Iniciando Infourqui Mercado en Google Chrome (Modo Red Local, Celulares y Cloudflare)...',
    ...openLanAppLines,
    'call npm run start:pc-red',
    'pause',
    '',
  ].join('\r\n');

  const createShortcutPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$targetBat = Join-Path $scriptDir "InfourquiMercado-Windows.bat"',
    '$desktop = [Environment]::GetFolderPath("Desktop")',
    '$shortcutPath = Join-Path $desktop "Infourqui Mercado.lnk"',
    '$wsh = New-Object -ComObject WScript.Shell',
    '$shortcut = $wsh.CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath = $targetBat',
    '$shortcut.WorkingDirectory = $scriptDir',
    '$shortcut.Description = "Infourqui Mercado - E-Commerce PC Local y Red LAN"',
    '$shortcut.Save()',
    'Write-Host "Acceso directo creado en el Escritorio: $shortcutPath" -ForegroundColor Green',
    '',
  ].join('\r\n');

  const firewallPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$ruleName = "Infourqui Mercado Red Local (TCP 3000)"',
    'if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {',
    '  Write-Host "La regla de Firewall ya esta configurada." -ForegroundColor Yellow',
    '} else {',
    '  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow | Out-Null',
    '  Write-Host "Puerto 3000 habilitado correctamente para redes privadas (LAN / Wi-Fi)." -ForegroundColor Green',
    '}',
    'Write-Host "Presiona Enter para cerrar..."',
    'Read-Host',
    '',
  ].join('\r\n');

  const readmeWinTxt = [
    '============================================================',
    '  INFOURQUI MERCADO — VERSION PARA WINDOWS 10 / 11',
    '============================================================',
    '',
    '1. EXTRAE EL ARCHIVO ZIP',
    '   Descomprimi esta carpeta en un lugar fijo de tu PC',
    '   (por ejemplo: C:\\InfourquiMercado).',
    '',
    '2. INICIO RAPIDO EN WINDOWS (DOBLE CLIC)',
    '   - Hace doble clic en "InfourquiMercado-Windows.bat" para abrir el',
    '     menu principal de Windows (instala Node.js y dependencias',
    '     en el primer uso, crea acceso directo en el Escritorio y',
    '     configura el Firewall).',
    '   - O usa los lanzadores directos:',
    '     * "Iniciar-Modo-Local.bat"   -> Solo esta PC (127.0.0.1:3000)',
    '     * "Iniciar-Modo-Red-LAN.bat" -> En Red / Wi-Fi (0.0.0.0:3000)',
    '   La aplicacion se abre automaticamente en modo ventana de',
    '   escritorio (Microsoft Edge / Chrome App) sin barras extra.',
    '',
    '3. MODO LOCAL, RED LAN Y CUENTAS DE USUARIO',
    '   - Al abrir la aplicacion en localhost o desde una IP de tu red',
    '     (ej. http://192.168.x.x:3000), Infourqui Mercado activa',
    '     automaticamente la base de datos Local / Red LAN.',
    '   - Las cuentas funcionan con correo y contrasena locales (sin',
    '     requerir inicio de sesion de Google ni dominios autorizados).',
    '   - Dentro del Panel de control y analiticas, presiona Ctrl + F10',
    '     para ver la pestana "PC Local y Red" (IPs LAN y estado).',
    '   - Desde la pestana "Respaldos" podes hacer backups y restaurar.',
    '',
    '4. ACCESO CON CLOUDFLARE EN GOOGLE CHROME (RED LOCAL Y CELULARES)',
    '   - Al iniciar en Modo Red Local LAN o desde el panel "PC Local y Red",',
    '     Infourqui Mercado abre Google Chrome para habilitar tu cuenta Cloudflare.',
    '   - Una vez habilitada en Google Chrome, la aplicacion inicia el tunel y',
    '     muestra automaticamente la direccion web publica HTTPS generada.',
    '',
    '5. BASE DE DATOS Y COPIAS DE SEGURIDAD',
    '   Tus datos se guardan en: data\\alba-mercado-db.json',
    '   Podes descargar y restaurar respaldos desde el panel.',
    '',
  ].join('\r\n');

  return [
    {
      name: `${zipRootFolder}/InfourquiMercado-Windows.bat`,
      content: Buffer.from(winMenuBat, 'utf8'),
    },
    {
      name: `${zipRootFolder}/Iniciar-Modo-Local.bat`,
      content: Buffer.from(winLocalBat, 'utf8'),
    },
    {
      name: `${zipRootFolder}/Iniciar-Modo-Red-LAN.bat`,
      content: Buffer.from(winLanBat, 'utf8'),
    },
    {
      name: `${zipRootFolder}/Crear-Acceso-Directo-Escritorio.ps1`,
      content: Buffer.from(createShortcutPs1, 'utf8'),
    },
    {
      name: `${zipRootFolder}/Habilitar-Firewall-Red-LAN.ps1`,
      content: Buffer.from(firewallPs1, 'utf8'),
    },
    {
      name: `${zipRootFolder}/LEEME-WINDOWS.txt`,
      content: Buffer.from(readmeWinTxt, 'utf8'),
    },
  ];
}

function createUnixLauncherEntries(zipRootFolder: string): ZipEntry[] {
  const unixLocalSh = [
    '#!/usr/bin/env bash',
    'set -e',
    'cd "$(dirname "$0")"',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "[ERROR] Instala Node.js (v20+) desde https://nodejs.org"',
    '  exit 1',
    'fi',
    'if [ ! -d "node_modules/tsx" ] || [ ! -d "node_modules/@google/genai" ] || ! cmp -s package.json node_modules/.infourqui-pkg.json 2>/dev/null; then',
    '  echo "Instalando/actualizando dependencias..."',
    '  npm install --no-audit --no-fund || npm install --legacy-peer-deps --no-audit --no-fund',
    '  cp -f package.json node_modules/.infourqui-pkg.json 2>/dev/null || true',
    'fi',
    'echo "Iniciando Infourqui Mercado en MODO LOCAL (http://localhost:3000)..."',
    'npm run start:pc-local',
    '',
  ].join('\n');

  const unixLanSh = [
    '#!/usr/bin/env bash',
    'set -e',
    'cd "$(dirname "$0")"',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "[ERROR] Instala Node.js (v20+) desde https://nodejs.org"',
    '  exit 1',
    'fi',
    'if [ ! -d "node_modules/tsx" ] || [ ! -d "node_modules/@google/genai" ] || ! cmp -s package.json node_modules/.infourqui-pkg.json 2>/dev/null; then',
    '  echo "Instalando/actualizando dependencias..."',
    '  npm install --no-audit --no-fund || npm install --legacy-peer-deps --no-audit --no-fund',
    '  cp -f package.json node_modules/.infourqui-pkg.json 2>/dev/null || true',
    'fi',
    'echo "Iniciando Infourqui Mercado en MODO RED LOCAL LAN (puerto 3000)..."',
    'npm run start:pc-red',
    '',
  ].join('\n');

  return [
    {
      name: `${zipRootFolder}/iniciar-modo-local.sh`,
      content: Buffer.from(unixLocalSh, 'utf8'),
      unixMode: 0o100755,
    },
    {
      name: `${zipRootFolder}/iniciar-modo-red-lan.sh`,
      content: Buffer.from(unixLanSh, 'utf8'),
      unixMode: 0o100755,
    },
  ];
}

export function buildPcAppBundle(platform: DownloadPlatform = 'windows'): Buffer {
  const zipRootFolder =
    platform === 'windows' ? 'infourqui-mercado-windows' : 'infourqui-mercado-pc';
  const entries: ZipEntry[] = [
    {
      name: `${zipRootFolder}/package.json`,
      content: createStandalonePackageJson(),
    },
  ];

  for (const relFile of ALLOWLISTED_ROOT_FILES) {
    const absPath = path.resolve(ROOT_DIR, relFile);
    if (!absPath.startsWith(ROOT_DIR + path.sep)) continue;
    if (!fs.existsSync(absPath)) continue;
    const stat = fs.lstatSync(absPath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    entries.push({
      name: `${zipRootFolder}/${relFile}`,
      content: fs.readFileSync(absPath),
    });
  }

  for (const dir of ALLOWLISTED_DIRECTORIES) {
    collectSafeDirectoryFiles(zipRootFolder, dir, entries);
  }

  entries.push(...createWindowsLauncherEntries(zipRootFolder));
  if (platform === 'all') {
    entries.push(...createUnixLauncherEntries(zipRootFolder));
  }

  return createZipArchive(entries);
}
