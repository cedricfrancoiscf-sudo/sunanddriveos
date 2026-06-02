import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { createGetaroundClient } from './getaround-api';
import { decrypt } from '../../utils/crypto';
import { syncSingleRental } from './getaround-sync.service';
import { scheduleSequencesForRental } from '../sequences/sequences.service';

const router: Router = Router();

const SUPPORTED_EVENTS = new Set([
  'rentals_booked',
  'rentals_canceled',
  'rentals_times_changed',
  'rentals_car_checked_in',
  'rentals_car_checked_out',
  'messages_sent',
]);

// ── Sync trigger — fallback pour déclencher une sync complète depuis le webhook ─

let _runSync: (() => Promise<void>) | null = null;

export function registerSyncTrigger(fn: () => Promise<void>): void {
  _runSync = fn;
}

// ── Vérification signature HMAC-SHA256 ────────────────────────────────────────

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.GETAROUND_WEBHOOK_SECRET;
  if (!secret) return true; // secret non configuré → on laisse passer
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature.toLowerCase()),
      Buffer.from(expected.toLowerCase()),
    );
  } catch {
    return false;
  }
}

// ── Lookup tenant par rental ou par véhicule ──────────────────────────────────

type TenantDb = ReturnType<typeof getTenantClient>;

async function getAccountApiKey(db: TenantDb, vehicleId: string): Promise<string | null> {
  const vehicle = await db.vehicle.findUnique({
    where: { id: vehicleId },
    select: { getaroundAccountId: true },
  });
  if (!vehicle?.getaroundAccountId) return null;
  const account = await db.getaroundAccount.findUnique({
    where: { id: vehicle.getaroundAccountId },
    select: { apiKeyHash: true },
  });
  return account ? decrypt(account.apiKeyHash) : null;
}

interface TenantContext {
  db: TenantDb;
  tenantSlug: string;
  rentalDbId: string | null;
  driverGetaroundId: string | null;
  apiKey: string;
}

async function findTenantContext(gaRentalId: number, gaCarId?: number): Promise<TenantContext | null> {
  const master = getMasterClient();
  const companies = await master.company.findMany({
    where: { isActive: true },
    select: { slug: true, tenantDbUrl: true },
  });

  for (const company of companies) {
    try {
      const db = getTenantClient(company.tenantDbUrl);

      // Cherche d'abord par getaroundId de la location (location déjà en base)
      const rental = await db.rental.findUnique({
        where: { getaroundId: String(gaRentalId) },
        select: { id: true, vehicleId: true, driverGetaroundId: true },
      });
      if (rental) {
        const apiKey = await getAccountApiKey(db, rental.vehicleId);
        if (apiKey) {
          return { db, tenantSlug: company.slug, rentalDbId: rental.id, driverGetaroundId: rental.driverGetaroundId, apiKey };
        }
      }

      // Fallback : cherche par car_id (nouvelle réservation pas encore en base)
      if (gaCarId != null) {
        const vehicle = await db.vehicle.findUnique({
          where: { getaroundId: String(gaCarId) },
          select: { id: true, getaroundAccountId: true },
        });
        if (vehicle?.getaroundAccountId) {
          const account = await db.getaroundAccount.findUnique({
            where: { id: vehicle.getaroundAccountId },
            select: { apiKeyHash: true },
          });
          if (account) {
            return {
              db, tenantSlug: company.slug,
              rentalDbId: null, driverGetaroundId: null,
              apiKey: decrypt(account.apiKeyHash),
            };
          }
        }
      }
    } catch { /* passer au tenant suivant */ }
  }
  return null;
}

// ── Handler principal ─────────────────────────────────────────────────────────

