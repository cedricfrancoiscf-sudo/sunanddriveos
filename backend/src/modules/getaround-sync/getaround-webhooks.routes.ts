import { Router, type Request, type Response } from 'express';

const router: Router = Router();

const SUPPORTED_EVENTS = new Set([
  'rentals_booked',
  'rentals_canceled',
  'rentals_times_changed',
  'rentals_car_checked_in',
  'rentals_car_checked_out',
  'messages_sent',
]);

let _runSync: (() => Promise<void>) | null = null;

export function registerSyncTrigger(fn: () => Promise<void>): void {
  _runSync = fn;
}

// Monté avant express.json() — le body est un Buffer raw
router.post('/', (req: Request, res: Response) => {
  let payload: Record<string, unknown> = {};
  try {
    const raw = req.body as Buffer;
    if (Buffer.isBuffer(raw) && raw.length > 0) {
      payload = JSON.parse(raw.toString()) as Record<string, unknown>;
    }
  } catch {
    // Corps non-JSON : on continue quand même
  }

  const event = payload.event as string | undefined;
  console.log(`[Webhook Getaround] Événement reçu : ${event ?? '(inconnu)'}`, JSON.stringify(payload).slice(0, 200));

  if (event && SUPPORTED_EVENTS.has(event) && _runSync) {
    void _runSync();
  }

  res.sendStatus(200);
});

export default router;
