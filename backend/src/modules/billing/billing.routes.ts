import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient } from '../../prisma/client';

const router: Router = Router();

const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
const getStripe = () => {
  if (!isStripeConfigured()) throw new Error('Stripe non configuré — STRIPE_SECRET_KEY manquante');
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
};

// GET /api/v1/billing/status — plan actuel, prix, historique paiements
router.get('/status', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findFirst({
      where: { slug: req.auth!.tenantSlug },
      select: { id: true, plan: true, subscriptionStatus: true, subscriptionMode: true, trialEndsAt: true, stripeCustomerId: true, isDemo: true },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const [planConfig, payments, allPlans] = await Promise.all([
      master.planConfig.findUnique({ where: { name: company.plan }, select: { priceMonthly: true, priceYearly: true, description: true, features: true } }),
      master.billingEvent.findMany({
        where: { companyId: company.id, type: 'invoice.payment_succeeded' },
        orderBy: { processedAt: 'desc' },
        take: 20,
        select: { id: true, processedAt: true, data: true },
      }),
      master.planConfig.findMany({ orderBy: { name: 'asc' }, select: { name: true, priceMonthly: true, priceYearly: true, description: true, features: true } }),
    ]);

    res.json({
      plan: company.plan,
      status: company.subscriptionStatus,
      mode: company.subscriptionMode,
      trialEndsAt: company.trialEndsAt,
      hasStripe: Boolean(company.stripeCustomerId),
      stripeConfigured: isStripeConfigured(),
      isDemo: company.isDemo,
      priceMonthly: planConfig?.priceMonthly ?? 0,
      priceYearly: planConfig?.priceYearly ?? 0,
      planDescription: planConfig?.description ?? '',
      planFeatures: (planConfig?.features as string[]) ?? [],
      allPlans: allPlans.map(p => ({ name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, description: p.description, features: p.features as string[] })),
      payments: payments.map(p => {
        const d = p.data as { amount_paid?: number; invoice_pdf?: string };
        return { id: p.id, amountCents: d.amount_paid ?? 0, processedAt: p.processedAt, invoicePdfUrl: d.invoice_pdf ?? null };
      }),
    });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/billing/create-checkout-session — Stripe Checkout avec prix dynamique depuis PlanConfig
router.post('/create-checkout-session', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      planId: z.enum(['starter', 'pro', 'enterprise']),
      billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Paramètres invalides' }); return; }
    if (!isStripeConfigured()) { res.status(200).json({ error: 'Stripe non configuré', configured: false }); return; }

    const master = getMasterClient();
    const [company, planConfig] = await Promise.all([
      master.company.findFirst({ where: { slug: req.auth!.tenantSlug }, select: { id: true, stripeCustomerId: true } }),
      master.planConfig.findUnique({ where: { name: body.data.planId }, select: { priceMonthly: true, priceYearly: true } }),
    ]);
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const price = body.data.billingCycle === 'yearly' ? (planConfig?.priceYearly ?? 0) : (planConfig?.priceMonthly ?? 0);
    if (price <= 0) { res.status(400).json({ error: 'Prix non configuré pour ce plan — contactez le support' }); return; }

    const stripe = getStripe();
    const planLabel = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' }[body.data.planId];
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `SunanddriveOS ${planLabel}` },
          recurring: { interval: body.data.billingCycle === 'yearly' ? 'year' : 'month' },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      ...(company.stripeCustomerId ? { customer: company.stripeCustomerId } : {}),
      success_url: `${process.env.FRONTEND_URL ?? ''}/billing?success=1`,
      cancel_url: `${process.env.FRONTEND_URL ?? ''}/billing`,
      metadata: { companyId: company.id, plan: body.data.planId },
    });

    res.json({ url: session.url });
  } catch (err: unknown) { next(err); }
});

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
    if (!isStripeConfigured()) { res.status(200).json({ error: 'Stripe non configuré', configured: false }); return; }
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
              subscriptionMode: 'standard',
              subscriptionStatus: 'active',
              subscriptionStartedAt: new Date(),
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
            data: { plan: 'starter', stripeSubscriptionId: null, subscriptionStatus: 'suspendu' },
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
              data: { companyId: company.id, type: 'invoice.payment_succeeded', stripeEventId: event.id, data: invoice as never },
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
        if (customerId) {
          const company = await master.company.findFirst({ where: { stripeCustomerId: customerId } });
          if (company) {
            await master.billingEvent.create({
              data: { companyId: company.id, type: 'invoice.payment_failed', stripeEventId: event.id, data: invoice as never },
            });
            console.log(`[Billing][Webhook] Paiement echoue — company ${company.id}`);
          }
        }
        break;
      }
    }

    res.sendStatus(200);
  } catch (err: unknown) { next(err); }
});

export default router;
