import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
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
import { updateUserProfile } from './services/dataService';
import {
  checkIsAdmin,
  ensureUserProfile,
  seedDefaultCategoriesIfEmpty,
  seedInitialStoreData,
  updateUserProfile as firestoreUpdateUserProfile,
} from './services/firestoreService';
import {
  CATEGORIES,
  type ActiveView,
  type AppNotification,
  type AppUser,
  type CartItem,
  type CategoryDefinition,
  type CategoryId,
  type CustomerBenefit,
  type DeliveryAgent,
  type Order,
  type Product,
  type StoreSettings,
  type SubscriptionPayment,
  type UserProfile,
} from './types/ecommerce';

const LEGACY_DB_MODE_STORAGE_KEY = 'alba_db_mode';
const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora de inactividad
const SESSION_ACTIVITY_STORAGE_KEY = 'infourqui_session_last_activity';

function readLastSessionActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastSessionActivity(timestamp = Date.now()): void {
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // ignore storage errors
  }
}

function clearLastSessionActivity(): void {
  try {
    window.localStorage.removeItem(SESSION_ACTIVITY_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function getFirebaseAuthErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const maybeErr = err as { code?: unknown };
  return typeof maybeErr.code === 'string' ? maybeErr.code : '';
}

function isFirebaseUnauthorizedDomainError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeErr = err as { code?: unknown; message?: unknown };
  const code = typeof maybeErr.code === 'string' ? maybeErr.code : '';
  const msg = typeof maybeErr.message === 'string' ? maybeErr.message : '';
  return code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain');
}

function mapFirebaseEmailAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo electrónico o contraseña incorrectos.';
    case 'auth/invalid-email':
      return 'Ingresá un correo electrónico válido.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta registrada con ese correo electrónico.';
    case 'auth/weak-password':
      return 'La contraseña es demasiado débil. Usá al menos 8 caracteres.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Esperá unos minutos e intentá nuevamente.';
    case 'auth/network-request-failed':
      return 'Error de red al conectar con el servicio de autenticación. Revisá tu conexión.';
    default:
      return 'No pudimos completar el acceso con correo y contraseña. Verificá los datos e intentá nuevamente.';
  }
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

  // Firebase Auth & Firestore Cloud State
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [cloudAuthReady, setCloudAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cloudCategories, setCloudCategories] = useState<CategoryDefinition[]>([]);
  const seededCategoriesRef = useRef(false);
  const [firestoreProducts, setFirestoreProducts] = useState<Product[]>([]);
  const [sellerOwnProducts, setSellerOwnProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [accounts, setAccounts] = useState<UserProfile[]>([]);
  const [cloudDeliveryAgents, setCloudDeliveryAgents] = useState<DeliveryAgent[]>([]);
  const [adminBenefits, setAdminBenefits] = useState<CustomerBenefit[]>([]);
  const [globalBenefits, setGlobalBenefits] = useState<CustomerBenefit[]>([]);
  const [personalBenefits, setPersonalBenefits] = useState<CustomerBenefit[]>([]);
  const [ownedBenefits, setOwnedBenefits] = useState<CustomerBenefit[]>([]);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [personalNotifications, setPersonalNotifications] = useState<AppNotification[]>([]);
  const [broadcastNotifications, setBroadcastNotifications] = useState<AppNotification[]>([]);
  const [shippingSettings, setShippingSettings] = useState<StoreSettings>({
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

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3600);
  }, []);

  // Remove any legacy local-mode preference left over in browser storage
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_DB_MODE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
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

  const products = useMemo(() => {
    if (isAdmin || sellerOwnProducts.length === 0) return firestoreProducts;
    const byId = new Map<string, Product>();
    for (const p of firestoreProducts) byId.set(p.id, p);
    for (const p of sellerOwnProducts) byId.set(p.id, p);
    return Array.from(byId.values());
  }, [isAdmin, firestoreProducts, sellerOwnProducts]);

  // 1. Firebase Auth Subscription & Initial Cloud Seeding
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser || !nextUser.emailVerified) {
        setCloudUser(null);
        setIsAdmin(false);
        setProfile(null);
        setOrders([]);
        setSellerOwnProducts([]);
        setAccounts([]);
        setSubscriptionPayments([]);
        setPersonalNotifications([]);
        setBroadcastNotifications([]);
        initialNotifsLoaded.current = false;
        seenNotifIds.current.clear();
        setCloudAuthReady(true);
        return;
      }

      setCloudUser(nextUser);

      try {
        const [adminFlag, userProfile] = await Promise.all([
          checkIsAdmin(nextUser),
          ensureUserProfile(nextUser),
        ]);
        setIsAdmin(adminFlag);
        setProfile(userProfile);

        if (adminFlag) {
          const seeded = await seedInitialStoreData(nextUser);
          if (seeded) {
            showToast('Catálogo inicial, inventario y pedidos sincronizados en Firebase Firestore.');
          }
        }
      } catch (err) {
        console.error('Auth profile sync failed:', err);
      } finally {
        setCloudAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, [showToast]);

  // 2. Real-time Products Listener (Firestore)
  useEffect(() => {
    if (!cloudAuthReady) return;
    const productsQuery = isAdmin
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
        setProductsLoading(false);
        syncCartWithLiveProducts(list);
      },
      (error) => {
        setProductsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    return () => unsubscribe();
  }, [cloudAuthReady, isAdmin, syncCartWithLiveProducts]);

  // 2b. Real-time Shipping Settings Listener (Firestore)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'shipping'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<StoreSettings>;
          setShippingSettings({
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
  }, []);

  // 2c. Real-time User Profile Listener (Firestore)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser) return;
    const unsubscribe = onSnapshot(
      doc(db, 'users', cloudUser.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${cloudUser.uid}`);
      },
    );
    return () => unsubscribe();
  }, [cloudAuthReady, cloudUser]);

  // 3. Real-time Orders Listener (Admin sees all; users see purchases + orders where they are seller)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser) {
      setOrders([]);
      return;
    }

    if (isAdmin) {
      const unsubscribe = onSnapshot(
        query(collection(db, 'orders')),
        (snapshot) => {
          const list = snapshot.docs
            .map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Order, 'id'>),
            }))
            .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
          setOrders(list);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'orders');
        },
      );
      return () => unsubscribe();
    }

    let buyerOrders: Order[] = [];
    let sellerOrders: Order[] = [];

    const mergeAndSet = () => {
      const unique = new Map<string, Order>();
      for (const order of [...buyerOrders, ...sellerOrders]) {
        unique.set(order.id, order);
      }
      setOrders(
        Array.from(unique.values()).sort(
          (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
        ),
      );
    };

    const unsubBuyer = onSnapshot(
      query(collection(db, 'orders'), where('userId', '==', cloudUser.uid)),
      (snapshot) => {
        buyerOrders = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, 'id'>),
        }));
        mergeAndSet();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      },
    );

    const unsubSeller = onSnapshot(
      query(collection(db, 'orders'), where('sellerIds', 'array-contains', cloudUser.uid)),
      (snapshot) => {
        sellerOrders = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, 'id'>),
        }));
        mergeAndSet();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      },
    );

    return () => {
      unsubBuyer();
      unsubSeller();
    };
  }, [cloudAuthReady, cloudUser, isAdmin]);

  // 4. Real-time Push Notifications Listeners (Firestore)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser) return;

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
        setPersonalNotifications(list);
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
        setBroadcastNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      },
    );

    return () => {
      unsubPersonal();
      unsubBroadcast();
    };
  }, [cloudAuthReady, cloudUser, showToast]);

  // 4b. Real-time Seller Own Products Listener (non-admin sellers)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser || isAdmin) {
      setSellerOwnProducts([]);
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
        setSellerOwnProducts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );
    return () => unsubscribe();
  }, [cloudAuthReady, cloudUser, isAdmin]);

  // 4c. Real-time Subscription Payments Listener (Firestore)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser) {
      setSubscriptionPayments([]);
      return;
    }
    const subPaymentsQ = isAdmin
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
        setSubscriptionPayments(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'subscriptionPayments');
      },
    );
    return () => unsubscribe();
  }, [cloudAuthReady, cloudUser, isAdmin]);

  // 4d. Real-time Accounts Directory Listener (Admin only)
  useEffect(() => {
    if (!cloudAuthReady || !isAdmin) {
      setAccounts([]);
      return;
    }
    const unsubscribe = onSnapshot(
      query(collection(db, 'users')),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          ...(d.data() as UserProfile),
          uid: d.id,
        }));
        setAccounts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      },
    );
    return () => unsubscribe();
  }, [cloudAuthReady, isAdmin]);

  // 4e. Real-time Delivery Agents (Medios de Envío) Listener (Strict Per-Client Ownership)
  useEffect(() => {
    if (!cloudAuthReady || !cloudUser) {
      setCloudDeliveryAgents([]);
      return;
    }
    const isBootstrappedAdminAccount =
      isAdmin &&
      Boolean(cloudUser.emailVerified) &&
      cloudUser.email?.toLowerCase() === 'informaticaurquiza@gmail.com';
    const agentsQuery = isBootstrappedAdminAccount
      ? query(collection(db, 'deliveryAgents'))
      : query(collection(db, 'deliveryAgents'), where('ownerId', '==', cloudUser.uid));

    const unsubscribe = onSnapshot(
      agentsQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<DeliveryAgent, 'id'>),
          }))
          .filter((a) =>
            isBootstrappedAdminAccount
              ? a.ownerId === cloudUser.uid || !a.ownerId
              : a.ownerId === cloudUser.uid,
          )
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
        setCloudDeliveryAgents(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'deliveryAgents');
      },
    );
    return () => unsubscribe();
  }, [cloudAuthReady, isAdmin, cloudUser]);

  // 4f. Real-time Benefits Listeners (Firestore)
  useEffect(() => {
    if (!cloudAuthReady) {
      setAdminBenefits([]);
      setGlobalBenefits([]);
      setPersonalBenefits([]);
      setOwnedBenefits([]);
      return;
    }

    if (isAdmin) {
      setGlobalBenefits([]);
      setPersonalBenefits([]);
      setOwnedBenefits([]);
      const unsubAdmin = onSnapshot(
        query(collection(db, 'benefits')),
        (snapshot) => {
          const list = snapshot.docs
            .map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CustomerBenefit, 'id'>),
            }))
            .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
          setAdminBenefits(list);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'benefits');
        },
      );
      return () => unsubAdmin();
    }

    setAdminBenefits([]);
    const unsubGlobal = onSnapshot(
      query(collection(db, 'benefits'), where('targetUserId', '==', 'all')),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CustomerBenefit, 'id'>),
        }));
        setGlobalBenefits(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'benefits');
      },
    );

    if (!cloudUser) {
      setPersonalBenefits([]);
      setOwnedBenefits([]);
      return () => unsubGlobal();
    }

    const unsubPersonal = onSnapshot(
      query(collection(db, 'benefits'), where('targetUserId', '==', cloudUser.uid)),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CustomerBenefit, 'id'>),
        }));
        setPersonalBenefits(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'benefits');
      },
    );

    const unsubOwned = onSnapshot(
      query(collection(db, 'benefits'), where('createdBy', '==', cloudUser.uid)),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CustomerBenefit, 'id'>),
        }));
        setOwnedBenefits(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'benefits');
      },
    );

    return () => {
      unsubGlobal();
      unsubPersonal();
      unsubOwned();
    };
  }, [cloudAuthReady, isAdmin, cloudUser]);

  // 4g. Real-time Categories (Rubros) Listener (Firestore)
  useEffect(() => {
    if (!cloudAuthReady) {
      setCloudCategories([]);
      return;
    }

    const isBootstrappedAdminAccount =
      isAdmin &&
      Boolean(cloudUser?.emailVerified) &&
      cloudUser?.email?.toLowerCase() === 'informaticaurquiza@gmail.com';

    const categoriesQuery = isBootstrappedAdminAccount
      ? query(collection(db, 'categories'))
      : query(collection(db, 'categories'), where('active', '==', true));

    const unsubscribe = onSnapshot(
      categoriesQuery,
      (snapshot) => {
        if (snapshot.empty) {
          setCloudCategories([]);
          if (isBootstrappedAdminAccount && !seededCategoriesRef.current) {
            seededCategoriesRef.current = true;
            void seedDefaultCategoriesIfEmpty().catch(() => {
              seededCategoriesRef.current = false;
            });
          }
          return;
        }
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<CategoryDefinition, 'id'>),
          }))
          .sort((a, b) => {
            const orderDiff = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
            if (orderDiff !== 0) return orderDiff;
            return a.label.localeCompare(b.label, 'es');
          });
        setCloudCategories(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'categories');
      },
    );

    return () => unsubscribe();
  }, [cloudAuthReady, isAdmin, cloudUser]);

  const benefits = useMemo(() => {
    if (isAdmin) return adminBenefits;
    const merged = [...ownedBenefits, ...personalBenefits, ...globalBenefits];
    const uniqueMap = new Map<string, CustomerBenefit>();
    for (const item of merged) {
      uniqueMap.set(item.id, item);
    }
    return Array.from(uniqueMap.values()).sort(
      (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
    );
  }, [isAdmin, adminBenefits, ownedBenefits, personalBenefits, globalBenefits]);

  const notifications = useMemo(() => {
    const merged = [...personalNotifications, ...broadcastNotifications];
    const uniqueMap = new Map<string, AppNotification>();
    for (const item of merged) {
      uniqueMap.set(item.id, item);
    }
    return Array.from(uniqueMap.values()).sort(
      (a, b) => getMillis(b.createdAt) - getMillis(a.createdAt),
    );
  }, [personalNotifications, broadcastNotifications]);

  const activeUser: AppUser | null = useMemo(
    () => toAppUserFromFirebase(cloudUser),
    [cloudUser],
  );
  const idleExpiringRef = useRef(false);

  // Automatic 1-hour inactivity session expiration (Firebase Auth)
  useEffect(() => {
    if (!activeUser) {
      idleExpiringRef.current = false;
      return;
    }

    let timeoutId: number | null = null;
    let lastActivityThrottleAt = 0;

    const triggerIdleExpiration = async () => {
      if (idleExpiringRef.current) return;
      idleExpiringRef.current = true;
      clearLastSessionActivity();
      setCheckoutOpen(false);
      setAccountOpen(false);
      setCartOpen(false);
      setActiveView((curr) => (curr === 'admin' ? 'catalog' : curr));

      try {
        await signOut(auth);
      } catch {
        // ignore errors during forced idle sign-out
      } finally {
        showToast('Tu sesión venció automáticamente tras 1 hora de inactividad.');
      }
    };

    const scheduleExpirationCheck = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      const lastActive = readLastSessionActivity() ?? Date.now();
      const elapsed = Date.now() - lastActive;
      const remaining = SESSION_IDLE_TIMEOUT_MS - elapsed;
      if (remaining <= 0) {
        void triggerIdleExpiration();
        return;
      }
      timeoutId = window.setTimeout(() => {
        const latest = readLastSessionActivity() ?? lastActive;
        if (Date.now() - latest >= SESSION_IDLE_TIMEOUT_MS) {
          void triggerIdleExpiration();
        } else {
          scheduleExpirationCheck();
        }
      }, remaining);
    };

    // Check immediately on mount / session restore (e.g. tab reopened after > 1 hour away)
    const initialStored = readLastSessionActivity();
    if (initialStored !== null && Date.now() - initialStored >= SESSION_IDLE_TIMEOUT_MS) {
      void triggerIdleExpiration();
      return;
    }
    if (initialStored === null) {
      writeLastSessionActivity(Date.now());
    }
    scheduleExpirationCheck();

    const recordUserActivity = () => {
      if (idleExpiringRef.current) return;
      const now = Date.now();
      if (now - lastActivityThrottleAt < 15_000) return;
      lastActivityThrottleAt = now;

      const prevStored = readLastSessionActivity();
      if (prevStored !== null && now - prevStored >= SESSION_IDLE_TIMEOUT_MS) {
        void triggerIdleExpiration();
        return;
      }

      writeLastSessionActivity(now);
      scheduleExpirationCheck();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const latest = readLastSessionActivity();
      if (latest !== null && Date.now() - latest >= SESSION_IDLE_TIMEOUT_MS) {
        void triggerIdleExpiration();
      } else {
        scheduleExpirationCheck();
      }
    };

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key !== SESSION_ACTIVITY_STORAGE_KEY) return;
      scheduleExpirationCheck();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
      'scroll',
      'mousemove',
    ];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, recordUserActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageSync);

    const intervalId = window.setInterval(() => {
      const latest = readLastSessionActivity();
      if (latest !== null && Date.now() - latest >= SESSION_IDLE_TIMEOUT_MS) {
        void triggerIdleExpiration();
      }
    }, 30_000);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, recordUserActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageSync);
    };
  }, [activeUser?.uid, showToast]);

  const deliveryAgents = useMemo(() => {
    if (!activeUser) return [];
    return cloudDeliveryAgents.filter(
      (agent) => agent.ownerId === activeUser.uid || (isAdmin && !agent.ownerId),
    );
  }, [activeUser, isAdmin, cloudDeliveryAgents]);

  const activeCategories = useMemo(() => {
    const source = cloudCategories.length > 0 ? cloudCategories : CATEGORIES;
    return [...source].sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label, 'es');
    });
  }, [cloudCategories]);

  const catalogCategories = useMemo(
    () => activeCategories.filter((c) => c.active !== false),
    [activeCategories],
  );

  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      catalogCategories.length > 0 &&
      !catalogCategories.some((c) => c.id === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [selectedCategory, catalogCategories]);

  // Storefront catalog hides paused products and products of expired/inactive sellers
  const storefrontProducts = useMemo(() => {
    const accountById = new Map(accounts.map((a) => [a.uid, a]));
    const currentSellerInactive =
      !isAdmin &&
      Boolean(activeUser) &&
      Boolean(profile) &&
      !getAccountSubscriptionInfo(profile).isActive;

    return products.filter((p) => {
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
  }, [products, accounts, isAdmin, activeUser, profile]);

  const unreadCount = useMemo(
    () => personalNotifications.filter((n) => !n.read).length,
    [personalNotifications],
  );

  // Firebase Auth Handlers
  async function handleSignInGoogle(optionalSignupData?: {
    isRegister?: boolean;
    displayName?: string;
    businessName?: string;
    phone?: string;
    bankCbuCvu?: string;
    bankAlias?: string;
    bankAccountHolder?: string;
  }): Promise<{ unauthorizedDomain?: string }> {
    writeLastSessionActivity(Date.now());
    let credential;
    try {
      credential = await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (isFirebaseUnauthorizedDomainError(err)) {
        return { unauthorizedDomain: window.location.hostname };
      }
      throw err;
    }

    setTrackedOrderId(null);

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
      setIsAdmin(adminFlag);
      if (Object.keys(cleanProfileUpdates).length > 0) {
        await firestoreUpdateUserProfile(credential.user.uid, cleanProfileUpdates);
        setProfile({ ...ensured, ...cleanProfileUpdates });
      } else {
        setProfile(ensured);
      }
      setCloudAuthReady(true);
    }

    writeLastSessionActivity(Date.now());
    showToast(
      optionalSignupData?.isRegister
        ? 'Cuenta creada con Google e iniciada correctamente.'
        : 'Sesión con Google iniciada de forma segura.',
    );
    return {};
  }

  async function handleLoginEmail(input: {
    email: string;
    password: string;
    resendVerification?: boolean;
  }): Promise<{
    emailPasswordDisabled?: boolean;
    verificationSent?: boolean;
    emailNotVerified?: boolean;
    email?: string;
  }> {
    try {
      writeLastSessionActivity(Date.now());
      const cleanEmail = input.email.trim();
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, input.password);
      if (!credential.user.emailVerified) {
        if (input.resendVerification) {
          await sendEmailVerification(credential.user);
        }
        await signOut(auth);
        return {
          emailNotVerified: true,
          verificationSent: Boolean(input.resendVerification),
          email: cleanEmail,
        };
      }

      setTrackedOrderId(null);
      setCloudUser(credential.user);
      const [adminFlag, ensured] = await Promise.all([
        checkIsAdmin(credential.user),
        ensureUserProfile(credential.user),
      ]);
      setIsAdmin(adminFlag);
      setProfile(ensured);
      setCloudAuthReady(true);
      writeLastSessionActivity(Date.now());
      showToast('Sesión iniciada correctamente.');
      return {};
    } catch (err) {
      const code = getFirebaseAuthErrorCode(err);
      if (code === 'auth/operation-not-allowed') {
        return { emailPasswordDisabled: true };
      }
      throw new Error(mapFirebaseEmailAuthError(code));
    }
  }

  async function handleRegisterEmail(input: {
    email: string;
    displayName: string;
    businessName?: string;
    phone?: string;
    bankCbuCvu?: string;
    bankAlias?: string;
    bankAccountHolder?: string;
    password: string;
  }): Promise<{
    emailPasswordDisabled?: boolean;
    verificationSent?: boolean;
    email?: string;
  }> {
    try {
      const cleanEmail = input.email.trim();
      const credential = await createUserWithEmailAndPassword(auth, cleanEmail, input.password);
      if (input.displayName.trim()) {
        await updateProfile(credential.user, { displayName: input.displayName.trim() });
      }
      await sendEmailVerification(credential.user);
      await signOut(auth);
      showToast('Te enviamos un correo para confirmar tu cuenta.');
      return { verificationSent: true, email: cleanEmail };
    } catch (err) {
      const code = getFirebaseAuthErrorCode(err);
      if (code === 'auth/operation-not-allowed') {
        return { emailPasswordDisabled: true };
      }
      throw new Error(mapFirebaseEmailAuthError(code));
    }
  }

  async function handleRequestPasswordReset(input: {
    email: string;
  }): Promise<{ email?: string; emailPasswordDisabled?: boolean }> {
    const cleanEmail = input.email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Ingresá un correo electrónico válido.');
    }

    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return { email: cleanEmail };
    } catch (err) {
      const code = getFirebaseAuthErrorCode(err);
      if (code === 'auth/user-not-found') {
        // Neutral response to avoid account enumeration
        return { email: cleanEmail };
      }
      if (code === 'auth/operation-not-allowed') {
        return { emailPasswordDisabled: true };
      }
      throw new Error(mapFirebaseEmailAuthError(code));
    }
  }

  async function handleSignOut() {
    clearLastSessionActivity();
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
        isAdmin={isAdmin}
        onOpenCart={() => setCartOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
        onOpenMobileCategories={() => setMobileSidebarOpen(true)}
      />

      <main className="flex-1">
        {activeView === 'catalog' && (
          <StorefrontView
            categories={catalogCategories}
            products={storefrontProducts}
            loading={productsLoading}
            shippingSettings={shippingSettings}
            benefits={benefits}
            user={activeUser}
            activePromoCode={promoCode}
            onApplyPromoCode={(code) => {
              setPromoCode(code);
              showToast(`Código ${code} aplicado a tu carrito.`);
            }}
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
            isAdmin={isAdmin}
            orders={orders}
            products={products}
            deliveryAgents={deliveryAgents}
            initialSelectedOrderId={trackedOrderId}
            onRequireSignIn={() => setAccountOpen(true)}
            onNotifyToast={showToast}
          />
        )}

        {activeView === 'notifications' && (
          <NotificationsView
            user={activeUser}
            isAdmin={isAdmin}
            notifications={notifications}
            benefits={benefits}
            accounts={accounts}
            activePromoCode={promoCode}
            onApplyPromoCode={(code) => {
              setPromoCode(code);
              showToast(`Código ${code} aplicado a tu carrito.`);
            }}
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
            profile={profile}
            isAdmin={isAdmin}
            categories={activeCategories}
            products={products}
            orders={orders}
            accounts={accounts}
            benefits={benefits}
            subscriptionPayments={subscriptionPayments}
            shippingSettings={shippingSettings}
            onRequireSignIn={() => setAccountOpen(true)}
            onProfileSaved={(updates) => {
              setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
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
            <span>Comercio electrónico sincronizado en la nube con Firebase Firestore</span>
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
        shippingSettings={shippingSettings}
        benefits={benefits}
        user={activeUser}
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
        shippingSettings={shippingSettings}
        benefits={benefits}
        promoCode={promoCode}
        user={activeUser}
        profile={profile}
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
        user={activeUser}
        profile={profile}
        isAdmin={isAdmin}
        onSignInGoogle={handleSignInGoogle}
        onLoginEmail={handleLoginEmail}
        onRegisterEmail={handleRegisterEmail}
        onRequestPasswordReset={handleRequestPasswordReset}
        onProfileSaved={(updates) => {
          setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
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
