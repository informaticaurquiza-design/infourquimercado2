import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDefaultCategoryImage } from './src/lib/categoryAssets.ts';
import { MAX_PRODUCT_IMAGES, getProductGallery } from './src/lib/imageTools.ts';
import { CATEGORY_SLUG_PATTERN, clampString, formatCurrency } from './src/lib/validation.ts';
import { CATEGORY_MAP, type CategoryId } from './src/types/ecommerce.ts';

const PORT = Number(process.env.PORT) || 3000;
const BIND_HOST = '0.0.0.0';

interface FirebasePublicConfig {
  apiKey: string;
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedFirebaseConfig: FirebasePublicConfig | null | undefined;
function getFirebasePublicConfig(): FirebasePublicConfig | null {
  if (cachedFirebaseConfig !== undefined) return cachedFirebaseConfig;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) {
      cachedFirebaseConfig = null;
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
      apiKey?: string;
      projectId?: string;
      firestoreDatabaseId?: string;
    };
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    const firestoreDatabaseId =
      typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
        ? parsed.firestoreDatabaseId.trim()
        : '(default)';
    cachedFirebaseConfig = { apiKey, projectId, firestoreDatabaseId };
    return cachedFirebaseConfig;
  } catch {
    cachedFirebaseConfig = null;
    return null;
  }
}

async function verifyFirebaseUserToken(idToken: string): Promise<boolean> {
  const apiKey = getFirebasePublicConfig()?.apiKey;
  if (!apiKey || !idToken) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const account = data.users?.[0];
    return Boolean(account?.localId && account.emailVerified === true);
  } catch {
    return false;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// --- API: Transfer Receipt OCR / Payment Info Extraction (Authenticated Firebase Users) ---

app.post('/api/receipts/parse', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Iniciá sesión para leer comprobantes de transferencia.' });
    return;
  }

  const authorizedUser = await verifyFirebaseUserToken(token);
  if (!authorizedUser) {
    res.status(401).json({ error: 'Sesión inválida o expirada. Volvé a iniciar sesión.' });
    return;
  }

  const imageDataUrl =
    typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl.trim() : '';
  const dataUrlMatch = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    imageDataUrl,
  );
  if (!dataUrlMatch || imageDataUrl.length > 250000) {
    res.status(400).json({
      error: 'Subí una imagen válida (JPG, PNG o WebP) del comprobante de transferencia.',
    });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error:
        'La lectura automática de comprobantes no está configurada en este servidor. Podés completar los datos manualmente y guardar igual el comprobante.',
    });
    return;
  }

  const [, mimeType, base64Data] = dataUrlMatch;

  try {
    const { GoogleGenAI, Type } = await import('@google/genai');
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: 'Analizá esta imagen de un comprobante de transferencia bancaria o billetera virtual (en español/Argentina u otro país) y extraé con precisión los datos de pago visibles. Si un campo no aparece claramente legible en la imagen, devolvé una cadena vacía "". No inventes datos que no estén en el comprobante. Para summary, redactá un resumen breve en español (máximo 180 caracteres) indicando si el comprobante parece válido y el estado de la transferencia.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            operationNumber: {
              type: Type.STRING,
              description: 'Número de operación, referencia, COELSA ID o código de comprobante',
            },
            bankName: {
              type: Type.STRING,
              description:
                'Banco o billetera virtual emisora (ej. Mercado Pago, Banco Galicia, Brubank, Ualá)',
            },
            amountDetected: {
              type: Type.STRING,
              description: 'Monto transferido tal como figura en el comprobante (ej. $ 45.900,00)',
            },
            payerName: {
              type: Type.STRING,
              description: 'Nombre y apellido o razón social de quien realiza el pago',
            },
            transferDate: {
              type: Type.STRING,
              description: 'Fecha y hora de la transferencia si figura',
            },
            destinationAccount: {
              type: Type.STRING,
              description: 'Destinatario, alias, CBU o CVU destino',
            },
            summary: {
              type: Type.STRING,
              description: 'Resumen breve en español de la lectura del comprobante',
            },
          },
          required: [
            'operationNumber',
            'bankName',
            'amountDetected',
            'payerName',
            'transferDate',
            'destinationAccount',
            'summary',
          ],
        },
      },
    });

    const rawText = response.text?.trim() || '';
    if (!rawText) {
      res.status(502).json({
        error:
          'No pudimos interpretar texto legible en la imagen. Verificá que la foto sea nítida.',
      });
      return;
    }

    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    res.json({
      receiptInfo: {
        operationNumber: clampString(String(parsed.operationNumber || ''), 80),
        bankName: clampString(String(parsed.bankName || ''), 80),
        amountDetected: clampString(String(parsed.amountDetected || ''), 40),
        payerName: clampString(String(parsed.payerName || ''), 100),
        transferDate: clampString(String(parsed.transferDate || ''), 60),
        destinationAccount: clampString(String(parsed.destinationAccount || ''), 100),
        summary: clampString(String(parsed.summary || ''), 240),
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    console.error('[receipts/parse] Error al leer comprobante:', detail);
    res.status(502).json({
      error:
        'No pudimos leer automáticamente el comprobante en este momento. El archivo sigue adjunto y podés completar los campos manualmente.',
    });
  }
});

