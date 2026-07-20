import Stripe from 'stripe';
import config from '../config';
import { getPlanConfig, type PlanId } from '../config/plans';

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

export async function createOrRetrieveCustomer(
  userId: string,
  email: string,
  existingCustomerId?: string | null,
): Promise<string> {
  const stripe = getStripe();

  if (existingCustomerId) {
    try {
      await stripe.customers.retrieve(existingCustomerId);
      return existingCustomerId;
    } catch {
      // Customer was deleted on Stripe side; create a new one
    }
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  return customer.id;
}

export async function createCheckoutSession(
  customerId: string,
  planId: PlanId,
  successUrl: string,
  cancelUrl: string,
  userId?: string,
): Promise<string> {
  const stripe = getStripe();
  const plan = getPlanConfig(planId);

  if (!plan.stripePriceId) {
    throw new Error(`No Stripe price ID configured for plan "${planId}"`);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { planId, ...(userId ? { userId } : {}) },
    subscription_data: {
      metadata: { planId },
    },
  });

  if (!session.url) {
    throw new Error('Stripe Checkout Session returned no URL');
  }

  return session.url;
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

export async function retrieveSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function cancelSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.cancel(subscriptionId);
}

export function constructWebhookEvent(
  payload: Buffer | string,
  sigHeader: string,
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, sigHeader, config.STRIPE_WEBHOOK_SECRET);
}

export function parseSubscriptionMetadata(event: Stripe.Event): {
  customerId: string;
  subscriptionId: string;
  planId: PlanId;
  status: string;
} {
  const subscription = event.data.object as Stripe.Subscription;
  const planId = (subscription.metadata?.planId as PlanId) || 'free';

  return {
    customerId: subscription.customer as string,
    subscriptionId: subscription.id,
    planId,
    status: subscription.status,
  };
}
