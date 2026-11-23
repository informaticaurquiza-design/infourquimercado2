import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Info,
  KeyRound,
  Landmark,
  LogOut,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { PushPermissionState } from '../lib/pushNotifications';
import {
  SELLER_TRIAL_NOTICE,
  formatShortDate,
  getAccountSubscriptionInfo,
} from '../lib/validation';
import {
  canCurrentCloudUserChangePassword,
  changeAccountPassword,
  updateUserProfile,
} from '../services/dataService';
import type {
  AppUser,
  DatabaseMode,
  LocalServerInfo,
  UserProfile,
} from '../types/ecommerce';

interface CloudSignupProfileInput {
  isRegister?: boolean;
  displayName?: string;
  businessName?: string;
  phone?: string;
  bankCbuCvu?: string;
  bankAlias?: string;
  bankAccountHolder?: string;
}

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  dbMode: DatabaseMode;
  onChangeDbMode: (mode: DatabaseMode) => void;
  localServerInfo: LocalServerInfo | null;
  user: AppUser | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  onSignInGoogle: (
    optionalSignupData?: CloudSignupProfileInput,
  ) => Promise<{ switchedToLocal?: boolean } | void>;
  onSetupLocalAdmin: (input: {
    email: string;
    displayName: string;
    businessName?: string;
    password: string;
  }) => Promise<void>;
  onLoginLocal: (input: { email: string; password: string }) => Promise<void>;
  onRegisterLocal: (input: {
    email: string;
    displayName: string;
    businessName?: string;
    phone?: string;
    bankCbuCvu?: string;
    bankAlias?: string;
    bankAccountHolder?: string;
    password: string;
  }) => Promise<void>;
  onProfileSaved?: (updates: Partial<UserProfile>) => void;
  onSignOut: () => Promise<void>;
  pushPermission: PushPermissionState;
  onEnablePush: () => Promise<void>;
  onNotifyToast: (msg: string) => void;
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.29A7.21 7.21 0 0 1 4.91 12c0-.79.14-1.56.38-2.29v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1C6.23 6.87 8.88 4.76 12 4.76Z"
      />
    </svg>
  );
}