// Monté avant express.json() — le body est un Buffer raw
router.post('/', (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const signature = req.headers['x-getaround-signature'] as string | undefined;

  // Vérification signature
  if (signature && process.env.GETAROUND_WEBHOOK_SECRET) {
    if (!verifySignature(rawBody, signature)) {
      console.warn('[Webhook Getaround] Signature invalide — rejet 401');
      res.sendStatus(401);
      return;
    }
  }

  // Parse payload (robuste : corps vide ou non-JSON ne crashent pas)
  let payload: Record<string, unknown> = {};
  try {
    if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
      payload = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    }
  } catch { /* payload malformé → on répond 200 quand même */ }

  const event = payload.event as string | undefined;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const gaRentalId = typeof data.rental_id === 'number' ? data.rental_id : undefined;
  const gaMessageId = typeof data.message_id === 'number' ? data.message_id : undefined;
  const gaCarId = typeof data.car_id === 'number' ? data.car_id : undefined;

  console.log(`[Webhook Getaround] Event: ${event ?? '?'} | rental: ${gaRentalId} | car: ${gaCarId}`);

  // Répondre immédiatement pour éviter les retries Getaround
  res.sendStatus(200);

  if (!event || !SUPPORTED_EVENTS.has(event)) return;
  if (gaRentalId === undefined) return;

  // Traitement asynchrone sans bloquer la réponse
  void (async () => {
    try {
      const ctx = await findTenantContext(gaRentalId, gaCarId);

      if (!ctx) {
        // Aucun tenant trouvé → fallback sync globale
        console.warn(`[Webhook] Tenant introuvable pour rental=${gaRentalId} car=${gaCarId} — fallback sync`);
        if (_runSync) void _runSync();
        return;
      }

      const { db, tenantSlug, rentalDbId, driverGetaroundId, apiKey } = ctx;
      const ga = createGetaroundClient(apiKey);

      switch (event) {
        case 'rentals_booked':
        case 'rentals_times_changed':
          await syncSingleRental(db, ga, gaRentalId, tenantSlug);
          break;

        case 'rentals_canceled':
          await db.rental.update({
            where: { getaroundId: String(gaRentalId) },
            data: { status: 'cancelled' },
          });
          if (rentalDbId) {
            await db.sequenceExecution.updateMany({
              where: { rentalId: rentalDbId, status: 'pending' },
              data: { status: 'cancelled', cancelledReason: 'rental_cancelled_webhook' },
            });
          }
          console.log(`[Webhook][${tenantSlug}] Rental ${gaRentalId} → cancelled`);
          break;

        case 'rentals_car_checked_in':
          await db.rental.update({
            where: { getaroundId: String(gaRentalId) },
            data: { status: 'active' },
          });
          if (rentalDbId) {
            await scheduleSequencesForRental(db, rentalDbId, 'rental.car_checked_in');
          }
          console.log(`[Webhook][${tenantSlug}] Rental ${gaRentalId} → active (check-in)`);
          break;

        case 'rentals_car_checked_out':
          await db.rental.update({
            where: { getaroundId: String(gaRentalId) },
            data: { status: 'completed' },
          });
          if (rentalDbId) {
            await scheduleSequencesForRental(db, rentalDbId, 'rental.car_checked_out');
          }
          console.log(`[Webhook][${tenantSlug}] Rental ${gaRentalId} → completed (check-out)`);
          break;

        case 'messages_sent': {
          if (gaMessageId != null && rentalDbId) {
            const gaMsg = await ga.getMessage(gaRentalId, gaMessageId);
            const direction =
              driverGetaroundId && String(gaMsg.sending_user_id) === driverGetaroundId
                ? ('inbound' as const)
                : ('outbound' as const);
            await db.message.upsert({
              where: { getaroundId: String(gaMsg.id) },
              create: {
                getaroundId: String(gaMsg.id),
                rentalId: rentalDbId,
                direction,
                content: gaMsg.content,
                sentAt: new Date(gaMsg.sent_at),
                status: 'sent',
              },
              update: { content: gaMsg.content },
              select: { id: true },
            });
            console.log(`[Webhook][${tenantSlug}] Message ${gaMessageId} upserted (${direction})`);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[Webhook] Erreur traitement ${event}:`, err instanceof Error ? err.message : err);
    }
  })();
});

export default router;
