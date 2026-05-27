import { api } from './api';

export async function trackEvent(module: string, action: string): Promise<void> {
  try { await api.post('/tenant-events', { module, action }); } catch { /* silencieux */ }
}
