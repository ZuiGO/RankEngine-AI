import {
  createContext,
  useContext,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import api from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────
interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface UserProfile {
  id: string;
  email: string;
  role: string;
  companyName: string;
  emailDigestEnabled: boolean;
  hasCompletedOnboarding: boolean;
  createdAt: string;
  dataProviderCallsThisMonth?: number;
  dataProviderMonthlyLimit?: number;
  dataProviderQuotaResetAt?: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role: string, companyName: string) => Promise<void>;
  logout: () => void;
}

// ── Context ────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

// ── Helper: parse JWT payload without a library ───────────────────────────
function parseJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      userId: payload.userId ?? payload.sub ?? '',
      name: payload.name ?? '',
      email: payload.email ?? '',
      role: payload.role ?? 'user',
    };
  } catch {
    return null;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('re_token')
  );
  const [user, setUser] = useState<AuthUser | null>(() => {
    const t = localStorage.getItem('re_token');
    return t ? parseJwt(t) : null;
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await api.get<UserProfile>('/auth/me');
      setProfile(data);
    } catch {
      // silently ignore
    }
  }, []);

  const persist = (newToken: string) => {
    localStorage.setItem('re_token', newToken);
    setToken(newToken);
    setUser(parseJwt(newToken));
  };

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ token: string }>('/auth/login', {
      email,
      password,
    });
    persist(data.token);
  }, []);

  const register = useCallback(
    async (email: string, password: string, role: string, companyName: string) => {
      const { data } = await api.post<{ token: string }>('/auth/register', {
        email,
        password,
        role,
        companyName,
      });
      persist(data.token);
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem('re_token');
    setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, profile, refreshProfile, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
