import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Bell, X } from 'lucide-react';
import { AccountModal } from './components/AccountModal';
import { AdminDashboardView } from './components/AdminDashboardView';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { NotificationsView } from './components/NotificationsView';
import { ShipmentTrackingView } from './components/ShipmentTrackingView';
import { StorefrontView } from './components/StorefrontView';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from './lib/firebase';
import {
  getPushPermission,
  requestPushPermission,
  sendBrowserPush,
  type PushPermissionState,
} from './lib/pushNotifications';
import {
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_COST,
  getAccountSubscriptionInfo,
} from './lib/validation';
import {
  registerLocalProfileSyncCallback,
  setActiveDatabaseMode,
  updateUserProfile,
} from './services/dataService';
import {
  checkIsAdmin,
  ensureUserProfile,
  seedInitialStoreData,
  updateUserProfile as firestoreUpdateUserProfile,
} from './services/firestoreService';
import {
  fetchLocalBootstrap,
  fetchLocalServerInfo,
  loginLocalAccount,
  logoutLocalAccount,
  registerLocalCustomer,
  setLocalAuthToken,
  setupLocalAdmin,
} from './services/localApiService';
import type {
  ActiveView,
  AppNotification,
  AppUser,
  CartItem,
  CategoryId,
  DatabaseMode,
  LocalServerInfo,
  Order,
  Product,
  StoreSettings,
  SubscriptionPayment,
  UserProfile,
} from './types/ecommerce';

const DB_MODE_STORAGE_KEY = 'alba_db_mode';

function isLocalOrLanHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.trycloudflare.com') ||
    host.endsWith('.app.github.dev') ||
    host.endsWith('.githubpreview.dev')
  ) {
    return true;
  }
  if (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)
  ) {
    return true;
  }
  if (!host.includes('.')) {
    return true;
  }
  return false;
}

function isFirebaseUnauthorizedDomainError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeErr = err as { code?: unknown; message?: unknown };
  const code = typeof maybeErr.code === 'string' ? maybeErr.code : '';
  const msg = typeof maybeErr.message === 'string' ? maybeErr.message : '';
  return code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain');
}

function readInitialDbMode(): DatabaseMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode')?.toLowerCase();
    if (urlMode === 'local' || urlMode === 'lan') {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
      setActiveDatabaseMode('local');
      return 'local';
    }
    if (urlMode === 'cloud') {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'cloud');
      setActiveDatabaseMode('cloud');
      return 'cloud';
    }

    if (isLocalOrLanHostname(window.location.hostname)) {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
      setActiveDatabaseMode('local');
      return 'local';
    }

    const saved = window.localStorage.getItem(DB_MODE_STORAGE_KEY);
    if (saved === 'local' || saved === 'cloud') {
      setActiveDatabaseMode(saved);
      return saved;
    }
  } catch {
    // ignore storage/URL errors
  }
  setActiveDatabaseMode('cloud');
  return 'cloud';
}

function getMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (
    typeof ts === 'object' &&
    ts !== null &&
    'toMillis' in ts &&
    typeof (ts as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function toAppUserFromFirebase(u: User | null): AppUser | null {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
  };
}

function AppContent() {
  const [activeView, setActiveView] = useState<ActiveView>('catalog');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Database Mode State ('cloud' Firebase vs 'local' PC/LAN Server)
  const [dbMode, setDbMode] = useState<DatabaseMode>(() => readInitialDbMode());
  const [localServerInfo, setLocalServerInfo] = useState<LocalServerInfo | null>(null);

  // Cloud (Firebase) Auth & Data State
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [cloudAuthReady, setCloudAuthReady] = useState(false);
  const [cloudIsAdmin, setCloudIsAdmin] = useState(false);
  const [cloudProfile, setCloudProfile] = useState<UserProfile | null>(null);
  const [firestoreProducts, setFirestoreProducts] = useState<Product[]>([]);
  const [cloudSellerOwnProducts, setCloudSellerOwnProducts] = useState<Product[]>([]);
  const [cloudProductsLoading, setCloudProductsLoading] = useState(true);
  const [cloudOrders, setCloudOrders] = useState<Order[]>([]);
  const [cloudAccounts, setCloudAccounts] = useState<UserProfile[]>([]);
  const [cloudSubscriptionPayments, setCloudSubscriptionPayments] = useState<SubscriptionPayment[]>(
    [],
  );
  const [cloudPersonalNotifications, setCloudPersonalNotifications] = useState<AppNotification[]>([]);
  const [cloudBroadcastNotifications, setCloudBroadcastNotifications] = useState<AppNotification[]>(
    [],
  );
  const [cloudShippingSettings, setCloudShippingSettings] = useState<StoreSettings>({
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
    standardShippingCost: STANDARD_SHIPPING_COST,
  });

  // Local / LAN PC Database Auth & Data State
  const [localUser, setLocalUser] = useState<AppUser | null>(null);
  const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
  const [localIsAdmin, setLocalIsAdmin] = useState(false);
  const [localProducts, setLocalProducts] = useState<Product[]>([]);
  const [localProductsLoading, setLocalProductsLoading] = useState(true);
  const [localOrders, setLocalOrders] = useState<Order[]>([]);
  const [localAccounts, setLocalAccounts] = useState<UserProfile[]>([]);
  const [localSubscriptionPayments, setLocalSubscriptionPayments] = useState<SubscriptionPayment[]>(
    [],
  );
  const [localNotifications, setLocalNotifications] = useState<AppNotification[]>([]);
  const [localShippingSettings, setLocalShippingSettings] = useState<StoreSettings>({
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
    standardShippingCost: STANDARD_SHIPPING_COST,
  });

  // Cart & Checkout State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);

  // Push & Toast State
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(() =>
    getPushPermission(),
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const seenNotifIds = useRef<Set<string>>(new Set());
  const initialNotifsLoaded = useRef(false);
  const seenLocalNotifIds = useRef<Set<string>>(new Set());
  const initialLocalNotifsLoaded = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3600);
  }, []);

  const syncCartWithLiveProducts = useCallback((liveProducts: Product[]) => {
    setCart((prev) =>
      prev
        .map((item) => {
          const live = liveProducts.find((p) => p.id === item.productId);
          if (!live) return item;
          return {
            ...item,
            price: live.price,
            maxStock: live.stock,
            freeShipping: Boolean(live.freeShipping),
            quantity: Math.min(item.quantity, Math.max(0, live.stock)),
            sellerId: live.sellerId,
            sellerName: live.sellerName,
            sellerBankAlias: live.sellerBankAlias,
            sellerBankCbuCvu: live.sellerBankCbuCvu,
            sellerBankAccountHolder: live.sellerBankAccountHolder,
          };
        })
        .filter((item) => item.quantity > 0),
    );
  }, []);

  // Keep activeDatabaseMode in sync with state
  useEffect(() => {
    setActiveDatabaseMode(dbMode);
  }, [dbMode]);

  // Register local profile sync callback for AccountModal updates
  useEffect(() => {
    registerLocalProfileSyncCallback(({ profile, user }) => {
      setLocalProfile(profile);
      setLocalUser(user);
    });
    return () => registerLocalProfileSyncCallback(null);
  }, []);

  // Track whether user manually changed DB mode in this session
  const userChangedDbModeRef = useRef(false);

  // Detect PC Local / LAN backend availability
  const refreshLocalServerInfo = useCallback(async () => {
    const info = await fetchLocalServerInfo();
    setLocalServerInfo(info);
    if (!info && dbMode === 'local') {
      setActiveDatabaseMode('cloud');
      setDbMode('cloud');
      try {
        window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'cloud');
      } catch {
        // ignore storage errors
      }
      showToast('El servidor PC Local no respondió; se restauró el modo Nube (Firebase).');
      return;
    }
    if (info?.available && info.standalonePcMode && !userChangedDbModeRef.current && dbMode !== 'local') {
      setActiveDatabaseMode('local');
      setDbMode('local');
      try {
        window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
      } catch {
        // ignore storage errors
      }
    }
  }, [dbMode, showToast]);

  useEffect(() => {
    void refreshLocalServerInfo();
  }, [refreshLocalServerInfo]);

  // Load local database snapshot & sync notifications/cart
  const loadLocalData = useCallback(async () => {
    try {
      const payload = await fetchLocalBootstrap();
      const sortedOrders = [...payload.orders].sort(
        (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
      );
      const sortedNotifs = [...payload.notifications].sort(
        (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
      );
      const sortedSubPayments = [...(payload.subscriptionPayments || [])].sort(
        (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
      );

      setLocalProducts(payload.products);
      setLocalProductsLoading(false);
      setLocalOrders(sortedOrders);
      setLocalAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setLocalSubscriptionPayments(sortedSubPayments);
      setLocalShippingSettings(payload.shippingSettings);
      setLocalIsAdmin(payload.isAdmin);

      if (payload.profile) {
        setLocalProfile(payload.profile);
        setLocalUser({
          uid: payload.profile.uid,
          email: payload.profile.email || null,
          displayName: payload.profile.displayName || null,
          photoURL: payload.profile.photoURL || null,
          emailVerified: true,
        });
      } else {
        setLocalProfile(null);
        setLocalUser(null);
        setLocalAuthToken(null);
      }

      if (payload.profile) {
        const personal = sortedNotifs.filter((n) => n.userId === payload.profile?.uid);
        if (initialLocalNotifsLoaded.current) {
          for (const notif of personal) {
            if (!seenLocalNotifIds.current.has(notif.id) && !notif.read) {
              seenLocalNotifIds.current.add(notif.id);
              sendBrowserPush(notif.title, notif.message, notif.id);
              showToast(notif.title);
            }
          }
        } else {
          personal.forEach((n) => seenLocalNotifIds.current.add(n.id));
          initialLocalNotifsLoaded.current = true;
        }
      }
      setLocalNotifications(sortedNotifs);
      syncCartWithLiveProducts(payload.products);
    } catch {
      setLocalProductsLoading(false);
    }
  }, [showToast, syncCartWithLiveProducts]);

  // Real-time SSE subscription for PC Local / Red Local (LAN) mode
  useEffect(() => {
    if (dbMode !== 'local') return;

    setLocalProductsLoading(true);
    void loadLocalData();
    void refreshLocalServerInfo();

    const eventSource = new EventSource('/api/local/events');
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: string };
        if (parsed.type === 'connected') return;
      } catch {
        // ignore parse errors
      }
      void loadLocalData();
      void refreshLocalServerInfo();
    };

    return () => {
      eventSource.close();
    };
  }, [dbMode, loadLocalData, refreshLocalServerInfo]);

  // Reset local notification tracking when switching local users
  useEffect(() => {
    initialLocalNotifsLoaded.current = false;
    seenLocalNotifIds.current.clear();
  }, [localUser?.uid]);

  const cloudProducts = useMemo(() => {
    if (cloudIsAdmin || cloudSellerOwnProducts.length === 0) return firestoreProducts;
    const byId = new Map<string, Product>();
    for (const p of firestoreProducts) byId.set(p.id, p);
    for (const p of cloudSellerOwnProducts) byId.set(p.id, p);
    return Array.from(byId.values());
  }, [cloudIsAdmin, firestoreProducts, cloudSellerOwnProducts]);

  // 1. Firebase Auth Subscription & Admin Seeding (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud') return;

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setCloudUser(nextUser);
      if (!nextUser) {
        setCloudIsAdmin(false);
        setCloudProfile(null);
        setCloudOrders([]);
        setCloudSellerOwnProducts([]);
        setCloudAccounts([]);
        setCloudSubscriptionPayments([]);
        setCloudPersonalNotifications([]);
        setCloudBroadcastNotifications([]);
        initialNotifsLoaded.current = false;
        seenNotifIds.current.clear();
        setCloudAuthReady(true);
        return;
      }

      try {
        const [adminFlag, userProfile] = await Promise.all([
          checkIsAdmin(nextUser),
          ensureUserProfile(nextUser),
        ]);
        setCloudIsAdmin(adminFlag);
        setCloudProfile(userProfile);

        if (adminFlag) {
          const seeded = await seedInitialStoreData(nextUser);
          if (seeded) {
            showToast('Catálogo inicial, inventario y pedidos sincronizados en tiempo real.');
          }
        }
      } catch (err) {
        console.error('Auth profile sync failed:', err);
      } finally {
        setCloudAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, [dbMode, showToast]);

  // 2. Real-time Products Listener (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady) return;
    const productsQuery = cloudIsAdmin
      ? query(collection(db, 'products'))
      : query(collection(db, 'products'), where('active', '==', true));

    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Product, 'id'>),
        }));
        setFirestoreProducts(list);
        setCloudProductsLoading(false);
        syncCartWithLiveProducts(list);
      },
      (error) => {
        setCloudProductsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudIsAdmin, syncCartWithLiveProducts]);

  // 2b. Real-time Shipping Settings Listener (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud') return;
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'shipping'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<StoreSettings>;
          setCloudShippingSettings({
            freeShippingThreshold:
              typeof data.freeShippingThreshold === 'number'
                ? data.freeShippingThreshold
                : FREE_SHIPPING_THRESHOLD,
            standardShippingCost:
              typeof data.standardShippingCost === 'number'
                ? data.standardShippingCost
                : STANDARD_SHIPPING_COST,
            updatedBy: data.updatedBy,
            updatedAt: data.updatedAt,
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/shipping');
      },
    );
    return () => unsubscribe();
  }, [dbMode]);

  // 2c. Real-time User Profile Listener (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudUser) return;
    const unsubscribe = onSnapshot(
      doc(db, 'users', cloudUser.uid),
      (snap) => {
        if (snap.exists()) {
          setCloudProfile(snap.data() as UserProfile);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${cloudUser.uid}`);
      },
    );
    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudUser]);

  // 3. Real-time Orders Listener (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudUser) return;
    const ordersQuery = cloudIsAdmin
      ? query(collection(db, 'orders'))
      : query(collection(db, 'orders'), where('userId', '==', cloudUser.uid));

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Order, 'id'>),
          }))
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
        setCloudOrders(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      },
    );

    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudUser, cloudIsAdmin]);

  // 4. Real-time Push Notifications Listeners (Cloud Mode only)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudUser) return;

    const personalQ = query(
      collection(db, 'notifications'),
      where('userId', '==', cloudUser.uid),
    );
    const broadcastQ = query(collection(db, 'notifications'), where('userId', '==', 'all'));

    const unsubPersonal = onSnapshot(
      personalQ,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AppNotification, 'id'>),
        }));

        if (initialNotifsLoaded.current) {
          for (const notif of list) {
            if (!seenNotifIds.current.has(notif.id) && !notif.read) {
              seenNotifIds.current.add(notif.id);
              sendBrowserPush(notif.title, notif.message, notif.id);
              showToast(`${notif.title}`);
            }
          }
        } else {
          list.forEach((n) => seenNotifIds.current.add(n.id));
          initialNotifsLoaded.current = true;
        }
        setCloudPersonalNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      },
    );

    const unsubBroadcast = onSnapshot(
      broadcastQ,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AppNotification, 'id'>),
        }));
        setCloudBroadcastNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      },
    );

    return () => {
      unsubPersonal();
      unsubBroadcast();
    };
  }, [dbMode, cloudAuthReady, cloudUser, showToast]);

  // 4b. Real-time Seller Own Products Listener (Cloud Mode non-admin sellers)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudUser || cloudIsAdmin) {
      setCloudSellerOwnProducts([]);
      return;
    }
    const ownProductsQ = query(
      collection(db, 'products'),
      where('sellerId', '==', cloudUser.uid),
    );
    const unsubscribe = onSnapshot(
      ownProductsQ,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Product, 'id'>),
        }));
        setCloudSellerOwnProducts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );
    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudUser, cloudIsAdmin]);

  // 4c. Real-time Subscription Payments Listener (Cloud Mode)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudUser) {
      setCloudSubscriptionPayments([]);
      return;
    }
    const subPaymentsQ = cloudIsAdmin
      ? query(collection(db, 'subscriptionPayments'))
      : query(collection(db, 'subscriptionPayments'), where('userId', '==', cloudUser.uid));

    const unsubscribe = onSnapshot(
      subPaymentsQ,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SubscriptionPayment, 'id'>),
          }))
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
        setCloudSubscriptionPayments(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'subscriptionPayments');
      },
    );
    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudUser, cloudIsAdmin]);

  // 4d. Real-time Accounts Directory Listener (Cloud Mode Admin only)
  useEffect(() => {
    if (dbMode !== 'cloud' || !cloudAuthReady || !cloudIsAdmin) {
      setCloudAccounts([]);
      return;
    }
    const unsubscribe = onSnapshot(
      query(collection(db, 'users')),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          ...(d.data() as UserProfile),
          uid: d.id,
        }));
        setCloudAccounts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      },
    );
    return () => unsubscribe();
  }, [dbMode, cloudAuthReady, cloudIsAdmin]);

  const cloudAllNotifications = useMemo(() => {
    const merged = [...cloudPersonalNotifications, ...cloudBroadcastNotifications];
    const uniqueMap = new Map<string, AppNotification>();
    for (const item of merged) {
      uniqueMap.set(item.id, item);
    }
    return Array.from(uniqueMap.values()).sort(
      (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
    );
  }, [cloudPersonalNotifications, cloudBroadcastNotifications]);

  // Unified active state based on current dbMode
  const activeUser: AppUser | null = useMemo(
    () => (dbMode === 'local' ? localUser : toAppUserFromFirebase(cloudUser)),
    [dbMode, localUser, cloudUser],
  );
  const activeProfile = dbMode === 'local' ? localProfile : cloudProfile;
  const activeIsAdmin = dbMode === 'local' ? localIsAdmin : cloudIsAdmin;
  const activeProducts = dbMode === 'local' ? localProducts : cloudProducts;
  const activeProductsLoading = dbMode === 'local' ? localProductsLoading : cloudProductsLoading;
  const activeOrders = dbMode === 'local' ? localOrders : cloudOrders;
  const activeAccounts = dbMode === 'local' ? localAccounts : cloudAccounts;
  const activeSubscriptionPayments =
    dbMode === 'local' ? localSubscriptionPayments : cloudSubscriptionPayments;
  const activeNotifications = dbMode === 'local' ? localNotifications : cloudAllNotifications;
  const activeShippingSettings =
    dbMode === 'local' ? localShippingSettings : cloudShippingSettings;

  // Storefront catalog hides paused products and products of expired/inactive sellers
  const storefrontProducts = useMemo(() => {
    const accountById = new Map(activeAccounts.map((a) => [a.uid, a]));
    const currentSellerInactive =
      !activeIsAdmin &&
      Boolean(activeUser) &&
      Boolean(activeProfile) &&
      !getAccountSubscriptionInfo(activeProfile).isActive;

    return activeProducts.filter((p) => {
      if (!p.active) return false;
      if (p.sellerId) {
        if (currentSellerInactive && activeUser && p.sellerId === activeUser.uid) {
          return false;
        }
        const ownerAccount = accountById.get(p.sellerId);
        if (ownerAccount && !getAccountSubscriptionInfo(ownerAccount).isActive) {
          return false;
        }
      }
      return true;
    });
  }, [activeProducts, activeAccounts, activeIsAdmin, activeUser, activeProfile]);

  const unreadCount = useMemo(() => {
    if (dbMode === 'local') {
      if (!localUser) return 0;
      return localNotifications.filter((n) => n.userId === localUser.uid && !n.read).length;
    }
    return cloudPersonalNotifications.filter((n) => !n.read).length;
  }, [dbMode, localUser, localNotifications, cloudPersonalNotifications]);

  // Mode Switch Handler
  async function handleChangeDbMode(nextMode: DatabaseMode) {
    if (nextMode === dbMode) return;
    userChangedDbModeRef.current = true;
    if (nextMode === 'local') {
      const info = localServerInfo?.available ? localServerInfo : await fetchLocalServerInfo();
      if (!info?.available) {
        showToast('El servidor PC Local no está activo en este momento.');
        return;
      }
      setLocalServerInfo(info);
    }

    setActiveDatabaseMode(nextMode);
    setDbMode(nextMode);
    setTrackedOrderId(null);
    try {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, nextMode);
    } catch {
      // ignore storage errors
    }

    showToast(
      nextMode === 'local'
        ? 'Conectado a base de datos PC Local / Red (LAN).'
        : 'Conectado a base de datos en la Nube (Firebase).',
    );
  }

  // Auth Handlers
  async function handleSignInGoogle(optionalSignupData?: {
    isRegister?: boolean;
    displayName?: string;
    businessName?: string;
    phone?: string;
    bankCbuCvu?: string;
    bankAlias?: string;
    bankAccountHolder?: string;
  }): Promise<{ switchedToLocal?: boolean; unauthorizedDomain?: string }> {
    let credential;
    try {
      credential = await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (isFirebaseUnauthorizedDomainError(err)) {
        const info = localServerInfo?.available ? localServerInfo : await fetchLocalServerInfo();
        if (info?.available) {
          setLocalServerInfo(info);
          setActiveDatabaseMode('local');
          setDbMode('local');
          setTrackedOrderId(null);
          try {
            window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
          } catch {
            // ignore storage errors
          }
          showToast('Usá la opción de Cuenta local para ingresar desde esta red.');
          return { switchedToLocal: true };
        }
        return { unauthorizedDomain: window.location.hostname };
      }
      throw err;
    }

    // Google Sign-In succeeded: activate Cloud mode seamlessly
    userChangedDbModeRef.current = true;
    setActiveDatabaseMode('cloud');
    setDbMode('cloud');
    setTrackedOrderId(null);
    try {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'cloud');
    } catch {
      // ignore storage errors
    }

    const cleanProfileUpdates = {
      ...(optionalSignupData?.displayName?.trim()
        ? { displayName: optionalSignupData.displayName.trim() }
        : {}),
      ...(optionalSignupData?.businessName?.trim()
        ? { businessName: optionalSignupData.businessName.trim() }
        : {}),
      ...(optionalSignupData?.phone?.trim() ? { phone: optionalSignupData.phone.trim() } : {}),
      ...(optionalSignupData?.bankCbuCvu?.trim()
        ? { bankCbuCvu: optionalSignupData.bankCbuCvu.trim() }
        : {}),
      ...(optionalSignupData?.bankAlias?.trim()
        ? { bankAlias: optionalSignupData.bankAlias.trim() }
        : {}),
      ...(optionalSignupData?.bankAccountHolder?.trim()
        ? { bankAccountHolder: optionalSignupData.bankAccountHolder.trim() }
        : {}),
    };

    if (credential.user) {
      setCloudUser(credential.user);
      const [adminFlag, ensured] = await Promise.all([
        checkIsAdmin(credential.user),
        ensureUserProfile(credential.user),
      ]);
      setCloudIsAdmin(adminFlag);
      if (Object.keys(cleanProfileUpdates).length > 0) {
        await firestoreUpdateUserProfile(credential.user.uid, cleanProfileUpdates);
        setCloudProfile({ ...ensured, ...cleanProfileUpdates });
      } else {
        setCloudProfile(ensured);
      }
      setCloudAuthReady(true);
    }

    showToast(
      optionalSignupData?.isRegister
        ? 'Cuenta creada con Google e iniciada correctamente.'
        : 'Sesión con Google iniciada de forma segura.',
    );
    return {};
  }

  async function handleSetupLocalAdmin(input: {
    email: string;
    displayName: string;
    businessName?: string;
    password: string;
  }) {
    const res = await setupLocalAdmin(input);
    userChangedDbModeRef.current = true;
    setActiveDatabaseMode('local');
    setDbMode('local');
    setTrackedOrderId(null);
    try {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
    } catch {
      // ignore storage errors
    }
    setLocalUser(res.user);
    setLocalProfile(res.profile);
    setLocalIsAdmin(res.isAdmin);
    await Promise.all([loadLocalData(), refreshLocalServerInfo()]);
    showToast('Cuenta administradora local creada y sesión iniciada.');
  }

  async function handleLoginLocal(input: { email: string; password: string }) {
    const res = await loginLocalAccount(input);
    userChangedDbModeRef.current = true;
    setActiveDatabaseMode('local');
    setDbMode('local');
    setTrackedOrderId(null);
    try {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
    } catch {
      // ignore storage errors
    }
    setLocalUser(res.user);
    setLocalProfile(res.profile);
    setLocalIsAdmin(res.isAdmin);
    await loadLocalData();
    showToast('Sesión local iniciada correctamente.');
  }

  async function handleRegisterLocal(input: {
    email: string;
    displayName: string;
    businessName?: string;
    phone?: string;
    bankCbuCvu?: string;
    bankAlias?: string;
    bankAccountHolder?: string;
    password: string;
  }) {
    const res = await registerLocalCustomer(input);
    userChangedDbModeRef.current = true;
    setActiveDatabaseMode('local');
    setDbMode('local');
    setTrackedOrderId(null);
    try {
      window.localStorage.setItem(DB_MODE_STORAGE_KEY, 'local');
    } catch {
      // ignore storage errors
    }
    setLocalUser(res.user);
    setLocalProfile(res.profile);
    setLocalIsAdmin(res.isAdmin);
    await Promise.all([loadLocalData(), refreshLocalServerInfo()]);
    showToast('Cuenta local registrada e iniciada.');
  }

  async function handleSignOut() {
    if (dbMode === 'local') {
      await logoutLocalAccount();
      setLocalUser(null);
      setLocalProfile(null);
      setLocalIsAdmin(false);
      setLocalOrders([]);
      setLocalAccounts([]);
      setLocalSubscriptionPayments([]);
      setLocalNotifications([]);
      await loadLocalData();
      showToast('Cerraste tu sesión local correctamente.');
      return;
    }
    await signOut(auth);
    showToast('Cerraste sesión correctamente.');
  }

  async function handleEnablePush() {
    const nextState = await requestPushPermission();
    setPushPermission(nextState);
    if (nextState === 'granted') {
      sendBrowserPush(
        'Infourqui Mercado — Alertas activadas',
        'Recibirás notificaciones en vivo sobre tus pedidos y envíos.',
        'infourqui-welcome-push',
      );
      showToast('Notificaciones push activadas en tu navegador.');
      if (activeUser) {
        void updateUserProfile(activeUser.uid, { pushEnabled: true }).catch(() => {});
      }
    } else if (nextState === 'denied') {
      showToast('Las notificaciones están bloqueadas en la configuración del navegador.');
    }
  }

  function handleAddToCart(product: Product, qty = 1) {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        const nextQty = Math.min(product.stock, existing.quantity + qty);
        return prev.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: nextQty,
                maxStock: product.stock,
                price: product.price,
                freeShipping: Boolean(product.freeShipping),
                sellerId: product.sellerId,
                sellerName: product.sellerName,
                sellerBankAlias: product.sellerBankAlias,
                sellerBankCbuCvu: product.sellerBankCbuCvu,
                sellerBankAccountHolder: product.sellerBankAccountHolder,
              }
            : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category,
          categoryLabel: product.categoryLabel,
          price: product.price,
          quantity: Math.min(product.stock, qty),
          imageUrl: product.imageUrl,
          maxStock: product.stock,
          freeShipping: Boolean(product.freeShipping),
          sellerId: product.sellerId,
          sellerName: product.sellerName,
          sellerBankAlias: product.sellerBankAlias,
          sellerBankCbuCvu: product.sellerBankCbuCvu,
          sellerBankAccountHolder: product.sellerBankAccountHolder,
        },
      ];
    });
  }

  function handleUpdateCartQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId) return item;
          const next = item.quantity + delta;
          if (next <= 0) return null;
          return { ...item, quantity: Math.min(item.maxStock, next) };
        })
        .filter((x): x is CartItem => x !== null),
    );
  }

  function handleRemoveCartItem(productId: string) {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] text-[#09090B]">
      <Header
        activeView={activeView}
        onNavigate={(view) => {
          setActiveView(view);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        cartCount={cartCount}
        unreadNotifications={unreadCount}
        user={activeUser}
        isAdmin={activeIsAdmin}
        onOpenCart={() => setCartOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
        onOpenMobileCategories={() => setMobileSidebarOpen(true)}
      />

      <main className="flex-1">
        {activeView === 'catalog' && (
          <StorefrontView
            products={storefrontProducts}
            loading={activeProductsLoading}
            shippingSettings={activeShippingSettings}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            onAddToCart={handleAddToCart}
            pushPermission={pushPermission}
            onEnablePush={() => void handleEnablePush()}
            mobileSidebarOpen={mobileSidebarOpen}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
          />
        )}

        {activeView === 'tracking' && (
          <ShipmentTrackingView
            user={activeUser}
            isAdmin={activeIsAdmin}
            orders={activeOrders}
            initialSelectedOrderId={trackedOrderId}
            onRequireSignIn={() => setAccountOpen(true)}
            onNotifyToast={showToast}
          />
        )}

        {activeView === 'notifications' && (
          <NotificationsView
            user={activeUser}
            notifications={activeNotifications}
            pushPermission={pushPermission}
            onEnablePush={handleEnablePush}
            onRequireSignIn={() => setAccountOpen(true)}
            onOpenOrderTracking={(orderId) => {
              setTrackedOrderId(orderId);
              setActiveView('tracking');
            }}
            onNotifyToast={showToast}
          />
        )}

        {activeView === 'admin' && (
          <AdminDashboardView
            user={activeUser}
            profile={activeProfile}
            isAdmin={activeIsAdmin}
            dbMode={dbMode}
            onChangeDbMode={(mode) => void handleChangeDbMode(mode)}
            localServerInfo={localServerInfo}
            onRefreshServerInfo={refreshLocalServerInfo}
            onRefreshLocalData={dbMode === 'local' ? loadLocalData : undefined}
            products={activeProducts}
            orders={activeOrders}
            accounts={activeAccounts}
            subscriptionPayments={activeSubscriptionPayments}
            shippingSettings={activeShippingSettings}
            onRequireSignIn={() => setAccountOpen(true)}
            onProfileSaved={(updates) => {
              if (dbMode === 'cloud') {
                setCloudProfile((prev) => (prev ? { ...prev, ...updates } : prev));
              }
            }}
            onNotifyToast={showToast}
          />
        )}
      </main>

      {/* Clean Editorial Footer */}
      <footer className="border-t border-zinc-200 bg-white mt-auto">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-zinc-950">Infourqui Mercado</span>
            <span>·</span>
            <span>Comercio electrónico con inventario y logística sincronizados</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveView('catalog')}
              className="hover:text-zinc-950 cursor-pointer"
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setActiveView('tracking')}
              className="hover:text-zinc-950 cursor-pointer"
            >
              Envíos
            </button>
            <button
              type="button"
              onClick={() => setActiveView('notifications')}
              className="hover:text-zinc-950 cursor-pointer"
            >
              Alertas
            </button>
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="hover:text-zinc-950 cursor-pointer"
            >
              Mi cuenta
            </button>
          </div>
        </div>
      </footer>

      {/* Drawers & Modals */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cart}
        shippingSettings={activeShippingSettings}
        onUpdateQuantity={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        promoCode={promoCode}
        onApplyPromo={setPromoCode}
        onProceedToCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
      />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        items={cart}
        shippingSettings={activeShippingSettings}
        promoCode={promoCode}
        user={activeUser}
        profile={activeProfile}
        onRequireSignIn={() => setAccountOpen(true)}
        onOpenAccount={() => {
          setCheckoutOpen(false);
          setAccountOpen(true);
        }}
        onOrderSuccess={() => {
          setCart([]);
          setPromoCode('');
        }}
        onTrackOrder={(orderId) => {
          setTrackedOrderId(orderId);
          setActiveView('tracking');
        }}
      />

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        dbMode={dbMode}
        onChangeDbMode={(mode) => void handleChangeDbMode(mode)}
        localServerInfo={localServerInfo}
        user={activeUser}
        profile={activeProfile}
        isAdmin={activeIsAdmin}
        onSignInGoogle={handleSignInGoogle}
        onSetupLocalAdmin={handleSetupLocalAdmin}
        onLoginLocal={handleLoginLocal}
        onRegisterLocal={handleRegisterLocal}
        onProfileSaved={(updates) => {
          if (dbMode === 'cloud') {
            setCloudProfile((prev) => (prev ? { ...prev, ...updates } : prev));
          }
        }}
        onSignOut={handleSignOut}
        pushPermission={pushPermission}
        onEnablePush={handleEnablePush}
        onNotifyToast={showToast}
      />

      {/* Non-intrusive Real-Time Toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 max-w-sm bg-zinc-950 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-xs font-medium"
        >
          <Bell className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="leading-snug">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            aria-label="Cerrar aviso"
            className="text-zinc-400 hover:text-white ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