export function AccountModal({
  open,
  onClose,
  dbMode,
  onChangeDbMode,
  localServerInfo,
  user,
  profile,
  isAdmin,
  onSignInGoogle,
  onSetupLocalAdmin,
  onLoginLocal,
  onRegisterLocal,
  onProfileSaved,
  onSignOut,
  pushPermission,
  onEnablePush,
  onNotifyToast,
}: AccountModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [defaultAddress, setDefaultAddress] = useState('');
  const [defaultCity, setDefaultCity] = useState('');
  const [defaultPostalCode, setDefaultPostalCode] = useState('');
  const [bankCbuCvu, setBankCbuCvu] = useState('');
  const [bankAlias, setBankAlias] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [saving, setSaving] = useState(false);

  const localAvailable = Boolean(localServerInfo?.available);
  const needsAdminSetup =
    localAvailable &&
    !localServerInfo?.envAdminConfigured &&
    !localServerInfo?.adminClaimed;

  // Unified Auth Navigation: Ingresar / Crear cuenta (+ Configurar Admin on first local run)
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'setup'>('login');
  const [authMethod, setAuthMethod] = useState<'local' | 'google'>('local');

  // Shared login / signup fields
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupBusiness, setSignupBusiness] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupBankCbuCvu, setSignupBankCbuCvu] = useState('');
  const [signupBankAlias, setSignupBankAlias] = useState('');
  const [signupBankHolder, setSignupBankHolder] = useState('');
  const [showBankSection, setShowBankSection] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');

  // Signed-in password change state
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  useEffect(() => {
    if (!open || !localAvailable) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'F10') {
        e.preventDefault();
        onChangeDbMode(dbMode === 'local' ? 'cloud' : 'local');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, localAvailable, dbMode, onChangeDbMode]);

  useEffect(() => {
    if (open) {
      setAuthError('');
      setAuthNotice('');
      setAuthPassword('');
      setSignupName('');
      setSignupBusiness('');
      setSignupPhone('');
      setSignupBankCbuCvu('');
      setSignupBankAlias('');
      setSignupBankHolder('');
      setShowBankSection(false);
      setShowPasswordSection(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordError('');
      setPasswordSuccess('');

      const initialMethod: 'local' | 'google' =
        localAvailable && dbMode === 'local' ? 'local' : 'google';
      setAuthMethod(initialMethod);

      if (dbMode === 'local' && needsAdminSetup) {
        setAuthTab('setup');
        setAuthEmail('informaticaurquiza@gmail.com');
        setSignupName('Administrador Local');
      } else {
        setAuthTab('login');
        setAuthEmail('');
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!localAvailable && authMethod === 'local') {
      setAuthMethod('google');
    }
    if (!needsAdminSetup && authTab === 'setup') {
      setAuthTab('login');
    }
  }, [open, localAvailable, authMethod, needsAdminSetup, authTab]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || user?.displayName || '');
      setBusinessName(profile.businessName || '');
      setPhone(profile.phone || '');
      setDefaultAddress(profile.defaultAddress || '');
      setDefaultCity(profile.defaultCity || '');
      setDefaultPostalCode(profile.defaultPostalCode || '');
      setBankCbuCvu(profile.bankCbuCvu || '');
      setBankAlias(profile.bankAlias || '');
      setBankAccountHolder(profile.bankAccountHolder || '');
    } else if (user) {
      setDisplayName(user.displayName || '');
      setBusinessName('');
      setBankCbuCvu('');
      setBankAlias('');
      setBankAccountHolder('');
    }
  }, [profile, user, open]);

  if (!open) return null;

  async function handleGoogleAuth(isRegister: boolean) {
    setAuthError('');
    setAuthNotice('');
    setAuthLoading(true);
    try {
      const result = await onSignInGoogle(
        isRegister
          ? {
              isRegister: true,
              displayName: signupName,
              businessName: signupBusiness,
              phone: signupPhone,
              bankCbuCvu: signupBankCbuCvu,
              bankAlias: signupBankAlias,
              bankAccountHolder: signupBankHolder,
            }
          : { isRegister: false },
      );
      if (result && result.switchedToLocal) {
        setAuthMethod('local');
        setAuthNotice(
          'Google no autoriza direcciones locales o IPs privadas de red. Podés continuar directamente con Cuenta local (correo y contraseña) aquí mismo.',
        );
        return;
      }
      onClose();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'No pudimos iniciar sesión con Google.',
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLocalAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthNotice('');
    setAuthLoading(true);
    try {
      if (authTab === 'setup') {
        await onSetupLocalAdmin({
          email: authEmail,
          displayName: signupName,
          businessName: signupBusiness,
          password: authPassword,
        });
      } else if (authTab === 'register') {
        await onRegisterLocal({
          email: authEmail,
          displayName: signupName,
          businessName: signupBusiness,
          phone: signupPhone,
          bankCbuCvu: signupBankCbuCvu,
          bankAlias: signupBankAlias,
          bankAccountHolder: signupBankHolder,
          password: authPassword,
        });
      } else {
        await onLoginLocal({
          email: authEmail,
          password: authPassword,
        });
      }
      setAuthPassword('');
      onClose();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'No pudimos completar el acceso local.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const updates = {
        displayName,
        businessName,
        phone,
        defaultAddress,
        defaultCity,
        defaultPostalCode,
        bankCbuCvu,
        bankAlias,
        bankAccountHolder,
      };
      await updateUserProfile(user.uid, updates);
      onProfileSaved?.(updates);
      onNotifyToast('Datos de cuenta, envío y bancarios actualizados.');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function renderMethodSwitcher() {
    if (!localAvailable) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-zinc-500">Elegí el método de acceso</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('local');
              setAuthError('');
              setAuthNotice('');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
              authMethod === 'local'
                ? 'border-zinc-950 bg-zinc-950 text-white'
                : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Cuenta local</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('google');
              setAuthError('');
              setAuthNotice('');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
              authMethod === 'google'
                ? 'border-blue-700 bg-blue-50 text-blue-950'
                : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950'
            }`}
          >
            <GoogleMark />
            <span>Cuenta Google</span>
          </button>
        </div>
      </div>
    );
  }

  function renderOptionalBankSection() {
    return (
      <div className="border border-zinc-200 rounded-xl bg-zinc-50/70 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowBankSection((prev) => !prev)}
          className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-zinc-900">
                Datos Bancarios (opcional para compradores)
              </p>
              <p className="text-[11px] text-zinc-500">
                CBU o CVU, Alias y Nombre de la cuenta
              </p>
            </div>
          </div>
          {showBankSection ? (
            <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
          )}
        </button>

        {showBankSection && (
          <div className="px-4 pb-4 pt-2 border-t border-zinc-200 space-y-3 bg-white">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                CBU o CVU (opcional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={32}
                value={signupBankCbuCvu}
                onChange={(e) => setSignupBankCbuCvu(e.target.value)}
                placeholder="Ej. 0170099940000012345678"
                className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Alias (opcional)
              </label>
              <input
                type="text"
                maxLength={60}
                value={signupBankAlias}
                onChange={(e) => setSignupBankAlias(e.target.value)}
                placeholder="Ej. juan.perez.banco"
                className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Nombre de la cuenta (opcional)
              </label>
              <input
                type="text"
                maxLength={120}
                value={signupBankHolder}
                onChange={(e) => setSignupBankHolder(e.target.value)}
                placeholder="Ej. Juan Pérez — Caja de Ahorro"
                className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-zinc-950/45 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="font-display text-base font-bold text-zinc-950">
            {user ? 'Mi cuenta' : 'Ingresar o crear cuenta'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de cuenta"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto">
          {!user ? (
            <div className="p-6 space-y-5">
              {/* Primary Action Tabs: Ingresar / Crear cuenta (+ Configurar Admin if unclaimed) */}
              <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg text-xs">
                {needsAdminSetup && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('setup');
                      setAuthMethod('local');
                      setAuthEmail((prev) => prev || 'informaticaurquiza@gmail.com');
                      setSignupName((prev) => prev || 'Administrador Local');
                      setAuthError('');
                      setAuthNotice('');
                    }}
                    className={`flex-1 py-2 px-2 rounded-md font-medium transition-colors cursor-pointer ${
                      authTab === 'setup'
                        ? 'bg-white text-zinc-950 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    Configurar Admin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setAuthError('');
                    setAuthNotice('');
                  }}
                  className={`flex-1 py-2 px-3 rounded-md font-medium transition-colors cursor-pointer ${
                    authTab === 'login'
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  Ingresar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('register');
                    setAuthError('');
                    setAuthNotice('');
                  }}
                  className={`flex-1 py-2 px-3 rounded-md font-medium transition-colors cursor-pointer ${
                    authTab === 'register'
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  Crear cuenta
                </button>
              </div>

              {authNotice && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-950 leading-relaxed">{authNotice}</p>
                </div>
              )}

              {authError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  {authError}
                </p>
              )}

              {/* TAB: SETUP FIRST LOCAL ADMIN */}
              {authTab === 'setup' && needsAdminSetup && (
                <form onSubmit={handleLocalAuthSubmit} className="space-y-4">
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Primer inicio local: definí la contraseña de tu cuenta administradora para
                    gestionar el catálogo, clientes, pedidos y configuración de la tienda.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Nombre completo
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      placeholder="Ej. Martín Urquiza"
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Nombre comercial (opcional)
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={signupBusiness}
                      onChange={(e) => setSignupBusiness(e.target.value)}
                      placeholder="Ej. Infourqui Distribuidora S.R.L."
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Correo electrónico
                    </label>
                    <input
                      type="email"
                      required
                      maxLength={120}
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="correo@empresa.com"
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Contraseña (mínimo 8 caracteres)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={128}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                  >
                    {authLoading ? 'Configurando...' : 'Crear administrador local'}
                  </button>
                </form>
              )}

              {/* TAB: INGRESAR (Local OR Google) */}
              {authTab === 'login' && (
                <div className="space-y-4">
                  {renderMethodSwitcher()}

                  {authMethod === 'local' && localAvailable ? (
                    <form onSubmit={handleLocalAuthSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Correo electrónico
                        </label>
                        <input
                          type="email"
                          required
                          maxLength={120}
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          placeholder="cliente@correo.com"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Contraseña
                        </label>
                        <input
                          type="password"
                          required
                          minLength={1}
                          maxLength={128}
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-2.5 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                      >
                        {authLoading ? 'Verificando...' : 'Ingresar con cuenta local'}
                      </button>

                      <div className="relative flex items-center py-1">
                        <div className="flex-grow border-t border-zinc-200" />
                        <span className="px-3 text-[11px] text-zinc-400">o continuá con</span>
                        <div className="flex-grow border-t border-zinc-200" />
                      </div>

                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => void handleGoogleAuth(false)}
                        className="w-full py-2.5 px-4 bg-white hover:bg-zinc-50 border border-zinc-300 disabled:opacity-60 text-zinc-900 text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <GoogleMark />
                        <span>Ingresar con cuenta Google</span>
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 text-zinc-900">
                        <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
                        <p className="text-sm font-semibold">Ingresá con tu cuenta de Google</p>
                      </div>
                      <p className="text-xs text-zinc-600 leading-relaxed">
                        Accedé con tu cuenta de Google verificada para consultar tus pedidos,
                        domicilios guardados, publicaciones y seguimiento de envíos en vivo.
                      </p>

                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => void handleGoogleAuth(false)}
                        className="w-full py-3 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <GoogleMark />
                        <span>{authLoading ? 'Verificando acceso...' : 'Ingresar con Google'}</span>
                      </button>

                      {localAvailable && (
                        <>
                          <div className="relative flex items-center py-1">
                            <div className="flex-grow border-t border-zinc-200" />
                            <span className="px-3 text-[11px] text-zinc-400">o preferís</span>
                            <div className="flex-grow border-t border-zinc-200" />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAuthMethod('local');
                              setAuthError('');
                              setAuthNotice('');
                            }}
                            className="w-full py-2.5 px-4 bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-900 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Ingresar con cuenta local (correo y contraseña)</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-zinc-500 text-center pt-1">
                    ¿Todavía no tenés cuenta?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('register');
                        setAuthError('');
                        setAuthNotice('');
                      }}
                      className="font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Crear cuenta de cliente
                    </button>
                  </p>
                </div>
              )}

              {/* TAB: CREAR CUENTA DE CLIENTE (Local OR Google) */}
              {authTab === 'register' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                    <p className="text-xs font-medium text-amber-950 leading-relaxed">
                      {SELLER_TRIAL_NOTICE}
                    </p>
                  </div>

                  {renderMethodSwitcher()}

                  {authMethod === 'local' && localAvailable ? (
                    <form onSubmit={handleLocalAuthSubmit} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Nombre completo
                        </label>
                        <input
                          type="text"
                          required
                          minLength={2}
                          maxLength={100}
                          value={signupName}
                          onChange={(e) => setSignupName(e.target.value)}
                          placeholder="Ej. María González"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Nombre comercial (opcional)
                        </label>
                        <input
                          type="text"
                          maxLength={120}
                          value={signupBusiness}
                          onChange={(e) => setSignupBusiness(e.target.value)}
                          placeholder="Ej. Estudio Norte S.R.L."
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Teléfono de contacto (opcional)
                        </label>
                        <input
                          type="tel"
                          maxLength={32}
                          value={signupPhone}
                          onChange={(e) => setSignupPhone(e.target.value)}
                          placeholder="+54 11 5555-1234"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Correo electrónico
                        </label>
                        <input
                          type="email"
                          required
                          maxLength={120}
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          placeholder="cliente@correo.com"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Contraseña (mínimo 8 caracteres)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          maxLength={128}
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      {renderOptionalBankSection()}

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-2.5 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                      >
                        {authLoading ? 'Registrando...' : 'Crear cliente (cuenta local)'}
                      </button>

                      <div className="relative flex items-center py-0.5">
                        <div className="flex-grow border-t border-zinc-200" />
                        <span className="px-3 text-[11px] text-zinc-400">o registrate con</span>
                        <div className="flex-grow border-t border-zinc-200" />
                      </div>

                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => void handleGoogleAuth(true)}
                        className="w-full py-2.5 px-4 bg-white hover:bg-zinc-50 border border-zinc-300 disabled:opacity-60 text-zinc-900 text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <GoogleMark />
                        <span>Crear cuenta con Google</span>
                      </button>
                    </form>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleGoogleAuth(true);
                      }}
                      className="space-y-3.5"
                    >
                      <p className="text-xs text-zinc-600 leading-relaxed">
                        Completá tus datos opcionales y vinculá tu cuenta de Google para crear tu
                        cuenta de cliente o vendedor.
                      </p>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Nombre completo (opcional)
                        </label>
                        <input
                          type="text"
                          maxLength={100}
                          value={signupName}
                          onChange={(e) => setSignupName(e.target.value)}
                          placeholder="Ej. María González"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Nombre comercial (opcional)
                        </label>
                        <input
                          type="text"
                          maxLength={120}
                          value={signupBusiness}
                          onChange={(e) => setSignupBusiness(e.target.value)}
                          placeholder="Ej. Estudio Norte S.R.L."
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">
                          Teléfono de contacto (opcional)
                        </label>
                        <input
                          type="tel"
                          maxLength={32}
                          value={signupPhone}
                          onChange={(e) => setSignupPhone(e.target.value)}
                          placeholder="+54 11 5555-1234"
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                        />
                      </div>

                      {renderOptionalBankSection()}

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-3 px-4 bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <GoogleMark />
                        <span>{authLoading ? 'Creando cuenta...' : 'Crear cuenta con Google'}</span>
                      </button>

                      {localAvailable && (
                        <>
                          <div className="relative flex items-center py-0.5">
                            <div className="flex-grow border-t border-zinc-200" />
                            <span className="px-3 text-[11px] text-zinc-400">o preferís</span>
                            <div className="flex-grow border-t border-zinc-200" />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAuthMethod('local');
                              setAuthError('');
                              setAuthNotice('');
                            }}
                            className="w-full py-2.5 px-4 bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-900 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Crear cuenta local (correo y contraseña)</span>
                          </button>
                        </>
                      )}
                    </form>
                  )}

                  <p className="text-xs text-zinc-500 text-center pt-1">
                    ¿Ya tenés cuenta?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('login');
                        setAuthError('');
                        setAuthNotice('');
                      }}
                      className="font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Ingresar
                    </button>
                  </p>
                </div>
              )}
            </div>
          ) : (
              <div className="p-6 space-y-4">
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="flex items-center gap-3 pb-4 border-b border-zinc-200">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'Usuario'}
                        referrerPolicy="no-referrer"
                        className="w-11 h-11 rounded-full object-cover border border-zinc-200"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600">
                        <UserIcon className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-950 truncate">
                        {profile?.businessName || user.displayName || 'Usuario verificado'}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {user.email} · {isAdmin ? 'Administrador' : 'Cliente'}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const subInfo = getAccountSubscriptionInfo(
                      profile ? { ...profile, role: isAdmin ? 'admin' : profile.role } : null,
                    );
                    return (
                      <div
                        className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                          subInfo.isActive
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                            : 'bg-red-50/80 border-red-200 text-red-950'
                        }`}
                      >
                        <CalendarClock
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            subInfo.isActive ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        />
                        <div className="space-y-0.5">
                          <p className="font-semibold">
                            Fecha de ingreso: {formatShortDate(subInfo.joinedAtIso)} ·{' '}
                            {subInfo.statusLabel}
                          </p>
                          <p className="text-[11px] opacity-90">{subInfo.detailText}</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Nombre completo
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={100}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Nombre comercial
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Estudio Norte S.R.L."
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      maxLength={120}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Teléfono de contacto
                    </label>
                    <input
                      type="tel"
                      placeholder="+54 11 5555-1234"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={32}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">
                      Dirección predeterminada
                    </label>
                    <input
                      type="text"
                      placeholder="Av. Santa Fe 1420, Piso 3"
                      value={defaultAddress}
                      onChange={(e) => setDefaultAddress(e.target.value)}
                      maxLength={200}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">Ciudad</label>
                      <input
                        type="text"
                        placeholder="Buenos Aires"
                        value={defaultCity}
                        onChange={(e) => setDefaultCity(e.target.value)}
                        maxLength={80}
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        Código postal
                      </label>
                      <input
                        type="text"
                        placeholder="C1060"
                        value={defaultPostalCode}
                        onChange={(e) => setDefaultPostalCode(e.target.value)}
                        maxLength={20}
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                  </div>

                  {/* Optional Buyer Banking Details in Profile */}
                  <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/70 space-y-3">
                    <div className="flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-blue-700 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-zinc-900">
                          Datos Bancarios (opcional)
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          No obligatorio. Quedan guardados de forma privada en tu cuenta.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        CBU o CVU
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Ej. 0170099940000012345678"
                        value={bankCbuCvu}
                        onChange={(e) => setBankCbuCvu(e.target.value)}
                        maxLength={32}
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">Alias</label>
                      <input
                        type="text"
                        placeholder="Ej. juan.perez.banco"
                        value={bankAlias}
                        onChange={(e) => setBankAlias(e.target.value)}
                        maxLength={60}
                        className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        Nombre de la cuenta
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Juan Pérez — Caja de Ahorro"
                        value={bankAccountHolder}
                        onChange={(e) => setBankAccountHolder(e.target.value)}
                        maxLength={120}
                        className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full py-2.5 px-5 text-sm font-medium text-white bg-zinc-950 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                    >
                      {saving ? 'Guardando...' : 'Guardar datos'}
                    </button>
                  </div>
                </form>

                {/* Password Change Module */}
                {(() => {
                  const isEnvManagedLocalAdmin =
                    dbMode === 'local' && isAdmin && Boolean(localServerInfo?.envAdminConfigured);
                  const canEditPassword =
                    (dbMode === 'local' && !isEnvManagedLocalAdmin) ||
                    (dbMode === 'cloud' && canCurrentCloudUserChangePassword());

                  async function handleSubmitPasswordChange(e: React.FormEvent) {
                    e.preventDefault();
                    setPasswordError('');
                    setPasswordSuccess('');

                    if (!currentPassword) {
                      setPasswordError('Ingresá tu contraseña actual.');
                      return;
                    }
                    if (newPassword.length < 8) {
                      setPasswordError('La nueva contraseña debe tener al menos 8 caracteres.');
                      return;
                    }
                    if (newPassword !== confirmNewPassword) {
                      setPasswordError('La confirmación no coincide con la nueva contraseña.');
                      return;
                    }
                    if (newPassword === currentPassword) {
                      setPasswordError('La nueva contraseña debe ser diferente a la actual.');
                      return;
                    }

                    setChangingPassword(true);
                    try {
                      await changeAccountPassword(currentPassword, newPassword);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setPasswordSuccess('Contraseña actualizada correctamente.');
                      onNotifyToast('Contraseña actualizada correctamente.');
                    } catch (err) {
                      setPasswordError(
                        err instanceof Error
                          ? err.message
                          : 'No pudimos actualizar la contraseña.',
                      );
                    } finally {
                      setChangingPassword(false);
                    }
                  }

                  return (
                    <div className="border border-zinc-200 rounded-xl bg-zinc-50/70 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPasswordSection((prev) => !prev);
                          setPasswordError('');
                          setPasswordSuccess('');
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <KeyRound className="w-4 h-4 text-blue-700 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-zinc-900">
                              Cambiar contraseña
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              Actualizá tu clave de acceso de forma segura
                            </p>
                          </div>
                        </div>
                        {showPasswordSection ? (
                          <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                        )}
                      </button>

                      {showPasswordSection && (
                        <div className="px-4 pb-4 pt-3 border-t border-zinc-200 bg-white space-y-3">
                          {isEnvManagedLocalAdmin ? (
                            <p className="text-xs text-zinc-600 leading-relaxed">
                              La contraseña del administrador está gestionada mediante la
                              configuración del servidor (<code className="font-mono">LOCAL_ADMIN_PASSWORD</code>)
                              y debe actualizarse desde esa variable de entorno.
                            </p>
                          ) : !canEditPassword ? (
                            <p className="text-xs text-zinc-600 leading-relaxed">
                              Ingresaste con tu cuenta de Google. La contraseña de las cuentas
                              Google se administra directamente desde la configuración de seguridad
                              de tu cuenta de Google.
                            </p>
                          ) : (
                            <form onSubmit={handleSubmitPasswordChange} className="space-y-3">
                              {passwordError && (
                                <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                                  {passwordError}
                                </div>
                              )}
                              {passwordSuccess && (
                                <div className="p-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                                  {passwordSuccess}
                                </div>
                              )}

                              <div>
                                <label className="block text-xs font-medium text-zinc-700 mb-1">
                                  Contraseña actual
                                </label>
                                <input
                                  type="password"
                                  required
                                  autoComplete="current-password"
                                  maxLength={128}
                                  value={currentPassword}
                                  onChange={(e) => setCurrentPassword(e.target.value)}
                                  placeholder="••••••••"
                                  className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-zinc-700 mb-1">
                                  Nueva contraseña (mínimo 8 caracteres)
                                </label>
                                <input
                                  type="password"
                                  required
                                  autoComplete="new-password"
                                  minLength={8}
                                  maxLength={128}
                                  value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
                                  placeholder="••••••••"
                                  className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-zinc-700 mb-1">
                                  Confirmar nueva contraseña
                                </label>
                                <input
                                  type="password"
                                  required
                                  autoComplete="new-password"
                                  minLength={8}
                                  maxLength={128}
                                  value={confirmNewPassword}
                                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                                  placeholder="••••••••"
                                  className="w-full px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
                                />
                              </div>

                              <button
                                type="submit"
                                disabled={changingPassword}
                                className="w-full py-2 px-4 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                              >
                                {changingPassword ? 'Actualizando...' : 'Actualizar contraseña'}
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between py-2 border-t border-zinc-100">
                  <div className="flex items-center gap-2 text-xs text-zinc-700">
                    <Bell className="w-4 h-4 text-blue-700" />
                    <span>
                      Push navegador:{' '}
                      <strong>
                        {pushPermission === 'granted'
                          ? 'Activadas'
                          : pushPermission === 'denied'
                            ? 'Bloqueadas'
                            : 'Desactivadas'}
                      </strong>
                    </span>
                  </div>
                  {pushPermission !== 'granted' && pushPermission !== 'unsupported' && (
                    <button
                      type="button"
                      onClick={onEnablePush}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Activar
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-start pt-1 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={async () => {
                      await onSignOut();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:text-red-600 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Cerrar sesión
                  </button>
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
}