// --- Social Share Card (OpenGraph + Product Photo) reading directly from Firebase Firestore ---

interface PublicShareProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: CategoryId;
  categoryLabel: string;
  price: number;
  stock: number;
  freeShipping: boolean;
  imageUrl: string;
  images: string[];
  updatedAt: string;
}

const VALID_SHARE_PRODUCT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const SAFE_HOST_HEADER_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const SOCIAL_CRAWLER_UA_RE =
  /facebookexternalhit|facebot|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|pinterest|embedly/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^fc00:|^fd[0-9a-f]{2}:|^fe80:/i.test(host)
  );
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (!parsed.hostname || isPrivateHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function resolveSharePublicOrigin(req: Request): string {
  const rawForwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const rawHost = rawForwardedHost || String(req.headers.host || '').trim();
  const safeHost = SAFE_HOST_HEADER_RE.test(rawHost) ? rawHost : '';
  const hostnameOnly = safeHost.split(':')[0] || '';

  if (safeHost) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto =
      forwardedProto === 'https' || forwardedProto === 'http'
        ? forwardedProto
        : hostnameOnly && !isPrivateHostname(hostnameOnly)
          ? 'https'
          : req.protocol === 'https'
            ? 'https'
            : 'http';
    return `${proto}://${safeHost}`;
  }

  const envAppUrl = (process.env.APP_URL || '').trim();
  if (envAppUrl && isSafePublicHttpUrl(envAppUrl)) {
    return envAppUrl.replace(/\/+$/, '');
  }

  return `http://localhost:${PORT}`;
}

function resolveSafeStaticImagePath(relPath: string): { filePath: string; mimeType: string } | null {
  const cleanPath = relPath.split('?')[0].split('#')[0].trim();
  if (!cleanPath.startsWith('/') || cleanPath.includes('\0')) return null;

  const trimmedRel = cleanPath.replace(/^\/+/, '');
  const rootDir = process.cwd();
  const allowedBases = [
    path.resolve(rootDir, 'src', 'assets', 'images'),
    path.resolve(rootDir, 'public'),
    path.resolve(rootDir, 'dist'),
  ];

  const candidatePaths = [
    path.resolve(rootDir, trimmedRel),
    path.resolve(rootDir, 'public', trimmedRel),
    path.resolve(rootDir, 'dist', trimmedRel),
  ];

  for (const candidate of candidatePaths) {
    const isAllowed = allowedBases.some((base) => candidate.startsWith(base + path.sep));
    if (!isAllowed) continue;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;

    const ext = path.extname(candidate).toLowerCase();
    const mimeType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : '';
    if (!mimeType) continue;
    return { filePath: candidate, mimeType };
  }

  return null;
}

function decodeBase64ProductImage(
  dataUrl: string,
): { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; buffer: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1] as 'image/jpeg' | 'image/png' | 'image/webp';
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function readFirestoreString(fields: Record<string, unknown>, key: string): string {
  const f = fields[key] as { stringValue?: string } | undefined;
  return typeof f?.stringValue === 'string' ? f.stringValue : '';
}

