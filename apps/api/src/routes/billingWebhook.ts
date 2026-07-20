import { Request, Response } from 'express';
import User from '../models/User';
import Subscription from '../models/Subscription';
import { constructWebhookEvent, parseSubscriptionMetadata } from '../services/stripeService';
import { getPlanConfig } from '../config/plans';

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event;
  try {
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Record<string, any>;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const planId = (session.metadata?.planId as string) || 'free';

        const plan = getPlanConfig(planId);

        await User.findOneAndUpdate(
          { stripeCustomerId: customerId },
          {
            stripeSubscriptionId: subscriptionId,
            planId,
            subscriptionStatus: 'active',
            dataProviderMonthlyLimit: plan.dataProviderMonthlyLimit,
          },
        );

        await Subscription.findOneAndUpdate(
          { ownerId: (await User.findOne({ stripeCustomerId: customerId }))?._id },
          {
            plan: planId as any,
            status: 'active',
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          },
          { upsert: true },
        );

        console.log(`[Webhook] checkout.session.completed: customer=${customerId}, plan=${planId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const meta = parseSubscriptionMetadata(event);
        const plan = getPlanConfig(meta.planId);

        const updateFields: Record<string, any> = {
          subscriptionStatus: meta.status as string,
          planId: meta.planId,
          dataProviderMonthlyLimit: plan.dataProviderMonthlyLimit,
        };

        if (meta.status === 'past_due') {
          updateFields.subscriptionStatus = 'past_due';
        }

        await User.findOneAndUpdate(
          { stripeCustomerId: meta.customerId },
          updateFields,
        );

        await Subscription.findOneAndUpdate(
          { stripeCustomerId: meta.customerId },
          {
            plan: meta.planId as any,
            status: meta.status as string,
          },
        );

        console.log(`[Webhook] customer.subscription.updated: customer=${meta.customerId}, status=${meta.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const meta = parseSubscriptionMetadata(event);
        const freePlan = getPlanConfig('free');

        await User.findOneAndUpdate(
          { stripeCustomerId: meta.customerId },
          {
            stripeSubscriptionId: null,
            planId: 'free',
            subscriptionStatus: 'canceled',
            dataProviderMonthlyLimit: freePlan.dataProviderMonthlyLimit,
          },
        );

        await Subscription.findOneAndUpdate(
          { stripeCustomerId: meta.customerId },
          {
            plan: 'free',
            status: 'canceled',
            stripeSubscriptionId: null,
          },
        );

        console.log(`[Webhook] customer.subscription.deleted: customer=${meta.customerId}`);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
