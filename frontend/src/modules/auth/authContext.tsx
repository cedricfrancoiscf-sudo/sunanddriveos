import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role?: string;
  roles?: string[];
  isSuperAdmin?: boolean;
  plan?: string;
  trialEndsAt?: string | null;
  hasActiveSubscription?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string, companySlug?: string) => Promise<void>;
  loginSuperAdmin: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const COMPANY_SLUG = import.meta.env.VITE_COMPANY_SLUG ?? 'sun-and-drive';

function loadStoredAuth(): { user: AuthUser | null; token: string | null } {
  try {
    const token = localStorage.getItem('auth_token');
    const raw = localStorage.getItem('auth_user');
    const user: AuthUser | null = raw ? (JSON.parse(raw) as AuthUser) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const stored = loadStoredAuth();

  const [user, setUser] = useState<AuthUser | null>(stored.user);
  const [token, setToken] = useState<string | null>(stored.token);
  const [isLoading, setIsLoading] = useState(false);

  const saveAuth = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('auth_user', JSON.stringify(newUser));
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
    setUser(newUser);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    delete api.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  }, []);

  // Vérifie que le token stocké est encore valide au démarrage
  useEffect(() => {
    if (!stored.token) return;

    const endpoint = stored.user?.isSuperAdmin ? '/auth/superadmin/me' : '/auth/me';
    api
      .get(endpoint)
      .then((res) => {
        setUser(res.data.user as AuthUser);
      })
      .catch(() => {
        clearAuth();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (email: string, password: string, companySlug?: string) => {
      setIsLoading(true);
      try {
        const res = await api.post('/auth/login', {
          email,
          password,
          companySlug: companySlug ?? COMPANY_SLUG,
        });
        const data = res.data as { token: string; user: AuthUser };
        saveAuth(data.token, data.user);
      } finally {
        setIsLoading(false);
      }
    },
    [saveAuth],
  );

  const loginSuperAdmin = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      try {
        const res = await api.post('/auth/superadmin/login', { email, password });
        const data = res.data as { token: string; user: AuthUser };
        saveAuth(data.token, data.user);
      } finally {
        setIsLoading(false);
      }
    },
    [saveAuth],
  );

  const logout = useCallback(() => {
    clearAuth();
  }, [clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: Boolean(user && token),
      login,
      loginSuperAdmin,
      logout,
    }),
    [user, token, isLoading, login, loginSuperAdmin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
