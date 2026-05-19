import axios from 'axios';

const BASE_URL = 'https://api.getaround.com/owner/v1';

export interface GetaroundCar {
  id: number;
  name: string;           // "Renault Clio 2019"
  brand: string;
  model: string;
  year_of_production: number;
  color?: string;
  license_plate?: string;
  picture_url?: string;
  mileage?: number;
  status?: string;        // 'active' | 'inactive'
}

export interface GetaroundRental {
  id: number;
  car_id: number;
  driver: { display_name: string; id: number; email?: string };
  starts_at: string;
  ends_at: string;
  price_amount: number;   // Montant en centimes
  price_currency: string;
  payout_amount?: number;
  state: string;          // 'booked' | 'ongoing' | 'done' | 'cancelled'
}

export function createGetaroundClient(apiKey: string) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    timeout: 15_000,
  });

  return {
    async getCars(): Promise<GetaroundCar[]> {
      const res = await client.get<{ data: GetaroundCar[] }>('/cars');
      return res.data.data ?? [];
    },

    async getCar(id: number): Promise<GetaroundCar> {
      const res = await client.get<{ data: GetaroundCar }>(`/cars/${id}`);
      return res.data.data;
    },

    async getRentals(params?: { from?: string; to?: string; car_id?: number }): Promise<GetaroundRental[]> {
      const res = await client.get<{ data: GetaroundRental[] }>('/rentals', { params });
      return res.data.data ?? [];
    },
  };
}
