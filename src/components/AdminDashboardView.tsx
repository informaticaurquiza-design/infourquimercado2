import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Copy,
  CreditCard,
  Database,
  Edit3,
  ExternalLink,
  FileCheck2,
  Globe,
  HardDrive,
  Landmark,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Save,
  ScanBarcode,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getDefaultCategoryImage } from '../lib/categoryAssets';
import { getProductGallery } from '../lib/imageTools';
import {
  FREE_SHIPPING_THRESHOLD,
  SELLER_TRIAL_NOTICE,
  STANDARD_SHIPPING_COST,
  formatCurrency,
  formatDateTime,
  formatShortDate,
  getAccountSubscriptionInfo,
  getNextShipmentStatus,
  getShipmentStatusMeta,
} from '../lib/validation';
import {
  adjustProductStock,
  advanceOrderShipmentStatus,
  createOrUpdateProduct,
  deleteProductById,
  saveShippingSettings,
  sendAdminPushNotification,
  updateUserProfile,
} from '../services/dataService';
import {
  CATEGORIES,
  SHIPMENT_PIPELINE,
  type AdminTab,
  type AppUser,
  type CategoryId,
  type DatabaseMode,
  type LocalServerInfo,
  type NotificationType,
  type Order,
  type Product,
  type ShipmentStatus,
  type StoreSettings,
  type SubscriptionPayment,
  type UserProfile,
} from '../types/ecommerce';
import { AdminAccountsPanel } from './AdminAccountsPanel';
import { DatabaseBackupPanel } from './DatabaseBackupPanel';
import { FacebookShareModal } from './FacebookShareModal';
import { LocalDatabasePanel } from './LocalDatabasePanel';
import { ProductImage } from './ProductImage';
import { ProductImagesEditor } from './ProductImagesEditor';
import { SkuBarcodeScannerModal } from './SkuBarcodeScannerModal';
import { SubscriptionPaymentPanel } from './SubscriptionPaymentPanel';

interface AdminDashboardViewProps {
  user: AppUser | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  dbMode: DatabaseMode;
  onChangeDbMode: (mode: DatabaseMode) => void;
  localServerInfo: LocalServerInfo | null;
  onRefreshServerInfo: () => Promise<void>;
  onRefreshLocalData?: () => Promise<void>;
  products: Product[];
  orders: Order[];
  accounts: UserProfile[];
  subscriptionPayments: SubscriptionPayment[];
  shippingSettings: StoreSettings;
  onRequireSignIn: () => void;
  onProfileSaved?: (updates: Partial<UserProfile>) => void;
  onNotifyToast: (msg: string) => void;
}

const DEFAULT_HUB_LOCATIONS: Record<ShipmentStatus, string> = {
  confirmed: 'Plataforma Infourqui Mercado',
  preparing: 'Depósito Central Barracas',
  in_transit: 'Centro de Clasificación Norte — Pacheco',
  out_for_delivery: 'Sucursal de Reparto Local',
  delivered: 'Domicilio del destinatario',
  cancelled: 'Plataforma Infourqui Mercado',
};

function WhatsAppIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.49 0 .15 5.34.15 11.91c0 2.1.55 4.15 1.59 5.95L0 24l6.33-1.66a11.86 11.86 0 0 0 5.73 1.46h.01c6.57 0 11.91-5.34 11.91-11.91 0-3.18-1.24-6.17-3.46-8.41ZM12.07 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.76.99 1-3.66-.24-.38a9.88 9.88 0 0 1-1.51-5.25c0-5.46 4.44-9.9 9.91-9.9 2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.01c0 5.46-4.45 9.88-9.91 9.88Zm5.43-7.41c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35Z" />
    </svg>
  );
}

function FacebookIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07Z" />
    </svg>
  );
}

