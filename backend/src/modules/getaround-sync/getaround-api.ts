import axios, { type AxiosInstance } from 'axios';

const BASE_URL = 'https://api-eu.getaround.com/owner/v1';

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

// GET /rentals/{rental_id}/messages/{id}.json
export interface GetaroundMessage {
  id: number;
  rental_id: number;
  sending_user_id: number;
  sent_at: string;
  content: string;
}

// Format exact attendu par l'API Getaround : 2024-01-01T00:00:00Z (sans millisecondes)
function toGetaroundDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Découpe une plage en tranches ≤ 30 jours (limite API Getaround)
function splitInto30DayWindows(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const windowEnd = new Date(Math.min(cursor.getTime() + 30 * 86_400_000, end.getTime()));
    windows.push({ start: new Date(cursor), end: windowEnd });
    cursor = windowEnd;
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
    console.log(`[API] GET ${fullUrl}`);
    const res = await client.get<T[]>(fullUrl);
    await new Promise(r => setTimeout(r, 300));
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
        const res = await client.get<GetaroundCar>(`/cars/${id}.json`);
        cars.push(res.data);
      }
      return cars;
    },

    async getCar(id: number): Promise<GetaroundCar> {
      const res = await client.get<GetaroundCar>(`/cars/${id}.json`);
      return res.data;
    },

    // /rentals.json retourne uniquement [{id}] — il faut appeler /rentals/{id}.json pour chaque
    // start_date et end_date sont OBLIGATOIRES, plage max 30 jours → découpage automatique
    async getRentals(startDate: Date, endDate: Date): Promise<GetaroundRental[]> {
      const windows = splitInto30DayWindows(startDate, endDate);

      // Collecter tous les IDs uniques sur toutes les fenêtres
      const seenIds = new Set<number>();
      for (const w of windows) {
        const chunk = await fetchAllPages<{ id: number }>(client, '/rentals.json', {
          start_date: toGetaroundDate(w.start),
          end_date: toGetaroundDate(w.end),
        });
        for (const { id } of chunk) seenIds.add(id);
      }

      // Récupérer le détail de chaque location
      console.log('[Sync] IDs locations collectés:', seenIds.size);
      const rentals: GetaroundRental[] = [];
      for (const id of seenIds) {
        const res = await client.get<GetaroundRental>(`/rentals/${id}.json`);
        await new Promise(r => setTimeout(r, 300));
        rentals.push(res.data);
      }
      return rentals;
    },

    async getRental(id: number): Promise<GetaroundRental> {
      const res = await client.get<GetaroundRental>(`/rentals/${id}.json`);
      return res.data;
    },

    async getUser(id: number): Promise<GetaroundUser> {
      const res = await client.get<GetaroundUser>(`/users/${id}.json`);
      return res.data;
    },

    async getCheckin(rentalId: number): Promise<GetaroundCheckin> {
      const res = await client.get<GetaroundCheckin>(`/rentals/${rentalId}/checkin.json`);
      return res.data;
    },

    async getCheckout(rentalId: number): Promise<GetaroundCheckout> {
      const res = await client.get<GetaroundCheckout>(`/rentals/${rentalId}/checkout.json`);
      return res.data;
    },

    // /rentals/{rental_id}/messages.json → [{id}] seulement, puis /messages/{id}.json pour chaque
    async getMessages(rentalId: number): Promise<GetaroundMessage[]> {
      const ids = await fetchAllPages<{ id: number }>(client, `/rentals/${rentalId}/messages.json`, {});
      const messages: GetaroundMessage[] = [];
      for (const { id } of ids) {
        const res = await client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`);
        messages.push(res.data);
      }
      return messages;
    },

    async getMessage(rentalId: number, id: number): Promise<GetaroundMessage> {
      const res = await client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`);
      return res.data;
    },
  };
}
