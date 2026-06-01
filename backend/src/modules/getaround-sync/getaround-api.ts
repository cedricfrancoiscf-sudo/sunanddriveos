import axios, { type AxiosInstance } from 'axios';

const BASE_URL = 'https://api-eu.getaround.com/owner/v1';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 429) {
        const wait = Math.pow(2, attempt) * 2000;
        console.log(`[RateLimit] 429 — attente ${wait / 1000}s (tentative ${attempt + 1}/${maxRetries})`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`[RateLimit] Max ${maxRetries} tentatives atteint`);
}

// GET /cars/{id}.json — champs exacts selon OpenAPI spec
export interface GetaroundCar {
  id: number;
  state: string;          // 'active' | 'inactive' | 'pending_approval' | 'deleted'
  plate_number: string;
  brand: string;
  model: string;
  display_address: string;  // deprecated, utiliser address
  address: string;
}

// GET /rentals/{id}.json — champs exacts selon OpenAPI spec (pas de state, pas de driver)
export interface GetaroundRental {
  id: number;
  car_id: number;
  user_id: number;
  starts_at: string;
  ends_at: string;
  booked_at: string;
  price: number;          // en centimes (ex: 3500 = 35,00 €)
  insurance_fee: number;  // en centimes
}

// GET /users/{id}.json — champs exacts selon OpenAPI spec
export interface GetaroundUser {
  id: number;
  first_name: string;
  last_name: string;
  phone_number: string;
  address_line1: string;
  address_line2?: string;    // seul champ optionnel selon la spec
  postal_code: string;
  city: string;
  country: string;
  birth_date: string;
  license_country: string;
  license_first_issue_date: string;
  license_number: string;
}

// GET /rentals/{rental_id}/checkin.json
export interface GetaroundCheckin {
  rental_id: number;
  mileage?: number;
  fuel_level?: number;
  occurred_at: string;
}

// GET /rentals/{rental_id}/checkout.json
export interface GetaroundCheckout {
  rental_id: number;
  mileage: number | null;
  fuel_level: number | null;
  distance_driven: number;
  occurred_at: string;
}

// GET /invoices.json
export interface GetaroundInvoiceApi {
  id: number;
  rental_id?: number;
  total_price: number;  // centimes
  currency: string;
  pdf_url?: string;
  emitted_at?: string;
}

// GET /payouts.json
export interface GetaroundPayoutApi {
  id: number;
  amount: number;       // centimes
  currency: string;
  completed_at?: string;
}

// GET /rentals/{rental_id}/messages/{id}.json
export interface GetaroundMessage {
  id: number;
  rental_id: number;
  sending_user_id: number;
  sent_at: string;
  content: string;
}

// Format attendu par Getaround : YYYY-MM-DD
function toGetaroundDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Découpe une plage en tranches ≤ 30 jours, du plus récent au plus ancien
function splitInto30DayWindows(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(end);
  while (cursor > start) {
    const windowStart = new Date(Math.max(
      cursor.getTime() - 30 * 86_400_000,
      start.getTime()
    ));
    windows.push({ start: new Date(windowStart), end: new Date(cursor) });
    cursor = windowStart;
  }
  return windows;
}

// Récupère toutes les pages d'un endpoint paginé (retourne des éléments partiels {id} ou {rental_id})
// Les params sont injectés directement dans l'URL (pas via axios params) pour éviter
// l'encodage des ":" en "%3A" qui provoque des 422 sur l'API Getaround.
async function fetchAllPages<T>(
  client: AxiosInstance,
  url: string,
  params: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const allParams = { ...params, page: String(page), per_page: '30' };
    const qs = Object.entries(allParams).map(([k, v]) => `${k}=${v}`).join('&');
    const fullUrl = `${url}?${qs}`;
    console.log(`[API] GET ${url} (page ${page})`);
    const res = await withRetry(() => client.get<T[]>(fullUrl));
    await sleep(300);
    if (!Array.isArray(res.data)) {
      console.error('[API] Réponse inattendue (non-array):', res.status, JSON.stringify(res.data).slice(0, 200));
      break;
    }
    const items = res.data;
    all.push(...items);
    const linkHeader = res.headers['link'] as string | undefined;
    if (!linkHeader?.includes('rel="next"')) break;
    page++;
  }
  return all;
}