export function AdminDashboardView({
  user,
  profile,
  isAdmin,
  dbMode,
  onChangeDbMode,
  localServerInfo,
  onRefreshServerInfo,
  onRefreshLocalData,
  products,
  orders,
  accounts,
  subscriptionPayments,
  shippingSettings,
  onRequireSignIn,
  onProfileSaved,
  onNotifyToast,
}: AdminDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>(isAdmin ? 'analytics' : 'inventory');
  const [showLocalDbOption, setShowLocalDbOption] = useState<boolean>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('cloudflare') === '1';
    } catch {
      return false;
    }
  });
  const [invSearch, setInvSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [facebookShareProduct, setFacebookShareProduct] = useState<Product | null>(null);

  const sellerSubInfo = useMemo(() => {
    const effectiveProfile: UserProfile | null = profile
      ? { ...profile, role: isAdmin ? 'admin' : profile.role }
      : isAdmin && user
        ? {
            uid: user.uid,
            displayName: user.displayName || 'Administrador',
            email: user.email || '',
            photoURL: user.photoURL || '',
            phone: '',
            defaultAddress: '',
            defaultCity: '',
            defaultPostalCode: '',
            pushEnabled: false,
            role: 'admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : null;
    return getAccountSubscriptionInfo(effectiveProfile);
  }, [profile, isAdmin, user]);

  const canPublishOrEdit = isAdmin || sellerSubInfo.isActive;

  useEffect(() => {
    if (!isAdmin) {
      setActiveTab((curr) => (curr === 'inventory' || curr === 'subscription' ? curr : 'inventory'));
    }
  }, [isAdmin]);

  // Auto-open "PC Local y Red" tab when in Local / Red Local mode or when Cloudflare is pending/active
  useEffect(() => {
    if (!isAdmin) return;
    let cfParam = false;
    try {
      cfParam = new URLSearchParams(window.location.search).get('cloudflare') === '1';
    } catch {
      cfParam = false;
    }
    if (
      cfParam ||
      dbMode === 'local' ||
      Boolean(localServerInfo?.cloudflarePublicUrl) ||
      localServerInfo?.cloudflarePhase === 'awaiting_browser_auth' ||
      localServerInfo?.cloudflarePhase === 'starting' ||
      (localServerInfo?.standalonePcMode && localServerInfo.networkMode === 'lan')
    ) {
      setShowLocalDbOption(true);
      if (cfParam) {
        setActiveTab('database');
      }
    }
  }, [
    isAdmin,
    dbMode,
    localServerInfo?.cloudflarePublicUrl,
    localServerInfo?.cloudflarePhase,
    localServerInfo?.standalonePcMode,
    localServerInfo?.networkMode,
  ]);

  // Unlock/hide "PC Local y Red" option via Ctrl + F10
  useEffect(() => {
    if (!user || !isAdmin) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'F10') {
        e.preventDefault();
        setShowLocalDbOption((prev) => {
          const next = !prev;
          if (next) {
            setActiveTab('database');
            onNotifyToast('Opción PC Local y Red activada (Ctrl + F10).');
          } else {
            setActiveTab((curr) => (curr === 'database' ? 'analytics' : curr));
            onNotifyToast('Opción PC Local y Red ocultada.');
          }
          return next;
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user, isAdmin, onNotifyToast]);

  // Shipping settings form state
  const [freeThresholdInput, setFreeThresholdInput] = useState(
    String(shippingSettings.freeShippingThreshold),
  );
  const [shippingCostInput, setShippingCostInput] = useState(
    String(shippingSettings.standardShippingCost),
  );
  const [shippingFormError, setShippingFormError] = useState('');
  const [savingShipping, setSavingShipping] = useState(false);

  useEffect(() => {
    setFreeThresholdInput(String(shippingSettings.freeShippingThreshold));
    setShippingCostInput(String(shippingSettings.standardShippingCost));
  }, [shippingSettings.freeShippingThreshold, shippingSettings.standardShippingCost]);

  // Product modal state
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formSku, setFormSku] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<CategoryId>('tecnologia');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formComparePrice, setFormComparePrice] = useState('');
  const [formStock, setFormStock] = useState('10');
  const [formMinStock, setFormMinStock] = useState('4');
  const [formSpecs, setFormSpecs] = useState('');
  const [formImages, setFormImages] = useState<string[]>([]);
  const [formFeatured, setFormFeatured] = useState(false);
  const [formFreeShipping, setFormFreeShipping] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);
  const [skuScannerOpen, setSkuScannerOpen] = useState(false);

  // Required bank details pre-check modal before publishing a new product
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [bankCbuInput, setBankCbuInput] = useState('');
  const [bankAliasInput, setBankAliasInput] = useState('');
  const [bankHolderInput, setBankHolderInput] = useState('');
  const [bankFormError, setBankFormError] = useState('');
  const [savingBankDetails, setSavingBankDetails] = useState(false);
  const [savedBankOverride, setSavedBankOverride] = useState<{
    uid: string;
    bankCbuCvu: string;
    bankAlias: string;
    bankAccountHolder: string;
  } | null>(null);

  const effectiveBankCbu = (
    (savedBankOverride && savedBankOverride.uid === user?.uid
      ? savedBankOverride.bankCbuCvu
      : profile?.bankCbuCvu) || ''
  ).trim();
  const effectiveBankAlias = (
    (savedBankOverride && savedBankOverride.uid === user?.uid
      ? savedBankOverride.bankAlias
      : profile?.bankAlias) || ''
  ).trim();
  const effectiveBankHolder = (
    (savedBankOverride && savedBankOverride.uid === user?.uid
      ? savedBankOverride.bankAccountHolder
      : profile?.bankAccountHolder) || ''
  ).trim();

  const hasBankDetailsLoaded = Boolean(
    effectiveBankCbu && effectiveBankAlias && effectiveBankHolder,
  );

  // Order advance modal state
  const [advancingOrder, setAdvancingOrder] = useState<Order | null>(null);
  const [advanceTargetStatus, setAdvanceTargetStatus] = useState<ShipmentStatus>('preparing');
  const [advanceLocation, setAdvanceLocation] = useState('');
  const [advanceNote, setAdvanceNote] = useState('');
  const [advancingBusy, setAdvancingBusy] = useState(false);

  // Transfer receipt viewer modal state
  const [viewingReceiptOrder, setViewingReceiptOrder] = useState<Order | null>(null);

  // Push broadcast state
  const [pushTarget, setPushTarget] = useState('all');
  const [pushType, setPushType] = useState<NotificationType>('promo');
  const [pushTitle, setPushTitle] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [sendingPush, setSendingPush] = useState(false);

  // Analytics derivations
  const analytics = useMemo(() => {
    const validOrders = orders.filter((o) => o.shipmentStatus !== 'cancelled');
    const ordersRevenue = validOrders.reduce((s, o) => s + o.total, 0);
    const avgTicket = validOrders.length > 0 ? Math.round(ordersRevenue / validOrders.length) : 0;
    const lowStockProducts = products.filter((p) => p.stock <= p.minStockThreshold);
    const totalInventoryUnits = products.reduce((s, p) => s + p.stock, 0);
    const totalInventoryValue = products.reduce((s, p) => s + p.stock * p.price, 0);
    const deliveredCount = orders.filter((o) => o.shipmentStatus === 'delivered').length;
    const inTransitCount = orders.filter(
      (o) =>
        o.shipmentStatus === 'preparing' ||
        o.shipmentStatus === 'in_transit' ||
        o.shipmentStatus === 'out_for_delivery',
    ).length;

    // Revenue & units by rubro (combining catalog soldCount + live orders)
    const byCategory = CATEGORIES.map((cat) => {
      const catProducts = products.filter((p) => p.category === cat.id);
      const estimatedCatalogRevenue = catProducts.reduce(
        (sum, p) => sum + p.soldCount * p.price,
        0,
      );
      const stockUnits = catProducts.reduce((sum, p) => sum + p.stock, 0);
      const soldUnits = catProducts.reduce((sum, p) => sum + p.soldCount, 0);
      return {
        rubro: cat.shortLabel,
        ingresos: Math.round(estimatedCatalogRevenue / 1000), // in thousands ARS for crisp axis
        ingresosRaw: estimatedCatalogRevenue,
        vendidos: soldUnits,
        stock: stockUnits,
      };
    });

    // Order timeline series for AreaChart
    const orderSeries = [...validOrders]
      .reverse()
      .map((ord, idx) => ({
        label: ord.orderNumber.slice(-4),
        fecha: formatShortDate(ord.createdAt),
        monto: Math.round(ord.total / 1000),
        totalRaw: ord.total,
        unidades: ord.items.reduce((s, i) => s + i.quantity, 0),
        index: idx + 1,
      }));

    // Payment method mix
    const paymentCounts = {
      card: validOrders.filter((o) => o.paymentMethod === 'card').length,
      wallet: validOrders.filter((o) => o.paymentMethod === 'wallet').length,
      transfer: validOrders.filter((o) => o.paymentMethod === 'transfer').length,
      cash: validOrders.filter((o) => o.paymentMethod === 'cash').length,
    };

    const topProducts = [...products]
      .sort((a, b) => b.soldCount * b.price - a.soldCount * a.price)
      .slice(0, 6);

    return {
      ordersRevenue,
      validOrdersCount: validOrders.length,
      avgTicket,
      lowStockProducts,
      totalInventoryUnits,
      totalInventoryValue,
      deliveredCount,
      inTransitCount,
      byCategory,
      orderSeries,
      paymentCounts,
      topProducts,
    };
  }, [products, orders]);

  const managedProducts = useMemo(() => {
    if (isAdmin) return products;
    if (!user) return [];
    return products.filter((p) => p.sellerId === user.uid);
  }, [isAdmin, products, user]);

  const managedLowStockCount = useMemo(
    () => managedProducts.filter((p) => p.stock <= p.minStockThreshold).length,
    [managedProducts],
  );

  const pendingReceiptsCount = useMemo(
    () => subscriptionPayments.filter((p) => p.status === 'pending').length,
    [subscriptionPayments],
  );

  const filteredInventory = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return managedProducts.filter((p) => {
      if (onlyLowStock && p.stock > p.minStockThreshold) return false;
      if (q) {
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.categoryLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [managedProducts, invSearch, onlyLowStock]);

  const { shareBaseUrl, isPrivateOriginWithoutPublicUrl } = useMemo(() => {
    if (typeof window === 'undefined') {
      return { shareBaseUrl: '', isPrivateOriginWithoutPublicUrl: false };
    }
    const host = window.location.hostname.toLowerCase();
    const isPrivateHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (isPrivateHost && localServerInfo?.cloudflarePublicUrl) {
      return {
        shareBaseUrl: localServerInfo.cloudflarePublicUrl.replace(/\/+$/, ''),
        isPrivateOriginWithoutPublicUrl: false,
      };
    }
    return {
      shareBaseUrl: window.location.origin.replace(/\/+$/, ''),
      isPrivateOriginWithoutPublicUrl: isPrivateHost,
    };
  }, [localServerInfo?.cloudflarePublicUrl]);

  function buildProductShareLinks(product: Product) {
    const productUrl = shareBaseUrl
      ? `${shareBaseUrl}/share/producto/${encodeURIComponent(product.id)}`
      : '';
    const snippet = product.description.trim();
    const shortDesc =
      snippet.length > 110 ? `${snippet.slice(0, 107).trimEnd()}...` : snippet;
    const priceLine = `Precio: ${formatCurrency(product.price)}${
      product.freeShipping ? ' · Envío gratis' : ''
    }`;
    const stockLine =
      product.stock > 0
        ? `Stock disponible (${product.stock} u.)`
        : 'Consultar disponibilidad';

    const whatsappLines = [
      `*${product.name}*`,
      priceLine,
      `${product.categoryLabel} · SKU ${product.sku}`,
      stockLine,
      ...(shortDesc ? [shortDesc] : []),
      ...(productUrl ? ['', `Ver en Infourqui Mercado: ${productUrl}`] : []),
    ];
    const facebookQuote = [
      product.name,
      priceLine,
      shortDesc || `${product.categoryLabel} · SKU ${product.sku}`,
      'Disponible en Infourqui Mercado',
    ]
      .filter(Boolean)
      .join(' — ');

    return {
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(whatsappLines.join('\n'))}`,
      facebookUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        productUrl || shareBaseUrl,
      )}&quote=${encodeURIComponent(facebookQuote)}`,
    };
  }

  const inventoryListShareLinks = useMemo(() => {
    const maxListed = 15;
    const sample = filteredInventory.slice(0, maxListed);
    const header = invSearch.trim()
      ? `*Catálogo Infourqui Mercado — "${invSearch.trim()}"*`
      : onlyLowStock
        ? '*Últimas unidades en Infourqui Mercado*'
        : '*Catálogo disponible en Infourqui Mercado*';
    const itemLines = sample.map(
      (p) =>
        `• ${p.name} — ${formatCurrency(p.price)}${p.freeShipping ? ' (Envío gratis)' : ''}`,
    );
    const remaining = filteredInventory.length - sample.length;
    const whatsappLines = [
      header,
      '',
      ...itemLines,
      ...(remaining > 0 ? [`...y ${remaining} producto(s) más.`] : []),
      ...(shareBaseUrl ? ['', `Ver tienda completa: ${shareBaseUrl}`] : []),
    ];
    const facebookQuote = `Mirá nuestro catálogo de ${filteredInventory.length} producto${
      filteredInventory.length === 1 ? '' : 's'
    } en Infourqui Mercado.${
      sample.length > 0
        ? ` Destacados: ${sample
            .slice(0, 3)
            .map((p) => `${p.name} (${formatCurrency(p.price)})`)
            .join(', ')}.`
        : ''
    }`;

    return {
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(whatsappLines.join('\n'))}`,
      facebookUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        shareBaseUrl,
      )}&quote=${encodeURIComponent(facebookQuote)}`,
    };
  }, [filteredInventory, invSearch, onlyLowStock, shareBaseUrl]);

  function launchNewProductModal() {
    setEditingProductId(null);
    setFormSku(`ALB-NEW-${Math.floor(100 + Math.random() * 900)}`);
    setFormName('');
    setFormCategory('tecnologia');
    setFormDescription('');
    setFormPrice('');
    setFormComparePrice('');
    setFormStock('12');
    setFormMinStock('4');
    setFormSpecs('Garantía oficial 12 meses\nDespacho prioritario');
    setFormImages([]);
    setFormFeatured(false);
    setFormFreeShipping(false);
    setFormActive(true);
    setFormError('');
    setProductModalOpen(true);
  }

  function openNewProductModal() {
    if (!hasBankDetailsLoaded) {
      setBankCbuInput(effectiveBankCbu);
      setBankAliasInput(effectiveBankAlias);
      setBankHolderInput(effectiveBankHolder);
      setBankFormError('');
      setBankModalOpen(true);
      return;
    }
    launchNewProductModal();
  }

  async function handleSaveBankDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBankFormError('');

    const cleanCbu = bankCbuInput.trim();
    const cleanAlias = bankAliasInput.trim();
    const cleanHolder = bankHolderInput.trim();

    if (cleanCbu.length < 6) {
      setBankFormError('Ingresá tu CBU o CVU para continuar.');
      return;
    }
    if (cleanAlias.length < 3) {
      setBankFormError('Ingresá tu Alias bancario para continuar.');
      return;
    }
    if (cleanHolder.length < 2) {
      setBankFormError('Ingresá el Nombre de la cuenta para continuar.');
      return;
    }

    setSavingBankDetails(true);
    try {
      await updateUserProfile(user.uid, {
        bankCbuCvu: cleanCbu,
        bankAlias: cleanAlias,
        bankAccountHolder: cleanHolder,
      });
      setSavedBankOverride({
        uid: user.uid,
        bankCbuCvu: cleanCbu,
        bankAlias: cleanAlias,
        bankAccountHolder: cleanHolder,
      });
      onProfileSaved?.({
        bankCbuCvu: cleanCbu,
        bankAlias: cleanAlias,
        bankAccountHolder: cleanHolder,
      });
      onNotifyToast('Datos bancarios guardados. Ya podés cargar tu nuevo producto.');
      setBankModalOpen(false);
      launchNewProductModal();
    } catch (err) {
      setBankFormError(
        err instanceof Error ? err.message : 'No pudimos guardar tus datos bancarios.',
      );
    } finally {
      setSavingBankDetails(false);
    }
  }

  function openEditProductModal(product: Product) {
    setEditingProductId(product.id);
    setFormSku(product.sku);
    setFormName(product.name);
    setFormCategory(product.category);
    setFormDescription(product.description);
    setFormPrice(String(product.price));
    setFormComparePrice(product.compareAtPrice ? String(product.compareAtPrice) : '');
    setFormStock(String(product.stock));
    setFormMinStock(String(product.minStockThreshold));
    setFormSpecs(product.specs.join('\n'));
    setFormImages(getProductGallery(product));
    setFormFeatured(product.featured);
    setFormFreeShipping(Boolean(product.freeShipping));
    setFormActive(product.active);
    setFormError('');
    setProductModalOpen(true);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSavingProduct(true);
    try {
      const priceNum = Number(formPrice);
      const compareNum = formComparePrice.trim() ? Number(formComparePrice) : undefined;
      const stockNum = Number(formStock);
      const minStockNum = Number(formMinStock);
      const specsList = formSpecs
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const finalImages =
        formImages.length > 0 ? formImages : [getDefaultCategoryImage(formCategory)];

      const existingEditingProduct = editingProductId
        ? products.find((p) => p.id === editingProductId)
        : undefined;
      const isOwnProduct =
        !editingProductId ||
        !existingEditingProduct?.sellerId ||
        existingEditingProduct.sellerId === user?.uid;

      const sellerBankFields =
        user && isOwnProduct
          ? {
              sellerBankAlias: effectiveBankAlias,
              sellerBankCbuCvu: effectiveBankCbu,
              sellerBankAccountHolder:
                effectiveBankHolder ||
                profile?.businessName?.trim() ||
                profile?.displayName?.trim() ||
                user.displayName?.trim() ||
                '',
            }
          : existingEditingProduct
            ? {
                sellerBankAlias: existingEditingProduct.sellerBankAlias || '',
                sellerBankCbuCvu: existingEditingProduct.sellerBankCbuCvu || '',
                sellerBankAccountHolder: existingEditingProduct.sellerBankAccountHolder || '',
              }
            : {};

      await createOrUpdateProduct({
        id: editingProductId || undefined,
        sku: formSku,
        name: formName,
        category: formCategory,
        description: formDescription,
        price: priceNum,
        compareAtPrice: compareNum,
        stock: stockNum,
        minStockThreshold: minStockNum,
        imageUrl: finalImages[0],
        images: finalImages,
        specs: specsList,
        featured: isAdmin ? formFeatured : false,
        freeShipping: formFreeShipping,
        active: canPublishOrEdit ? formActive : false,
        ...sellerBankFields,
        ...(!editingProductId && user
          ? {
              sellerId: user.uid,
              sellerName:
                profile?.businessName ||
                profile?.displayName ||
                user.displayName ||
                user.email ||
                'Vendedor',
            }
          : {}),
      });

      onNotifyToast(
        editingProductId
          ? 'Producto actualizado en tiempo real.'
          : 'Nuevo producto publicado en el catálogo.',
      );
      setProductModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No pudimos guardar el producto.');
    } finally {
      setSavingProduct(false);
    }
  }

  function openAdvanceModal(order: Order) {
    const next = getNextShipmentStatus(order.shipmentStatus) || 'delivered';
    setAdvancingOrder(order);
    setAdvanceTargetStatus(next);
    setAdvanceLocation(DEFAULT_HUB_LOCATIONS[next]);
    const meta = SHIPMENT_PIPELINE.find((s) => s.status === next);
    setAdvanceNote(meta?.description || 'Actualización logística del envío.');
  }

  async function handleConfirmAdvance(e: React.FormEvent) {
    e.preventDefault();
    if (!advancingOrder) return;
    setAdvancingBusy(true);
    try {
      await advanceOrderShipmentStatus(
        advancingOrder,
        advanceTargetStatus,
        advanceLocation,
        advanceNote,
      );
      onNotifyToast(
        `Pedido ${advancingOrder.orderNumber} actualizado y notificación push enviada al cliente.`,
      );
      setAdvancingOrder(null);
    } finally {
      setAdvancingBusy(false);
    }
  }

  async function handleSendPush(e: React.FormEvent) {
    e.preventDefault();
    if (pushTitle.trim().length < 2 || pushMessage.trim().length < 2) return;
    setSendingPush(true);
    try {
      await sendAdminPushNotification({
        targetUserId: pushTarget.trim() || 'all',
        title: pushTitle,
        message: pushMessage,
        type: pushType,
      });
      setPushTitle('');
      setPushMessage('');
      onNotifyToast('Notificación push enviada en tiempo real.');
    } finally {
      setSendingPush(false);
    }
  }

  async function handleSaveShippingSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setShippingFormError('');

    const parsedThreshold = Number(freeThresholdInput);
    const parsedCost = Number(shippingCostInput);

    if (freeThresholdInput.trim() === '' || !Number.isFinite(parsedThreshold) || parsedThreshold < 0) {
      setShippingFormError('Ingresá un valor numérico válido (mayor o igual a 0) para compras con envío gratis.');
      return;
    }
    if (shippingCostInput.trim() === '' || !Number.isFinite(parsedCost) || parsedCost < 0) {
      setShippingFormError('Ingresá un valor numérico válido (mayor o igual a 0) para el costo de envío.');
      return;
    }

    setSavingShipping(true);
    try {
      await saveShippingSettings(user, {
        freeShippingThreshold: parsedThreshold,
        standardShippingCost: parsedCost,
      });
      onNotifyToast('Tarifas de envío actualizadas en tiempo real para toda la tienda.');
    } catch (err) {
      setShippingFormError(
        err instanceof Error ? err.message : 'No pudimos guardar la configuración de envíos.',
      );
    } finally {
      setSavingShipping(false);
    }
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-zinc-200 rounded-xl p-10">
          <ShieldAlert className="w-10 h-10 text-zinc-400 mx-auto mb-3 stroke-[1.5]" />
          <h1 className="font-display text-xl font-bold text-zinc-950 mb-2">
            Panel de control y analíticas
          </h1>
          <p className="text-sm text-zinc-600 leading-relaxed mb-6">
            Iniciá sesión con tu cuenta para gestionar tus publicaciones de venta, registrar tu pago
            mensual de la aplicación o acceder a las herramientas de administración.
          </p>
          <button
            type="button"
            onClick={onRequireSignIn}
            className="px-5 py-2.5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Admin / Seller Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <p className="text-xs text-zinc-500 mb-1">
            Infourqui Mercado / {isAdmin ? 'Administración' : 'Panel de vendedor'}
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950">
            Panel de control y analíticas
          </h1>
        </div>

        {/* Segmented Sub-Navigation */}
        <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg overflow-x-auto max-w-full">
          {(isAdmin
            ? ([
                { id: 'analytics', label: 'Estadísticas', icon: BarChart3 },
                { id: 'inventory', label: 'Inventario', icon: Package },
                { id: 'orders', label: 'Pedidos y Envíos', icon: Truck },
                { id: 'shipping', label: 'Tarifas de Envío', icon: Settings },
                { id: 'push', label: 'Alertas Push', icon: Bell },
                { id: 'subscription', label: 'Pago Mensual', icon: CreditCard },
                {
                  id: 'accounts',
                  label:
                    pendingReceiptsCount > 0 ? `Cuentas (${pendingReceiptsCount})` : 'Cuentas',
                  icon: Users,
                },
                { id: 'backups', label: 'Respaldos', icon: HardDrive },
                ...(showLocalDbOption
                  ? ([{ id: 'database', label: 'PC Local y Red', icon: Database }] as const)
                  : []),
              ] as const)
            : ([
                { id: 'inventory', label: 'Mis Publicaciones', icon: Package },
                { id: 'subscription', label: 'Pago Mensual', icon: CreditCard },
              ] as const)
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pending Cloudflare Authorization in Google Chrome Banner */}
      {isAdmin &&
        localServerInfo?.cloudflarePhase === 'awaiting_browser_auth' &&
        !localServerInfo?.cloudflarePublicUrl &&
        activeTab !== 'database' && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Globe className="w-4 h-4 text-amber-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                  Habilitación de cuenta Cloudflare en Google Chrome
                </p>
                <p className="text-xs text-amber-800">
                  Completá la autorización en Google Chrome para generar y mostrar la dirección web
                  de Red Local y Celulares.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowLocalDbOption(true);
                setActiveTab('database');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer shrink-0"
            >
              Ver enlace y estado
            </button>
          </div>
        )}

      {/* Live Generated Cloudflare Public URL Banner */}
      {isAdmin && localServerInfo?.cloudflarePublicUrl && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Globe className="w-4 h-4 text-emerald-700 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                Cuenta Cloudflare activada · Dirección web generada (Red Local y Celulares)
              </p>
              <a
                href={localServerInfo.cloudflarePublicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs sm:text-sm font-bold text-blue-700 hover:underline truncate block"
              >
                {localServerInfo.cloudflarePublicUrl}
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(localServerInfo.cloudflarePublicUrl || '');
                onNotifyToast('Dirección web de Cloudflare copiada.');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-emerald-300 hover:border-zinc-950 rounded-lg cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              Copiar enlace
            </button>
            <a
              href={localServerInfo.cloudflarePublicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir web
            </a>
          </div>
        </div>
      )}

      {/* TAB 1: ANALYTICS (Admin only) */}
      {activeTab === 'analytics' && isAdmin && (
        <div className="space-y-8">
          {/* 4-Column Tabular KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <p className="text-xs text-zinc-500">Ingresos por pedidos registrados</p>
              <p className="font-mono text-2xl font-bold text-zinc-950 mt-2 tabular-nums">
                {formatCurrency(analytics.ordersRevenue)}
              </p>
              <p className="text-xs text-zinc-500 mt-1 tabular-nums">
                {analytics.validOrdersCount} pedidos activos · {analytics.deliveredCount} entregados
              </p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <p className="text-xs text-zinc-500">Ticket promedio</p>
              <p className="font-mono text-2xl font-bold text-zinc-950 mt-2 tabular-nums">
                {formatCurrency(analytics.avgTicket)}
              </p>
              <p className="text-xs text-zinc-500 mt-1 tabular-nums">
                {analytics.inTransitCount} envíos actualmente en curso
              </p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <p className="text-xs text-zinc-500">Valor del inventario en depósito</p>
              <p className="font-mono text-2xl font-bold text-zinc-950 mt-2 tabular-nums">
                {formatCurrency(analytics.totalInventoryValue)}
              </p>
              <p className="text-xs text-zinc-500 mt-1 tabular-nums">
                {analytics.totalInventoryUnits} unidades en {products.length} SKUs
              </p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <p className="text-xs text-zinc-500">Alertas de reposición</p>
              <p
                className={`font-mono text-2xl font-bold mt-2 tabular-nums ${
                  analytics.lowStockProducts.length > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {analytics.lowStockProducts.length} SKUs
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {analytics.lowStockProducts.length > 0
                  ? 'Por debajo del umbral mínimo'
                  : 'Stock óptimo en todos los rubros'}
              </p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* BarChart: Revenue by Rubro */}
            <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6">
              <div className="flex items-baseline justify-between mb-5">
                <div>
                  <h2 className="font-display text-base font-bold text-zinc-950">
                    Volumen comercial por rubro
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Facturación acumulada por categoría (en miles de ARS)
                  </p>
                </div>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analytics.byCategory}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                    <XAxis
                      dataKey="rubro"
                      tick={{ fontSize: 12, fill: '#52525B' }}
                      axisLine={{ stroke: '#E4E4E7' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'JetBrains Mono' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}k`}
                    />
                    <Tooltip
                      formatter={(val: unknown) => [
                        formatCurrency(Number(val) * 1000),
                        'Ingresos',
                      ]}
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E4E4E7',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="ingresos" fill="#1D4ED8" radius={[4, 4, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* AreaChart: Live Orders Revenue */}
            <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-6">
              <div className="mb-5">
                <h2 className="font-display text-base font-bold text-zinc-950">
                  Evolución de pedidos recientes
                </h2>
                <p className="text-xs text-zinc-500">
                  Importe por orden confirmada (en miles de ARS)
                </p>
              </div>
              {analytics.orderSeries.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-xs text-zinc-500">
                  Sin pedidos registrados todavía.
                </div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={analytics.orderSeries}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#52525B', fontFamily: 'JetBrains Mono' }}
                        axisLine={{ stroke: '#E4E4E7' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'JetBrains Mono' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}k`}
                      />
                      <Tooltip
                        formatter={(val: unknown) => [
                          formatCurrency(Number(val) * 1000),
                          'Importe',
                        ]}
                        contentStyle={{
                          backgroundColor: '#FFFFFF',
                          borderColor: '#E4E4E7',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="monto"
                        stroke="#09090B"
                        fill="#DBEAFE"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Top Products Table + Payment Methods */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-zinc-950">
                  Productos con mayor facturación
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('inventory')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Gestionar inventario →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                      <th className="py-2.5 px-4">Producto</th>
                      <th className="py-2.5 px-4">Rubro</th>
                      <th className="py-2.5 px-4 text-right">Vendidos</th>
                      <th className="py-2.5 px-4 text-right">Stock</th>
                      <th className="py-2.5 px-4 text-right">Ingresos est.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-xs">
                    {analytics.topProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-50/70">
                        <td className="py-2.5 px-4 max-w-[280px]">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-9 rounded-md overflow-hidden bg-zinc-100 border border-zinc-200 shrink-0">
                              <ProductImage
                                src={p.imageUrl}
                                alt={p.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <span className="font-medium text-zinc-950 truncate">{p.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-500">{p.categoryLabel}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-700">
                          {p.soldCount} u.
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono tabular-nums font-medium ${
                            p.stock <= p.minStockThreshold ? 'text-amber-700' : 'text-zinc-700'
                          }`}
                        >
                          {p.stock} u.
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                          {formatCurrency(p.soldCount * p.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-4 bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
              <div>
                <h2 className="font-display text-sm font-bold text-zinc-950">
                  Medios de pago utilizados
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">Distribución sobre pedidos válidos</p>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Tarjeta de Crédito / Débito', count: analytics.paymentCounts.card },
                  { label: 'Billetera Digital QR', count: analytics.paymentCounts.wallet },
                  { label: 'Transferencia Bancaria', count: analytics.paymentCounts.transfer },
                  { label: 'Efectivo', count: analytics.paymentCounts.cash },
                ].map((entry) => {
                  const pct =
                    analytics.validOrdersCount > 0
                      ? Math.round((entry.count / analytics.validOrdersCount) * 100)
                      : 0;
                  return (
                    <div key={entry.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-700">{entry.label}</span>
                        <span className="font-mono text-zinc-950 tabular-nums">
                          {entry.count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-zinc-950" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {analytics.lowStockProducts.length > 0 && (
                <div className="pt-4 border-t border-zinc-200">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Stock crítico para reponer</span>
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {analytics.lowStockProducts.slice(0, 4).map((item) => (
                      <li key={item.id} className="flex justify-between gap-2 text-zinc-600">
                        <span className="truncate">{item.name}</span>
                        <span className="font-mono font-semibold text-amber-700 shrink-0 tabular-nums">
                          {item.stock} u.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REAL-TIME INVENTORY / SELLER PUBLICATIONS */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {!isAdmin && !sellerSubInfo.isActive && (
            <div className="p-4 sm:p-5 rounded-xl bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-red-950">
                    Publicaciones pausadas — Período gratuito de 30 días vencido
                  </p>
                  <p className="text-red-800 leading-relaxed">{SELLER_TRIAL_NOTICE}</p>
                  <p className="text-red-700">
                    {sellerSubInfo.detailText} Tus publicaciones volverán a estar activas cuando
                    registres tu pago mensual y sea aprobado.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('subscription')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                Ingresar pago mensual ($ 5.000)
              </button>
            </div>
          )}

          {!isAdmin && sellerSubInfo.isActive && (
            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-950">
                <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                <span>
                  <strong>Cuenta activa ({sellerSubInfo.statusLabel}):</strong>{' '}
                  {sellerSubInfo.detailText}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('subscription')}
                className="text-xs font-semibold text-emerald-800 hover:underline whitespace-nowrap cursor-pointer"
              >
                Gestionar pago mensual →
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  placeholder="Filtrar por SKU, nombre o rubro..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyLowStock((v) => !v)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  onlyLowStock
                    ? 'bg-amber-50 border-amber-400 text-amber-800'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:border-zinc-950'
                }`}
              >
                Stock bajo ({managedLowStockCount})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {filteredInventory.length > 0 && (
                <div className="inline-flex items-center gap-1.5">
                  <a
                    href={inventoryListShareLinks.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Compartir listado actual por WhatsApp"
                    aria-label="Compartir listado actual por WhatsApp"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <WhatsAppIcon className="w-3.5 h-3.5" />
                    Compartir listado
                  </a>
                  <a
                    href={inventoryListShareLinks.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Compartir listado actual en Facebook"
                    aria-label="Compartir listado actual en Facebook"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <FacebookIcon className="w-3.5 h-3.5" />
                    Facebook
                  </a>
                </div>
              )}

              <button
                type="button"
                disabled={!canPublishOrEdit}
                onClick={openNewProductModal}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Nuevo producto
              </button>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                    <th className="py-3 px-4">Producto</th>
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4">Rubro</th>
                    <th className="py-3 px-4 text-right">Precio</th>
                    <th className="py-3 px-4 text-center">Control de stock en vivo</th>
                    <th className="py-3 px-4 text-right">Estado</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {filteredInventory.map((product) => {
                    const isOut = product.stock === 0;
                    const isLow = !isOut && product.stock <= product.minStockThreshold;
                    const photoCount = getProductGallery(product).length;
                    const shareLinks = buildProductShareLinks(product);
                    return (
                      <tr key={product.id} className="hover:bg-zinc-50/80">
                        <td className="py-2.5 px-4 max-w-[320px]">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-14 h-11 rounded-md overflow-hidden bg-zinc-100 border border-zinc-200 shrink-0">
                              <ProductImage
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-950 truncate">{product.name}</p>
                              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                                {photoCount} {photoCount === 1 ? 'foto' : 'fotos'}
                                {product.freeShipping && (
                                  <span className="font-medium text-emerald-700">
                                    {' '}
                                    · Envío gratis activado
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-zinc-500 whitespace-nowrap">
                          {product.sku}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-600 whitespace-nowrap">
                          {product.categoryLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-zinc-950 whitespace-nowrap">
                          {formatCurrency(product.price)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              disabled={!canPublishOrEdit || product.stock <= 0}
                              onClick={() => void adjustProductStock(product.id, product.stock - 1)}
                              aria-label="Restar 1 unidad"
                              className="w-7 h-7 inline-flex items-center justify-center rounded border border-zinc-200 bg-white hover:border-zinc-950 disabled:opacity-35 cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span
                              className={`w-10 text-center font-mono text-xs font-semibold tabular-nums ${
                                isOut
                                  ? 'text-red-600'
                                  : isLow
                                    ? 'text-amber-700'
                                    : 'text-zinc-950'
                              }`}
                            >
                              {product.stock}
                            </span>
                            <button
                              type="button"
                              disabled={!canPublishOrEdit}
                              onClick={() => void adjustProductStock(product.id, product.stock + 1)}
                              aria-label="Sumar 1 unidad"
                              className="w-7 h-7 inline-flex items-center justify-center rounded border border-zinc-200 bg-white hover:border-zinc-950 disabled:opacity-35 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={!canPublishOrEdit}
                              onClick={() =>
                                void adjustProductStock(product.id, product.stock + 10)
                              }
                              className="px-2 h-7 text-[11px] font-mono font-medium rounded border border-zinc-200 bg-zinc-50 hover:bg-zinc-200 text-zinc-700 disabled:opacity-35 cursor-pointer"
                            >
                              +10
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              !product.active || !canPublishOrEdit
                                ? 'text-red-600'
                                : isOut
                                  ? 'text-red-600'
                                  : isLow
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                            }`}
                          >
                            {!canPublishOrEdit
                              ? 'Pausado (pago vencido)'
                              : !product.active
                                ? 'Pausado'
                                : isOut
                                  ? 'Agotado'
                                  : isLow
                                    ? 'Stock bajo'
                                    : 'Disponible'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <a
                              href={shareLinks.whatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Compartir ${product.name} por WhatsApp`}
                              aria-label={`Compartir ${product.name} por WhatsApp`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            >
                              <WhatsAppIcon className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => setFacebookShareProduct(product)}
                              title={`Compartir ${product.name} con foto en Facebook`}
                              aria-label={`Compartir ${product.name} con foto en Facebook`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                              <FacebookIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!canPublishOrEdit}
                              onClick={() => openEditProductModal(product)}
                              title={`Editar ${product.name}`}
                              aria-label={`Editar ${product.name}`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-blue-700 hover:bg-zinc-100 disabled:opacity-35 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteProductById(product.id);
                                onNotifyToast(`Producto ${product.sku} eliminado del inventario.`);
                              }}
                              title={`Eliminar ${product.name}`}
                              aria-label={`Eliminar ${product.name}`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-zinc-100 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredInventory.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 px-4 text-center text-xs text-zinc-500">
                        {isAdmin
                          ? 'No hay productos que coincidan con el filtro.'
                          : 'Todavía no publicaste productos de venta. Usá "Nuevo producto" para comenzar.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ORDERS & LOGISTICS */}
      {activeTab === 'orders' && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-bold text-zinc-950">
                Gestión logística y despacho de pedidos ({orders.length})
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tarifa vigente:{' '}
                <span className="font-mono text-zinc-800 tabular-nums">
                  {shippingSettings.freeShippingThreshold === 0
                    ? 'Envío gratis en todas las compras'
                    : `Gratis desde ${formatCurrency(shippingSettings.freeShippingThreshold)} · Estándar ${formatCurrency(shippingSettings.standardShippingCost)}`}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('shipping')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors whitespace-nowrap cursor-pointer shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              Editar tarifas de envío
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              No hay pedidos registrados todavía.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                    <th className="py-3 px-4">Orden / Tracking</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Destino</th>
                    <th className="py-3 px-4">Pago / Comprobante</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4">Estado actual</th>
                    <th className="py-3 px-4 text-right">Siguiente paso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {orders.map((order) => {
                    const meta = getShipmentStatusMeta(order.shipmentStatus);
                    const nextStatus = getNextShipmentStatus(order.shipmentStatus);
                    const nextLabel = nextStatus
                      ? SHIPMENT_PIPELINE.find((s) => s.status === nextStatus)?.shortLabel
                      : null;

                    return (
                      <tr key={order.id} className="hover:bg-zinc-50/80">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="font-mono font-semibold text-zinc-950">
                            {order.orderNumber}
                          </p>
                          <p className="font-mono text-[11px] text-zinc-400">
                            {order.trackingCode}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-zinc-950">{order.customerName}</p>
                          <p className="text-[11px] text-zinc-500">{order.customerEmail}</p>
                        </td>
                        <td className="py-3 px-4 text-zinc-600 max-w-[200px]">
                          {order.deliveryMethod === 'pickup' ||
                          order.carrier === 'Retiro en domicilio' ? (
                            <div>
                              <p className="font-medium text-blue-700">Retiro en domicilio</p>
                              <p className="text-[11px] text-zinc-400">Sin costo de envío</p>
                            </div>
                          ) : (
                            <div className="truncate">
                              <p className="font-medium text-zinc-900 truncate">Envío a domicilio</p>
                              <p className="text-[11px] text-zinc-500 truncate">
                                {order.shippingCity} ({order.shippingPostalCode})
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="font-medium text-zinc-900">
                            {order.paymentMethod === 'cash'
                              ? 'Efectivo'
                              : order.paymentMethod === 'transfer'
                                ? 'Transferencia'
                                : order.paymentBrand}
                          </p>
                          {order.paymentReceipt ? (
                            <button
                              type="button"
                              onClick={() => setViewingReceiptOrder(order)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline mt-0.5 cursor-pointer"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              Ver comprobante
                            </button>
                          ) : (
                            <p className="text-[11px] text-zinc-400">
                              {order.paymentMethod === 'cash'
                                ? 'Pago al recibir'
                                : order.paymentMethod === 'transfer'
                                  ? 'Sin adjunto'
                                  : `···· ${order.paymentLast4}`}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-zinc-950 whitespace-nowrap">
                          {formatCurrency(order.total)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`font-medium ${meta.colorClass}`}>{meta.label}</span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {nextLabel ? (
                            <button
                              type="button"
                              onClick={() => openAdvanceModal(order)}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                            >
                              Pasar a {nextLabel}
                            </button>
                          ) : (
                            <span className="text-zinc-400">Ciclo cerrado</span>
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
      )}

      {/* TAB 4: SHIPPING TARIFF CONFIGURATION */}
      {activeTab === 'shipping' && (() => {
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 sm:p-8">
              <div className="pb-5 mb-6 border-b border-zinc-200">
                <h2 className="font-display text-lg font-bold text-zinc-950">
                  Configuración de envío y bonificación
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  Definí el monto a partir del cual el envío es gratuito y el valor fijo para
                  compras inferiores. Los cambios impactan al instante en el catálogo, carrito y
                  pasarela de pagos.
                </p>
              </div>

              {shippingFormError && (
                <div className="mb-5 p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {shippingFormError}
                </div>
              )}

              <form onSubmit={handleSaveShippingSettings} className="space-y-5">
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
                    <span className="font-mono text-zinc-700">0</span> para bonificar todos los
                    envíos sin mínimo.
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
                    Importe que se sumará automáticamente en el carrito y checkout cuando el pedido
                    sea menor al monto de envío gratis.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-200">
                  <button
                    type="button"
                    onClick={() => {
                      setFreeThresholdInput(String(FREE_SHIPPING_THRESHOLD));
                      setShippingCostInput(String(STANDARD_SHIPPING_COST));
                      setShippingFormError('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restablecer sugeridos
                  </button>

                  <button
                    type="submit"
                    disabled={savingShipping}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    {savingShipping ? 'Guardando...' : 'Guardar configuración'}
                  </button>
                </div>
              </form>
            </div>

            {/* Live Calculation Preview */}
            <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="font-display text-sm font-bold text-zinc-950">
                  Simulación de cobro en checkout
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Así se calculará el envío para tus clientes con los valores ingresados.
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
                  <span className="font-mono tabular-nums">
                    {feeBelow === 0 ? 'Sin cargo' : formatCurrency(feeBelow)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-zinc-950 pt-2 border-t border-zinc-100">
                  <span>Total cliente</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(sampleBelow + feeBelow)}
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-xs border-t border-zinc-200 pt-4">
                <p className="font-semibold text-zinc-800">
                  Caso 2 · Compra mayor o igual a {formatCurrency(previewThreshold)}
                </p>
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal carrito</span>
                  <span className="font-mono tabular-nums">{formatCurrency(sampleAbove)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Costo de envío</span>
                  <span className="font-mono">Sin cargo</span>
                </div>
                <div className="flex justify-between font-semibold text-zinc-950 pt-2 border-t border-zinc-100">
                  <span>Total cliente</span>
                  <span className="font-mono tabular-nums">{formatCurrency(sampleAbove)}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 text-[11px] text-zinc-500 space-y-1">
                <p>
                  Valor activo guardado:{' '}
                  <span className="font-mono text-zinc-800 tabular-nums">
                    Gratis desde {formatCurrency(shippingSettings.freeShippingThreshold)} · Envío{' '}
                    {formatCurrency(shippingSettings.standardShippingCost)}
                  </span>
                </p>
                {shippingSettings.updatedAt && (
                  <p>Última actualización: {formatDateTime(shippingSettings.updatedAt)}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB 5: PUSH BROADCAST COMPOSER */}
      {activeTab === 'push' && (
        <div className="max-w-2xl bg-white border border-zinc-200 rounded-xl p-6 sm:p-8">
          <h2 className="font-display text-lg font-bold text-zinc-950 mb-1">
            Enviar notificación push a clientes
          </h2>
          <p className="text-sm text-zinc-600 mb-6">
            Publicá un aviso en tiempo real que llega inmediatamente al centro de alertas y al
            navegador de los clientes conectados.
          </p>

          <form onSubmit={handleSendPush} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Destinatario</label>
                <select
                  value={pushTarget}
                  onChange={(e) => setPushTarget(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 cursor-pointer"
                >
                  <option value="all">Todos los clientes (difusión general)</option>
                  <option value={user.uid}>Mi cuenta de prueba ({user.email})</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Tipo de aviso</label>
                <select
                  value={pushType}
                  onChange={(e) => setPushType(e.target.value as NotificationType)}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 cursor-pointer"
                >
                  <option value="promo">Promoción / Beneficio</option>
                  <option value="inventory">Reposición de inventario</option>
                  <option value="shipment">Aviso logístico</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Título</label>
              <input
                type="text"
                required
                maxLength={100}
                value={pushTitle}
                onChange={(e) => setPushTitle(e.target.value)}
                placeholder="Ej. Reposición disponible en Auriculares Kova Studio"
                className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Mensaje</label>
              <textarea
                required
                rows={3}
                maxLength={320}
                value={pushMessage}
                onChange={(e) => setPushMessage(e.target.value)}
                placeholder="Escribí el detalle de la novedad o código promocional..."
                className="w-full px-3 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={sendingPush}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {sendingPush ? 'Enviando...' : 'Despachar notificación push'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 6: MONTHLY SUBSCRIPTION PAYMENT (All authenticated users) */}
      {activeTab === 'subscription' && (
        <SubscriptionPaymentPanel
          user={user}
          profile={profile}
          isAdmin={isAdmin}
          payments={subscriptionPayments}
          onNotifyToast={onNotifyToast}
          onPaymentSubmitted={onRefreshLocalData}
        />
      )}

      {/* TAB 7: ADMIN ACCOUNTS DIRECTORY (Admin only) */}
      {activeTab === 'accounts' && isAdmin && (
        <AdminAccountsPanel
          adminUser={user}
          dbMode={dbMode}
          accounts={accounts}
          subscriptionPayments={subscriptionPayments}
          products={products}
          onNotifyToast={onNotifyToast}
          onRefreshLocalData={onRefreshLocalData}
        />
      )}

      {/* TAB 8: DATABASE BACKUP & RESTORE (Local, LAN & Cloud — Admin only) */}
      {activeTab === 'backups' && isAdmin && (
        <DatabaseBackupPanel
          user={user}
          dbMode={dbMode}
          localServerInfo={localServerInfo}
          productsCount={products.length}
          ordersCount={orders.length}
          onRefreshServerInfo={onRefreshServerInfo}
          onNotifyToast={onNotifyToast}
        />
      )}

      {/* TAB 9: LOCAL PC & NETWORK DATABASE (Unlocked with Ctrl + F10 — Admin only) */}
      {activeTab === 'database' && isAdmin && showLocalDbOption && (
        <LocalDatabasePanel
          dbMode={dbMode}
          onChangeDbMode={onChangeDbMode}
          localServerInfo={localServerInfo}
          onRefreshServerInfo={onRefreshServerInfo}
          onOpenBackupsTab={() => setActiveTab('backups')}
          onNotifyToast={onNotifyToast}
        />
      )}

      {/* Modal: Create / Edit Product */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[1px]"
            onClick={() => setProductModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-2xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h2 className="font-display text-base font-bold text-zinc-950">
                {editingProductId ? 'Editar producto' : 'Nuevo producto en catálogo'}
              </h2>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">SKU</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      maxLength={32}
                      value={formSku}
                      onChange={(e) => setFormSku(e.target.value.toUpperCase())}
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                    <button
                      type="button"
                      onClick={() => setSkuScannerOpen(true)}
                      title="Escanear código de barras o QR con cámara"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-800 bg-zinc-50 hover:bg-zinc-100 border border-zinc-300 hover:border-zinc-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ScanBarcode className="w-4 h-4 text-blue-700" />
                      <span>Escanear</span>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Rubro</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as CategoryId)}
                    className="w-full px-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Nombre del producto
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Descripción</label>
                <textarea
                  required
                  rows={3}
                  maxLength={800}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Precio (ARS)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Precio lista
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formComparePrice}
                    onChange={(e) => setFormComparePrice(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Stock</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={formStock}
                    onChange={(e) => setFormStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Alerta mín.</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={formMinStock}
                    onChange={(e) => setFormMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Especificaciones (una por línea)
                </label>
                <textarea
                  rows={3}
                  value={formSpecs}
                  onChange={(e) => setFormSpecs(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
                />
              </div>

              <ProductImagesEditor
                images={formImages}
                onChange={setFormImages}
                defaultCategoryImage={getDefaultCategoryImage(formCategory)}
                productName={formName}
              />

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-xs text-zinc-700 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-emerald-800">
                  <input
                    type="checkbox"
                    checked={formFreeShipping}
                    onChange={(e) => setFormFreeShipping(e.target.checked)}
                    className="accent-emerald-700"
                  />
                  Activar envío gratis
                </label>
                {isAdmin && (
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formFeatured}
                      onChange={(e) => setFormFeatured(e.target.checked)}
                      className="accent-blue-700"
                    />
                    Destacar en catálogo
                  </label>
                )}
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canPublishOrEdit}
                    checked={canPublishOrEdit ? formActive : false}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="accent-blue-700"
                  />
                  Visible para la venta
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="px-5 py-2 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {savingProduct ? 'Guardando...' : 'Guardar producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Camera Barcode / QR Scanner for SKU */}
      <SkuBarcodeScannerModal
        open={skuScannerOpen}
        onClose={() => setSkuScannerOpen(false)}
        onDetected={(scannedSku) => {
          setFormSku(scannedSku);
          onNotifyToast(`SKU escaneado con cámara: ${scannedSku}`);
        }}
      />

      {/* Modal: Required Bank Details Before Creating a New Product */}
      {bankModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[1px]"
            onClick={() => setBankModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div className="flex items-center gap-2">
                <Landmark className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-base font-bold text-zinc-950">
                  Cargar datos bancarios
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setBankModalOpen(false)}
                aria-label="Cerrar formulario de datos bancarios"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBankDetails} className="p-6 space-y-4">
              <p className="text-xs text-zinc-600 leading-relaxed">
                Antes de publicar un nuevo producto, completá tus{' '}
                <span className="font-semibold text-zinc-900">Datos Bancarios</span>. Se mostrarán
                automáticamente en la pasarela de pagos cuando recibas transferencias por tus
                ventas.
              </p>

              {bankFormError && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {bankFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  CBU o CVU
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  maxLength={32}
                  value={bankCbuInput}
                  onChange={(e) => setBankCbuInput(e.target.value)}
                  placeholder="Ej. 0170099940000012345678"
                  className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Alias
                </label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={bankAliasInput}
                  onChange={(e) => setBankAliasInput(e.target.value)}
                  placeholder="Ej. juan.perez.banco"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Nombre de la cuenta
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={bankHolderInput}
                  onChange={(e) => setBankHolderInput(e.target.value)}
                  placeholder="Ej. Juan Pérez — Caja de Ahorro"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => setBankModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingBankDetails}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {savingBankDetails ? 'Guardando...' : 'Guardar y continuar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Advance Shipment Status */}
      {advancingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[1px]"
            onClick={() => setAdvancingOrder(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h2 className="font-display text-base font-bold text-zinc-950">
                Actualizar envío {advancingOrder.orderNumber}
              </h2>
              <button
                type="button"
                onClick={() => setAdvancingOrder(null)}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmAdvance} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Nueva etapa logística
                </label>
                <select
                  value={advanceTargetStatus}
                  onChange={(e) => {
                    const next = e.target.value as ShipmentStatus;
                    setAdvanceTargetStatus(next);
                    setAdvanceLocation(DEFAULT_HUB_LOCATIONS[next]);
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {SHIPMENT_PIPELINE.map((stage) => (
                    <option key={stage.status} value={stage.status}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Ubicación / Sucursal actual
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={advanceLocation}
                  onChange={(e) => setAdvanceLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Nota para el cliente (se enviará por push)
                </label>
                <textarea
                  required
                  rows={2}
                  maxLength={200}
                  value={advanceNote}
                  onChange={(e) => setAdvanceNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAdvancingOrder(null)}
                  className="px-4 py-2 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={advancingBusy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {advancingBusy ? 'Actualizando...' : 'Confirmar y notificar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VIEW TRANSFER RECEIPT & EXTRACTED PAYMENT INFO */}
      {viewingReceiptOrder?.paymentReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-zinc-950/60 backdrop-blur-[1px]"
            onClick={() => setViewingReceiptOrder(null)}
          />
          <div className="relative z-10 w-full max-w-3xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div>
                <h2 className="font-display text-base font-bold text-zinc-950">
                  Comprobante de transferencia — {viewingReceiptOrder.orderNumber}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Cliente: {viewingReceiptOrder.customerName} · Total del pedido:{' '}
                  <span className="font-mono font-semibold text-zinc-900">
                    {formatCurrency(viewingReceiptOrder.total)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingReceiptOrder(null)}
                aria-label="Cerrar comprobante"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 overflow-y-auto">
              <div className="md:col-span-6 p-5 bg-zinc-50 border-b md:border-b-0 md:border-r border-zinc-200 flex items-center justify-center">
                <img
                  src={viewingReceiptOrder.paymentReceipt.imageUrl}
                  alt={`Comprobante ${viewingReceiptOrder.orderNumber}`}
                  className="max-h-[65vh] w-auto object-contain rounded-lg border border-zinc-200 bg-white"
                />
              </div>

              <div className="md:col-span-6 p-6 space-y-4 text-xs">
                <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                  <FileCheck2 className="w-4 h-4" />
                  <span>Información de pago registrada</span>
                </div>

                <dl className="space-y-2.5 divide-y divide-zinc-100">
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Banco / Billetera</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.bankName || 'No detectado'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">N° de operación</dt>
                    <dd className="font-mono font-medium text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.operationNumber || 'No detectado'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Monto detectado</dt>
                    <dd className="font-mono font-semibold text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.amountDetected || 'No detectado'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Titular / Pagador</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.payerName || 'No detectado'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Fecha de transferencia</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.transferDate || 'No detectada'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Cuenta destino / Alias</dt>
                    <dd className="font-medium text-zinc-950 text-right">
                      {viewingReceiptOrder.paymentReceipt.destinationAccount || 'No detectada'}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Archivo cargado</dt>
                    <dd className="text-zinc-700 text-right truncate max-w-[180px]">
                      {viewingReceiptOrder.paymentReceipt.fileName}
                    </dd>
                  </div>
                  <div className="pt-2 flex justify-between gap-3">
                    <dt className="text-zinc-500">Subido el</dt>
                    <dd className="font-mono text-zinc-700 text-right">
                      {formatDateTime(viewingReceiptOrder.paymentReceipt.uploadedAt)}
                    </dd>
                  </div>
                </dl>

                {viewingReceiptOrder.paymentReceipt.summary && (
                  <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <p className="text-[11px] font-semibold text-zinc-600 mb-1">
                      Resumen de lectura
                    </p>
                    <p className="text-zinc-700 leading-relaxed">
                      {viewingReceiptOrder.paymentReceipt.summary}
                    </p>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setViewingReceiptOrder(null)}
                    className="px-4 py-2 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <FacebookShareModal
        product={facebookShareProduct}
        shareBaseUrl={shareBaseUrl}
        isPrivateOriginWithoutPublicUrl={isPrivateOriginWithoutPublicUrl}
        onClose={() => setFacebookShareProduct(null)}
        onNotifyToast={onNotifyToast}
      />
    </div>
  );
}
