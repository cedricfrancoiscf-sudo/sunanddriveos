import { api } from '../../utils/api';
import { captureGPS } from '../../utils/geoCapture';

export interface Vehicle {
  id: string;
  getaroundId: string | null;
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  photoUrl: string | null;
  currentMileage: number;
  healthScore: number;
  isActive: boolean;
  getaroundAccount: { id: string; name: string } | null;
  thirdPartyOwner: { id: string; name: string } | null;
  _count?: { rentals: number; maintenances: number };
}

export interface VehicleDetail extends Vehicle {
  documents: Array<{ id: string; type: string; name: string; expiryDate: string | null }>;
  technicalControls: Array<{ id: string; performedAt: string; expiryAt: string; result: string }>;
  maintenances: Array<{ id: string; type: string; performedAt: string; nextServiceDate: string | null }>;
  blockings: Array<{ id: string; startAt: string; endAt: string; reason: string | null; type: string }>;
  accessories: Array<{ vehicleId: string; accessoryId: string; accessory: { id: string; name: string; description: string | null } }>;
}

export interface GetaroundAccount {
  id: string;
  name: string;
  isActive: boolean;
  lastSyncAt: string | null;
  syncStatus: string | null;
  syncError: string | null;
  _count: { vehicles: number };
}

export const vehiclesApi = {
  list: (includeInactive = false) =>
    api.get<{ vehicles: Vehicle[] }>('/vehicles', { params: { includeInactive } }).then((r) => r.data.vehicles),

  get: (id: string) =>
    api.get<{ vehicle: VehicleDetail }>(`/vehicles/${id}`).then((r) => r.data.vehicle),

  create: (data: Omit<Vehicle, 'id' | 'getaroundId' | 'healthScore' | 'isActive' | 'getaroundAccount' | 'thirdPartyOwner' | '_count'>) =>
    api.post<{ vehicle: Vehicle }>('/vehicles', data).then((r) => r.data.vehicle),

  update: (id: string, data: Partial<Vehicle>) =>
    api.put<{ vehicle: Vehicle }>(`/vehicles/${id}`, data).then((r) => r.data.vehicle),

  delete: (id: string) =>
    api.delete(`/vehicles/${id}`),
};

export interface VehicleCarkeeper {
  id: string;
  vehicleId: string;
  userId: string;
  assignedAt: string;
  user: { id: string; name: string; email: string };
}

export interface VehiclePhoto {
  id: string;
  url: string;
  filename: string;
  uploadedAt: string;
  uploadedById: string | null;
  isCover: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  takenAt: string | null;
  deviceInfo: string | null;
}

export const vehiclePhotosApi = {
  list: (vehicleId: string) =>
    api.get<{ photos: VehiclePhoto[] }>(`/vehicles/${vehicleId}/photos`).then(r => r.data.photos),

  upload: (vehicleId: string, file: File, onProgress?: (pct: number) => void): Promise<{ photo: VehiclePhoto; gpsWarning?: boolean }> =>
    new Promise((resolve, reject) => {
      captureGPS().then((geo) => {
        const fd = new FormData();
        fd.append('photo', file);
        if (geo) {
          fd.append('latitude',   String(geo.latitude));
          fd.append('longitude',  String(geo.longitude));
          fd.append('accuracy',   String(geo.accuracy));
          fd.append('takenAt',    geo.takenAt);
          fd.append('deviceInfo', geo.deviceInfo);
        }
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${api.defaults.baseURL ?? ''}/vehicles/${vehicleId}/photos`);
        const token = localStorage.getItem('auth_token');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        const tenantId = localStorage.getItem('tenantId');
        if (tenantId) xhr.setRequestHeader('X-Tenant-ID', tenantId);
        if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText) as { photo: VehiclePhoto };
            resolve({ photo: data.photo, gpsWarning: !geo });
          } else {
            reject(new Error(`Upload échoué (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Erreur réseau upload'));
        xhr.send(fd);
      }).catch(() => reject(new Error('Erreur GPS/upload')));
    }),

  delete: (vehicleId: string, photoId: string) =>
    api.delete(`/vehicles/${vehicleId}/photos/${photoId}`),

  setCover: (vehicleId: string, photoId: string) =>
    api.patch<{ photo: VehiclePhoto }>(`/vehicles/${vehicleId}/photos/${photoId}/cover`).then(r => r.data.photo),
};

export const vehicleCarkeepersApi = {
  list: (vehicleId: string) =>
    api.get<{ carkeepers: VehicleCarkeeper[] }>(`/vehicles/${vehicleId}/carkeepers`).then((r) => r.data.carkeepers),

  assign: (vehicleId: string, userId: string) =>
    api.post<{ assignment: VehicleCarkeeper }>(`/vehicles/${vehicleId}/carkeepers`, { userId }).then((r) => r.data.assignment),

  remove: (vehicleId: string, userId: string) =>
    api.delete(`/vehicles/${vehicleId}/carkeepers/${userId}`),
};

export interface VehicleRating {
  id: string;
  vehicleId: string;
  rating: number;
  reviewCount: number;
  period: string;
  keywords: string[];
  notes: string | null;
  createdAt: string;
}

export const vehicleRatingsApi = {
  list: (vehicleId: string) =>
    api.get<{ ratings: VehicleRating[] }>(`/vehicles/${vehicleId}/ratings`).then(r => r.data.ratings),

  upsert: (vehicleId: string, data: { rating: number; reviewCount?: number; keywords?: string[]; notes?: string; period?: string }) =>
    api.post<{ rating: VehicleRating }>(`/vehicles/${vehicleId}/ratings`, data).then(r => r.data.rating),
};

export const getaroundSyncApi = {
  listAccounts: () =>
    api.get<{ accounts: GetaroundAccount[] }>('/getaround-sync/accounts').then((r) => r.data.accounts),

  createAccount: (name: string, apiKey: string) =>
    api.post<{ account: GetaroundAccount }>('/getaround-sync/accounts', { name, apiKey }).then((r) => r.data.account),

  deleteAccount: (accountId: string) =>
    api.delete(`/getaround-sync/accounts/${accountId}`),

  updateAccountKey: (accountId: string, apiKey: string) =>
    api.put(`/getaround-sync/accounts/${accountId}/key`, { apiKey }),

  syncAccount: (accountId: string) =>
    api.post<{ vehicles: { created: number; updated: number; errors: string[] } }>(`/getaround-sync/sync/${accountId}`).then((r) => r.data.vehicles),

  syncRentals: (accountId: string, from?: string, to?: string) =>
    api.post<{ rentals: { created: number; updated: number; errors: string[] } }>(`/getaround-sync/sync-rentals/${accountId}`, {}, { params: from ? { from, to } : {} }).then((r) => r.data.rentals),

  syncAll: () =>
    api.post<{ results: Array<{ accountName: string; created: number; updated: number }> }>('/getaround-sync/sync-all').then((r) => r.data.results),
};