export function createGetaroundClient(apiKey: string) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });

  return {
    // /cars.json retourne uniquement [{id}] — il faut appeler /cars/{id}.json pour chaque
    async getCars(): Promise<GetaroundCar[]> {
      const ids = await fetchAllPages<{ id: number }>(client, '/cars.json', {});
      const cars: GetaroundCar[] = [];
      for (const { id } of ids) {
        const res = await withRetry(() => client.get<GetaroundCar>(`/cars/${id}.json`));
        cars.push(res.data);
        await sleep(300);
      }
      return cars;
    },

    async getCar(id: number): Promise<GetaroundCar> {
      const res = await withRetry(() => client.get<GetaroundCar>(`/cars/${id}.json`));
      return res.data;
    },

    // /rentals.json retourne uniquement [{id}] — il faut appeler /rentals/{id}.json pour chaque
    // start_date et end_date sont OBLIGATOIRES, plage max 30 jours → découpage automatique
    // Les fenêtres sont traitées du plus récent au plus ancien ; un 422 stoppe la recherche historique
    async getRentals(startDate: Date, endDate: Date): Promise<GetaroundRental[]> {
      const windows = splitInto30DayWindows(startDate, endDate);

      // Collecter tous les IDs uniques sur toutes les fenêtres
      const seenIds = new Set<number>();
      for (const w of windows) {
        console.log(`[Sync] Fenêtre : ${toGetaroundDate(w.start)} → ${toGetaroundDate(w.end)}`);
        try {
          const chunk = await fetchAllPages<{ id: number }>(client, '/rentals.json', {
            start_date: toGetaroundDate(w.start),
            end_date: toGetaroundDate(w.end),
          });
          for (const { id } of chunk) seenIds.add(id);
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } }).response?.status;
          if (status === 422) {
            console.log(`[Sync] Fenêtre ${toGetaroundDate(w.start)} → ${toGetaroundDate(w.end)} : 422 reçu — arrêt de la recherche historique, ${seenIds.size} location(s) déjà collectée(s)`);
            break;
          }
          throw err;
        }
      }

      // Récupérer le détail de chaque location
      console.log('[Sync] IDs locations collectés:', seenIds.size);
      const rentals: GetaroundRental[] = [];
      for (const id of seenIds) {
        try {
          console.log('[Sync] Appel détail location:', id);
          const res = await withRetry(() => client.get<GetaroundRental>(`/rentals/${id}.json`));
          await sleep(300);
          rentals.push(res.data);
          console.log('[Sync] Location récupérée:', id);
        } catch (err: unknown) {
          console.error('[Sync] Erreur détail location', id, err);
        }
      }
      return rentals;
    },

    async getRental(id: number): Promise<GetaroundRental> {
      const res = await withRetry(() => client.get<GetaroundRental>(`/rentals/${id}.json`));
      return res.data;
    },

    async getUser(id: number): Promise<GetaroundUser> {
      const res = await withRetry(() => client.get<GetaroundUser>(`/users/${id}.json`));
      return res.data;
    },

    async getCheckin(rentalId: number): Promise<GetaroundCheckin> {
      const res = await withRetry(() => client.get<GetaroundCheckin>(`/rentals/${rentalId}/checkin.json`));
      return res.data;
    },

    async getCheckout(rentalId: number): Promise<GetaroundCheckout> {
      const res = await withRetry(() => client.get<GetaroundCheckout>(`/rentals/${rentalId}/checkout.json`));
      return res.data;
    },

    // /rentals/{rental_id}/messages.json → [{id}] seulement, puis /messages/{id}.json pour chaque
    async getMessages(rentalId: number): Promise<GetaroundMessage[]> {
      const ids = await fetchAllPages<{ id: number }>(client, `/rentals/${rentalId}/messages.json`, {});
      const messages: GetaroundMessage[] = [];
      for (const { id } of ids) {
        const res = await withRetry(() => client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`));
        messages.push(res.data);
        await sleep(300);
      }
      return messages;
    },

    async getMessage(rentalId: number, id: number): Promise<GetaroundMessage> {
      const res = await withRetry(() => client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`));
      return res.data;
    },

    async sendMessage(rentalId: number, content: string): Promise<GetaroundMessage> {
      const res = await withRetry(() => client.post<GetaroundMessage>(
        `/rentals/${rentalId}/messages.json`,
        { content },
      ));
      return res.data;
    },

    async createUnavailability(carId: number, startsAt: Date, endsAt: Date, reason: string): Promise<void> {
      await withRetry(() => client.post(`/cars/${carId}/unavailabilities.json`, {
        starts_at: toGetaroundDate(startsAt),
        ends_at: toGetaroundDate(endsAt),
        reason,
      }));
    },

    async deleteUnavailability(carId: number, startsAt: Date, endsAt: Date): Promise<void> {
      await withRetry(() => client.delete(`/cars/${carId}/unavailabilities.json`, {
        data: { starts_at: toGetaroundDate(startsAt), ends_at: toGetaroundDate(endsAt) },
      }));
    },

    async getInvoices(): Promise<GetaroundInvoiceApi[]> {
      return fetchAllPages<GetaroundInvoiceApi>(client, '/invoices.json', {});
    },

    async getPayouts(): Promise<GetaroundPayoutApi[]> {
      return fetchAllPages<GetaroundPayoutApi>(client, '/payouts.json', {});
    },
  };
}
