import axios from 'axios';

// Instance Axios dédiée superadmin — token stocké séparément
const saApi = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

saApi.interceptors.request.use(config => {
  const token = localStorage.getItem('superadmin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

saApi.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('superadmin_token');
      localStorage.removeItem('superadmin_user');
      window.location.href = '/superadmin/login';
    }
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  },
);

export default saApi;

export function getSuperAdminUser(): { id: string; name: string; email: string } | null {
  try {
    const raw = localStorage.getItem('superadmin_user');
    return raw ? (JSON.parse(raw) as { id: string; name: string; email: string }) : null;
  } catch { return null; }
}

export function setSuperAdminSession(token: string, user: { id: string; name: string; email: string }) {
  localStorage.setItem('superadmin_token', token);
  localStorage.setItem('superadmin_user', JSON.stringify(user));
}

export function clearSuperAdminSession() {
  localStorage.removeItem('superadmin_token');
  localStorage.removeItem('superadmin_user');
}
