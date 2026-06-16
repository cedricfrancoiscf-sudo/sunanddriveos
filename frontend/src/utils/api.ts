import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Pré-charge le token stocké dans les defaults au démarrage
const _storedToken = localStorage.getItem('auth_token');
if (_storedToken) {
  api.defaults.headers.common['Authorization'] = `Bearer ${_storedToken}`;
}

// Injecte le JWT à chaque requête (fallback si defaults non encore défini)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirige vers /login si le token est expiré, /upgrade si trial expiré, /blocked si tenant suspendu
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const err = error as { response?: { status?: number; data?: { error?: string } } };
    const status = err.response?.status;
    const errorCode = err.response?.data?.error;
    const currentPath = window.location.pathname;

    if (status === 403 && errorCode === 'TENANT_SUSPENDED') {
      if (currentPath !== '/blocked') {
        window.location.href = '/blocked';
      }
      return Promise.reject(error);
    }

    if (status === 402) {
      if (currentPath !== '/login' && currentPath !== '/upgrade') {
        window.location.href = '/upgrade';
      }
    }

    if (status === 401) {
      if (currentPath !== '/login') {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);
