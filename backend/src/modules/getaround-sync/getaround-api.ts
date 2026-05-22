import axios, { type AxiosInstance } from 'axios';

const BASE_URL = 'https://api-eu.getaround.com/owner/v1';

// Champs réellement retournés par GET /cars/{id}.json
export interface GetaroundCar {
  id: number;
  state: string;          // 'active' | 'inactive'
  plate_number: string;
  brand: string;
  model: string;
  display_address?: string;
  address?: string;
}

// Champs réellement retournés par GET /rentals/{id}.json
export interface GetaroundRental {
  id: number;
  car_id: number;
  user_id: number;
  starts_at: string;
  ends_at: string;
  booked_at?: string;
  price: number;          // Montant en centimes
  insurance_fee?: number;
  state?: string;         // Peut être absent selon le contexte
}

export interface GetaroundUser {
  id: number;
  first_name: string;
  last_name: string;
  phone_number?: string;
}

// Découpe une plage en tranches de 30 jours max (limite API Getaround)
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

// Récupère toutes les pages d'un endpoint paginé
async function fetchAllPages<T>(
  client: AxiosInstance,
  url: string,
  params: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const res = await client.get<T[]>(url, {
      params: { ...params, page: String(page), per_page: '200' },
    });
    const items = Array.isArray(res.data) ? res.data : [];
    all.push(...items);
    // Arrêt si moins d'une page pleine ou pas de header "next"
    const linkHeader = res.headers['link'] as string | undefined;
    if (!linkHeader?.includes('rel="next"') || items.length < 200) break;
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
    // GET /cars.json — liste toutes les voitures du compte
    async getCars(): Promise<GetaroundCar[]> {
      return fetchAllPages<GetaroundCar>(client, '/cars.json', {});
    },

    // GET /cars/{id}.json — détail d'une voiture
    async getCar(id: number): Promise<GetaroundCar> {
      const res = await client.get<GetaroundCar>(`/cars/${id}.json`);
      return res.data;
    },

    // GET /rentals.json — locations entre deux dates (tranches ≤ 30j, paginées)
    async getRentals(startDate: Date, endDate: Date): Promise<GetaroundRental[]> {
      const windows = splitInto30DayWindows(startDate, endDate);
      const allRentals: GetaroundRental[] = [];
      for (const w of windows) {
        const chunk = await fetchAllPages<GetaroundRental>(client, '/rentals.json', {
          start_date: w.start.toISOString(),
          end_date: w.end.toISOString(),
        });
        allRentals.push(...chunk);
      }
      // Dédoublonner par id (une location peut apparaître dans deux fenêtres)
      const seen = new Set<number>();
      return allRentals.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    },

    // GET /rentals/{id}.json — détail d'une location
    async getRental(id: number): Promise<GetaroundRental> {
      const res = await client.get<GetaroundRental>(`/rentals/${id}.json`);
      return res.data;
    },

    // GET /users/{id}.json — informations conducteur
    async getUser(id: number): Promise<GetaroundUser> {
      const res = await client.get<GetaroundUser>(`/users/${id}.json`);
      return res.data;
    },
  };
}