function readFirestoreNumber(fields: Record<string, unknown>, key: string): number {
  const f = fields[key] as { integerValue?: string; doubleValue?: number } | undefined;
  if (typeof f?.doubleValue === 'number' && Number.isFinite(f.doubleValue)) return f.doubleValue;
  if (typeof f?.integerValue === 'string') {
    const parsed = Number(f.integerValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readFirestoreBool(fields: Record<string, unknown>, key: string): boolean {
  const f = fields[key] as { booleanValue?: boolean } | undefined;
  return f?.booleanValue === true;
}

function readFirestoreStringArray(fields: Record<string, unknown>, key: string): string[] {
  const f = fields[key] as
    | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
    | undefined;
  const vals = f?.arrayValue?.values;
  if (!Array.isArray(vals)) return [];
  return vals
    .map((v) => (typeof v?.stringValue === 'string' ? v.stringValue.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_PRODUCT_IMAGES);
}

async function findPublicShareProductById(productId: string): Promise<PublicShareProduct | null> {
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) return null;

  const fb = getFirebasePublicConfig();
  if (!fb?.projectId || !fb.firestoreDatabaseId) return null;

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      fb.projectId,
    )}/databases/${encodeURIComponent(
      fb.firestoreDatabaseId,
    )}/documents/products/${encodeURIComponent(productId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const doc = (await response.json()) as { fields?: Record<string, unknown> };
      const fields = doc.fields;
      if (!fields || typeof fields !== 'object') return null;
      if (fields.active && !readFirestoreBool(fields, 'active')) return null;

      const rawCategory = readFirestoreString(fields, 'category').trim().toLowerCase();
      const category = (
        CATEGORY_SLUG_PATTERN.test(rawCategory) ? rawCategory : 'tecnologia'
      ) as CategoryId;
      const imageUrl = readFirestoreString(fields, 'imageUrl');
      const images = readFirestoreStringArray(fields, 'images');
      const gallery = getProductGallery({ imageUrl, images });

      return {
        id: productId,
        sku: readFirestoreString(fields, 'sku'),
        name: readFirestoreString(fields, 'name') || 'Producto Infourqui Mercado',
        description: readFirestoreString(fields, 'description'),
        category,
        categoryLabel:
          readFirestoreString(fields, 'categoryLabel') ||
          CATEGORY_MAP[category]?.label ||
          'Catálogo',
        price: readFirestoreNumber(fields, 'price'),
        stock: readFirestoreNumber(fields, 'stock'),
        freeShipping: readFirestoreBool(fields, 'freeShipping'),
        imageUrl: gallery[0] || getDefaultCategoryImage(category),
        images: gallery.length > 0 ? gallery : [getDefaultCategoryImage(category)],
        updatedAt: readFirestoreString(fields, 'updatedAt'),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

app.get('/share/producto/:id/imagen', async (req: Request, res: Response) => {
  const productId = String(req.params.id || '').trim();
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) {
    res.status(400).send('Identificador de producto inválido.');
    return;
  }

  const product = await findPublicShareProductById(productId);
  const rawIdx = Number.parseInt(String(req.query.foto ?? req.query.index ?? '0'), 10);
  const photoIndex = Number.isFinite(rawIdx)
    ? Math.max(0, Math.min(MAX_PRODUCT_IMAGES - 1, rawIdx))
    : 0;

  const fallbackRel = getDefaultCategoryImage(product?.category || 'tecnologia');
  const selectedSrc =
    (product && (product.images[photoIndex] || product.imageUrl)) || fallbackRel;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (selectedSrc.startsWith('data:image/')) {
    const decoded = decodeBase64ProductImage(selectedSrc);
    if (decoded) {
      res.setHeader('Content-Type', decoded.mimeType);
      res.send(decoded.buffer);
      return;
    }
  }

  if (selectedSrc.startsWith('/')) {
    const safeFile = resolveSafeStaticImagePath(selectedSrc);
    if (safeFile) {
      res.setHeader('Content-Type', safeFile.mimeType);
      res.sendFile(safeFile.filePath);
      return;
    }
  }

  if (isSafePublicHttpUrl(selectedSrc)) {
    res.redirect(302, selectedSrc);
    return;
  }

  const fallbackFile = resolveSafeStaticImagePath(fallbackRel);
  if (fallbackFile) {
    res.setHeader('Content-Type', fallbackFile.mimeType);
    res.sendFile(fallbackFile.filePath);
    return;
  }

  res.status(404).send('Imagen no disponible.');
});

app.get('/share/producto/:id', async (req: Request, res: Response) => {
  const productId = String(req.params.id || '').trim();
  if (!VALID_SHARE_PRODUCT_ID_RE.test(productId)) {
    res.redirect(302, '/');
    return;
  }

  const rawIdx = Number.parseInt(String(req.query.foto ?? '0'), 10);
  const photoIndex = Number.isFinite(rawIdx)
    ? Math.max(0, Math.min(MAX_PRODUCT_IMAGES - 1, rawIdx))
    : 0;

  const publicOrigin = resolveSharePublicOrigin(req);
  const product = await findPublicShareProductById(productId);
  const destinationUrl = `${publicOrigin}/?producto=${encodeURIComponent(productId)}`;

  if (!product) {
    res.redirect(302, destinationUrl);
    return;
  }

  const clampedIndex = Math.min(photoIndex, Math.max(0, product.images.length - 1));
  const selectedPhoto = product.images[clampedIndex] || product.imageUrl;
  const photoFingerprint = crypto
    .createHash('sha1')
    .update(`${product.updatedAt}|${clampedIndex}|${selectedPhoto.slice(0, 128)}`)
    .digest('hex')
    .slice(0, 10);

  const sharePageUrl = `${publicOrigin}/share/producto/${encodeURIComponent(
    product.id,
  )}?foto=${clampedIndex}`;
  const ogImageUrl = `${publicOrigin}/share/producto/${encodeURIComponent(
    product.id,
  )}/imagen?foto=${clampedIndex}&v=${photoFingerprint}`;

  const titleText = `${product.name} — ${formatCurrency(product.price)} | Infourqui Mercado`;
  const shortDesc = product.description.trim();
  const descriptionParts = [
    shortDesc.length > 140 ? `${shortDesc.slice(0, 137).trimEnd()}...` : shortDesc,
    product.freeShipping ? 'Envío gratis' : '',
    product.stock > 0 ? 'Stock disponible' : 'Consultar stock',
    `SKU ${product.sku}`,
  ].filter(Boolean);
  const descriptionText =
    descriptionParts.join(' · ') || 'Comprá online en Infourqui Mercado.';

  const userAgent = String(req.headers['user-agent'] || '');
  const isSocialCrawler = SOCIAL_CRAWLER_UA_RE.test(userAgent);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    category: product.categoryLabel,
    description: descriptionText,
    image: [ogImageUrl],
    offers: {
      '@type': 'Offer',
      priceCurrency: 'ARS',
      price: String(product.price),
      availability:
        product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: destinationUrl,
    },
  };

  const redirectMeta = isSocialCrawler
    ? ''
    : `<meta http-equiv="refresh" content="0;url=${escapeHtml(destinationUrl)}" />`;

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(titleText)}</title>
    <meta name="description" content="${escapeHtml(descriptionText)}" />
    <link rel="canonical" href="${escapeHtml(sharePageUrl)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="Infourqui Mercado" />
    <meta property="og:locale" content="es_AR" />
    <meta property="og:title" content="${escapeHtml(titleText)}" />
    <meta property="og:description" content="${escapeHtml(descriptionText)}" />
    <meta property="og:url" content="${escapeHtml(sharePageUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    ${ogImageUrl.startsWith('https://') ? `<meta property="og:image:secure_url" content="${escapeHtml(ogImageUrl)}" />` : ''}
    <meta property="og:image:alt" content="${escapeHtml(product.name)}" />
    <meta property="product:price:amount" content="${escapeHtml(String(product.price))}" />
    <meta property="product:price:currency" content="ARS" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(titleText)}" />
    <meta name="twitter:description" content="${escapeHtml(descriptionText)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    ${redirectMeta}
    <script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#fafafa;color:#09090b;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
    <main style="max-width:420px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;text-align:center;">
      <img src="${escapeHtml(ogImageUrl)}" alt="${escapeHtml(product.name)}" style="width:100%;max-height:280px;object-fit:cover;display:block;background:#f4f4f5;" />
      <div style="padding:20px;">
        <p style="margin:0 0 6px;font-size:12px;color:#71717a;">Infourqui Mercado</p>
        <h1 style="margin:0 0 8px;font-size:18px;line-height:1.3;">${escapeHtml(product.name)}</h1>
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1d4ed8;">${escapeHtml(formatCurrency(product.price))}</p>
        <a href="${escapeHtml(destinationUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Ver artículo en la tienda</a>
      </div>
    </main>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).send(html);
});

// --- Frontend Serving (Vite Middleware in Dev / Dist in Prod) ---

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Aplicación no compilada. Ejecutá npm run build.');
      }
    });
  }

  app.listen(PORT, BIND_HOST, () => {
    const fb = getFirebasePublicConfig();
    console.log(
      `Infourqui Mercado running on http://localhost:${PORT} (Firebase Firestore: ${fb?.firestoreDatabaseId || 'configured'})`,
    );
  });
}

void startServer();
