import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken } from '@/api/client';
import { isPublicRoute } from '@/lib/publicRoutes';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'viewer';
  organizationId: string | null;
  isSuperAdmin: boolean;
  impersonated?: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Public pages (the booking microsite) must work with zero session — skip the
    // check entirely rather than let a guaranteed-401 `/auth/me` call (no visitor there
    // has a token) feed the global 401 handler and bounce them to /login.
    if (isPublicRoute(location.pathname)) {
      setLoading(false);
      return;
    }
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    setToken(r.token);
    setUser(r.user);
  };

  const loginWithToken = (token: string, nextUser: User) => {
    setToken(token);
    setUser(nextUser);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    location.assign('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithToken, logout }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function roleAtLeast(role: User['role'] | undefined, min: User['role']) {
  const rank = { viewer: 1, manager: 2, admin: 3 };
  return role ? rank[role] >= rank[min] : false;
}
