import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient } from '../../prisma/client';

const router: Router = Router();

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY ?? '');

const PLAN_PRICE_IDS: Record<string, string> = {
  pro:        process.env.STRIPE_PRICE_PRO        ?? '',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE ?? '',
};

// POST /api/v1/billing/checkout — crée une session Stripe Checkout
router.post('/checkout', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ plan: z.enum(['pro', 'enterprise']) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Plan invalide' }); return; }

    const priceId = PLAN_PRICE_IDS[body.data.plan];
    if (!priceId) { res.status(500).json({ error: 'Prix Stripe non configuré' }); return; }

    const stripe = getStripe();
    const master = getMasterClient();
    const company = await master.company.findFirst({ where: { slug: req.auth!.tenantSlug } });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      ...(company.stripeCustomerId ? { customer: company.stripeCustomerId } : {}),
      success_url: `${process.env.FRONTEND_URL ?? ''}/settings?billing=success`,
      cancel_url:  `${process.env.FRONTEND_URL ?? ''}/settings?billing=cancelled`,
      metadata: { companyId: company.id, plan: body.data.plan },
    });

    res.json({ url: session.url });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/billing/portal — ouvre le Customer Portal Stripe
router.post('/portal', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findFirst({ where: { slug: req.auth!.tenantSlug } });
    if (!company?.stripeCustomerId) {
      res.status(400).json({ error: 'Aucun compte de facturation Stripe associé' });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer:   company.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL ?? ''}/settings`,
    });

    res.json({ url: session.url });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/billing/webhook — webhook Stripe (raw body)
router.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret || !sig) { res.sendStatus(200); return; }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
    } catch {
      res.status(400).json({ error: 'Signature Stripe invalide' });
      return;
    }

    const master = getMasterClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.companyId;
        const plan = session.metadata?.plan as 'pro' | 'enterprise' | undefined;
        if (companyId && plan) {
          const customerId = typeof session.customer === 'string' ? session.customer : null;
          const subId = typeof session.subscription === 'string' ? session.subscription : null;
          await master.company.update({
            where: { id: companyId },
            data: {
              plan,
              ...(customerId ? { stripeCustomerId: customerId } : {}),
              ...(subId      ? { stripeSubscriptionId: subId }    : {}),
              trialEndsAt: null,
            },
          });
          await master.billingEvent.create({
            data: {
              companyId,
              type: 'checkout.session.completed',
              stripeEventId: event.id,
              data: session as never,
            },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const company = await master.company.findFirst({ where: { stripeSubscriptionId: sub.id } });
        if (company) {
          await master.company.update({
            where: { id: company.id },
            data: { plan: 'starter', stripeSubscriptionId: null },
          });
          await master.billingEvent.create({
            data: {
              companyId: company.id,
              type: 'customer.subscription.deleted',
              stripeEventId: event.id,
              data: sub as never,
            },
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
        if (customerId) {
          const company = await master.company.findFirst({ where: { stripeCustomerId: customerId } });
          if (company) {
            await master.billingEvent.create({
              data: {
                companyId: company.id,
                type: 'invoice.payment_succeeded',
                stripeEventId: event.id,
                data: invoice as never,
              },
            });
          }
        }
        break;
      }
    }

    res.sendStatus(200);
  } catch (err: unknown) { next(err); }
});

export default router;
