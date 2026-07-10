import axios, { type AxiosInstance } from 'axios';

const BASE_URL = 'https://api-eu.getaround.com/owner/v1';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ─── Token-bucket rate limiter ───────────────────────────────────────────────

class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private lastRefill: number;
  private readonly refillRatePerMs: number; // tokens per millisecond

  constructor(maxPerMinute: number) {
    this.maxTokens = maxPerMinute;
    this.tokens = maxPerMinute;
    this.lastRefill = Date.now();
    this.refillRatePerMs = maxPerMinute / 60_000;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until we have a token
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    await sleep(waitMs);
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }
}

// ─── Per-run API call counters ────────────────────────────────────────────────

export interface ApiCallCounters {
  total: number;
  cars: number;
  rentals: number;
  messages: number;
  payouts: number;
  invoices: number;
  checkins: number;
  unavailabilities: number;
  rateLimitHits: number;
  firstRateLimitAt: string | null;
  firstRateLimitResource: string | null;
}

// ─── Interfaces API Getaround ─────────────────────────────────────────────────

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

// GET /invoices.json (compte) ou /rentals/:id/invoices.json (par location)
export interface GetaroundInvoiceCharge {
  type: string;
  amount: number; // centimes, peut être négatif pour les remises
}

export interface GetaroundInvoiceApi {
  id: number;
  rental_id?: number;
  total_price: number;  // centimes
  currency: string;
  pdf_url?: string;
  emitted_at?: string;
  charges?: GetaroundInvoiceCharge[];
}

export interface ChargeBreakdown {
  basePrice: number;
  extraDistanceFee: number;
  insuranceFee: number;
  assistanceFee: number;
  deliveryFee: number;
  lateReturnFee: number;
  gasRefillFee: number;
  driverMessFee: number;
  damageCompensation: number;
  grossRevenue: number;
  ownerPayout: number;
}

export function parseInvoiceCharges(invoices: GetaroundInvoiceApi[]): ChargeBreakdown {
  const r: ChargeBreakdown = {
    basePrice: 0, extraDistanceFee: 0, insuranceFee: 0,
    assistanceFee: 0, deliveryFee: 0, lateReturnFee: 0,
    gasRefillFee: 0, driverMessFee: 0, damageCompensation: 0,
    grossRevenue: 0, ownerPayout: 0,
  };

  for (const inv of invoices) {
    // total_price positif = virement propriétaire
    if (inv.total_price && inv.total_price > 0) {
      r.ownerPayout += inv.total_price / 100;
    }
    for (const charge of (inv.charges ?? [])) {
      const amount = Math.abs((charge.amount ?? 0) / 100); // centimes → euros
      switch (charge.type) {
        case 'driver_rental_payment':
          r.basePrice += amount; r.grossRevenue += amount; break;
        case 'extra_distance_payment':
          r.extraDistanceFee += amount; r.grossRevenue += amount; break;
        case 'self_insurance_payment':
        case 'additional_self_insurance_payment':
          r.insuranceFee += amount; r.grossRevenue += amount; break;
        case 'assistance_fee':
          r.assistanceFee += amount; r.grossRevenue += amount; break;
        case 'delivery_fee':
          r.deliveryFee += amount; r.grossRevenue += amount; break;
        case 'driver_late_return_fee':
          r.lateReturnFee += amount; r.grossRevenue += amount; break;
        case 'driver_gas_refill_fee':
          r.gasRefillFee += amount; r.grossRevenue += amount; break;
        case 'driver_mess_fee':
          r.driverMessFee += amount; r.grossRevenue += amount; break;
        case 'damage_compensation':
          r.damageCompensation += amount; r.grossRevenue += amount; break;
      }
    }
  }
  return r;
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

// L'API Getaround attend un format ISO8601 date-time (RFC3339) sans millisecondes
// ex: 2026-05-02T00:00:00Z — PAS .000Z, PAS un format date seul YYYY-MM-DD
// Les payouts exigent le 1er du mois à minuit UTC exact → on force minuit avant sérialisation
function toGetaroundDate(d: Date): string {
  const midnight = new Date(d);
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight.toISOString().replace(/\.\d{3}Z$/, 'Z');
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

export function createGetaroundClient(apiKey: string) {
  const client: AxiosInstance = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });

  // 250 req/min — marge de 50 req/min sous la limite Getaround (300/min)
  const limiter = new RateLimiter(250);

  const counters: ApiCallCounters = {
    total: 0,
    cars: 0,
    rentals: 0,
    messages: 0,
    payouts: 0,
    invoices: 0,
    checkins: 0,
    unavailabilities: 0,
    rateLimitHits: 0,
    firstRateLimitAt: null,
    firstRateLimitResource: null,
  };

  // Appel throttlé avec retry exponentiel sur 429 — le run reprend, n'est pas abandonné
  async function callApi<T>(resource: keyof Omit<ApiCallCounters, 'total' | 'rateLimitHits' | 'firstRateLimitAt' | 'firstRateLimitResource'>, fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await limiter.acquire();
      counters.total++;
      counters[resource]++;
      try {
        return await fn();
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 429) {
          counters.rateLimitHits++;
          if (!counters.firstRateLimitAt) {
            counters.firstRateLimitAt = new Date().toISOString();
            counters.firstRateLimitResource = resource;
            console.warn(`[RateLimit] PREMIER 429 — ressource: ${resource}, appel #${counters.total}`);
          }
          const wait = Math.pow(2, attempt) * 2_000;
          console.log(`[RateLimit] 429 — ${resource}, attente ${wait / 1000}s (tentative ${attempt + 1}/${maxRetries})`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`[RateLimit] Max ${maxRetries} tentatives atteint — ressource: ${resource}`);
  }

  async function fetchPages<T>(
    resource: keyof Omit<ApiCallCounters, 'total' | 'rateLimitHits' | 'firstRateLimitAt' | 'firstRateLimitResource'>,
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
      const res = await callApi(resource, () => client.get<T[]>(fullUrl));
      if (!Array.isArray(res.data)) {
        console.error('[API] Réponse inattendue (non-array):', res.status, JSON.stringify(res.data).slice(0, 200));
        break;
      }
      all.push(...res.data);
      const linkHeader = res.headers['link'] as string | undefined;
      if (!linkHeader?.includes('rel="next"')) break;
      page++;
    }
    return all;
  }

  return {
    /** Compteurs d'appels API pour le diagnostic — mutable, reflète l'état en temps réel */
    counters,

    async getCars(): Promise<GetaroundCar[]> {
      const ids = await fetchPages<{ id: number }>('cars', '/cars.json', {});
      const cars: GetaroundCar[] = [];
      for (const { id } of ids) {
        const res = await callApi('cars', () => client.get<GetaroundCar>(`/cars/${id}.json`));
        cars.push(res.data);
      }
      return cars;
    },

    async getCar(id: number): Promise<GetaroundCar> {
      const res = await callApi('cars', () => client.get<GetaroundCar>(`/cars/${id}.json`));
      return res.data;
    },

    // /rentals.json retourne uniquement [{id}] — il faut appeler /rentals/{id}.json pour chaque
    // start_date et end_date sont OBLIGATOIRES, plage max 30 jours → découpage automatique
    // Les fenêtres sont traitées du plus récent au plus ancien ; un 422 stoppe la recherche historique
    async getRentals(startDate: Date, endDate: Date): Promise<GetaroundRental[]> {
      const windows = splitInto30DayWindows(startDate, endDate);

      const seenIds = new Set<number>();
      for (const w of windows) {
        console.log(`[Sync] Fenêtre : ${toGetaroundDate(w.start)} → ${toGetaroundDate(w.end)}`);
        try {
          const chunk = await fetchPages<{ id: number }>('rentals', '/rentals.json', {
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

      console.log('[Sync] IDs locations collectés:', seenIds.size);
      const rentals: GetaroundRental[] = [];
      for (const id of seenIds) {
        try {
          console.log('[Sync] Appel détail location:', id);
          const res = await callApi('rentals', () => client.get<GetaroundRental>(`/rentals/${id}.json`));
          rentals.push(res.data);
          console.log('[Sync] Location récupérée:', id);
        } catch (err: unknown) {
          console.error('[Sync] Erreur détail location', id, err);
        }
      }
      return rentals;
    },

    async getRental(id: number): Promise<GetaroundRental> {
      const res = await callApi('rentals', () => client.get<GetaroundRental>(`/rentals/${id}.json`));
      return res.data;
    },

    async getUser(id: number): Promise<GetaroundUser> {
      // Les utilisateurs ne comptent pas dans un bucket dédié — on les loge sous 'rentals'
      const res = await callApi('rentals', () => client.get<GetaroundUser>(`/users/${id}.json`));
      return res.data;
    },

    async getCheckin(rentalId: number): Promise<GetaroundCheckin> {
      const res = await callApi('checkins', () => client.get<GetaroundCheckin>(`/rentals/${rentalId}/checkin.json`));
      return res.data;
    },

    async getCheckout(rentalId: number): Promise<GetaroundCheckout> {
      const res = await callApi('checkins', () => client.get<GetaroundCheckout>(`/rentals/${rentalId}/checkout.json`));
      return res.data;
    },

    // /rentals/{rental_id}/messages.json → [{id}] seulement, puis /messages/{id}.json pour chaque
    async getMessages(rentalId: number): Promise<GetaroundMessage[]> {
      const ids = await fetchPages<{ id: number }>('messages', `/rentals/${rentalId}/messages.json`, {});
      const messages: GetaroundMessage[] = [];
      for (const { id } of ids) {
        const res = await callApi('messages', () => client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`));
        messages.push(res.data);
      }
      return messages;
    },

    async getMessage(rentalId: number, id: number): Promise<GetaroundMessage> {
      const res = await callApi('messages', () => client.get<GetaroundMessage>(`/rentals/${rentalId}/messages/${id}.json`));
      return res.data;
    },

    async sendMessage(rentalId: number, content: string): Promise<GetaroundMessage> {
      const res = await callApi('messages', () => client.post<GetaroundMessage>(
        `/rentals/${rentalId}/messages.json`,
        { content },
      ));
      return res.data;
    },

    async createUnavailability(carId: number, startsAt: Date, endsAt: Date, reason: string): Promise<number | null> {
      const windows = splitInto30DayWindows(startsAt, endsAt);
      let firstId: number | null = null;
      for (const w of windows) {
        try {
          const res = await callApi('unavailabilities', () => client.post<{ id?: number }>(`/cars/${carId}/unavailabilities.json`, {
            starts_at: toGetaroundDate(w.start),
            ends_at: toGetaroundDate(w.end),
            reason,
          }));
          if (firstId === null && res.data?.id) firstId = res.data.id;
        } catch (err: unknown) {
          console.error(`[GA] createUnavailability fenêtre ${toGetaroundDate(w.start)}→${toGetaroundDate(w.end)}:`, err);
        }
      }
      return firstId;
    },

    async deleteUnavailability(carId: number, startsAt: Date, endsAt: Date): Promise<void> {
      const windows = splitInto30DayWindows(startsAt, endsAt);
      for (const w of windows) {
        try {
          await callApi('unavailabilities', () => client.delete(`/cars/${carId}/unavailabilities.json`, {
            data: { starts_at: toGetaroundDate(w.start), ends_at: toGetaroundDate(w.end) },
          }));
        } catch (err: unknown) {
          console.error(`[GA] deleteUnavailability fenêtre ${toGetaroundDate(w.start)}→${toGetaroundDate(w.end)}:`, err);
        }
      }
    },

    async getUnavailabilities(carId: number, startDate: Date, endDate: Date): Promise<Array<{ id: number; starts_at: string; ends_at: string }>> {
      const toDay = (d: Date) => `${d.toISOString().slice(0, 10)}T00:00:00Z`;
      const windows = splitInto30DayWindows(startDate, endDate);
      const seenIds = new Set<number>();
      const allResults: Array<{ id: number; starts_at: string; ends_at: string }> = [];
      for (const w of windows) {
        const url = `/cars/${carId}/unavailabilities.json?start_date=${toDay(w.start)}&end_date=${toDay(w.end)}`;
        console.log('[Unavailabilities] URL:', url);
        try {
          const res = await callApi('unavailabilities', () => client.get<Array<{ id: number; starts_at: string; ends_at: string }>>(url));
          for (const item of Array.isArray(res.data) ? res.data : []) {
            if (!seenIds.has(item.id)) { seenIds.add(item.id); allResults.push(item); }
          }
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } }).response?.status;
          if (status === 422) {
            console.log(`[API] GET unavailabilities 422 — carId ${carId} fenêtre ${toDay(w.start)}→${toDay(w.end)}`);
          } else {
            throw err;
          }
        }
      }
      return allResults;
    },

    async getRentalInvoices(rentalId: number): Promise<GetaroundInvoiceApi[]> {
      return fetchPages<GetaroundInvoiceApi>('invoices', `/rentals/${rentalId}/invoices.json`, {});
    },

    async getInvoices(): Promise<GetaroundInvoiceApi[]> {
      return fetchPages<GetaroundInvoiceApi>('invoices', '/invoices.json', {});
    },

    async getPayoutsAll(): Promise<GetaroundPayoutApi[]> {
      return fetchPages<GetaroundPayoutApi>('payouts', '/payouts.json', {});
    },

    async getPayouts(startDate: Date, endDate: Date): Promise<Array<{ id: number }>> {
      const qs = `start_date=${toGetaroundDate(startDate)}&end_date=${toGetaroundDate(endDate)}`;
      console.log('[Payouts API] URL:', `/payouts.json?${qs}`);
      const res = await callApi('payouts', () => client.get<Array<{ id: number }>>(`/payouts.json?${qs}`));
      return res.data ?? [];
    },

    async getPayout(payoutId: number): Promise<{
      id: number;
      amount: number;
      completed_at: string;
      currency: string;
      invoices: Array<{ id: number }>;
    }> {
      const res = await callApi('payouts', () => client.get<{
        id: number;
        amount: number;
        completed_at: string;
        currency: string;
        invoices: Array<{ id: number }>;
      }>(`/payouts/${payoutId}.json`));
      return res.data;
    },

    async getInvoice(invoiceId: number): Promise<{
      id: number;
      product_type: string;
      product_id: number;
      total_price: number;
      emitted_at: string;
      pdf_url: string;
      charges: Array<{ type: string; amount: number }>;
    }> {
      const res = await callApi('invoices', () => client.get<{
        id: number;
        product_type: string;
        product_id: number;
        total_price: number;
        emitted_at: string;
        pdf_url: string;
        charges: Array<{ type: string; amount: number }>;
      }>(`/invoices/${invoiceId}.json`));
      return res.data;
    },
  };
}

export type GetaroundClient = ReturnType<typeof createGetaroundClient>;
