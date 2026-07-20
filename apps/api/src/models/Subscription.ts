import { Schema, model, Document } from 'mongoose';

export type SubscriptionPlan = 'free' | 'pro' | 'agency';

export interface ISubscription extends Document {
  ownerId: Schema.Types.ObjectId;
  plan: SubscriptionPlan;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt?: Date;
  seats: number;
  createdAt: Date;
  updatedAt: Date;
}

const PLAN_LIMITS: Record<SubscriptionPlan, { projects: number; keywords: number; seats: number; dataProviderMonthlyLimit: number }> = {
  free: { projects: 1, keywords: 10, seats: 1, dataProviderMonthlyLimit: 100 },
  pro: { projects: 20, keywords: 200, seats: 5, dataProviderMonthlyLimit: 2000 },
  agency: { projects: 100, keywords: 1000, seats: 25, dataProviderMonthlyLimit: 10000 },
};

export function getPlanLimits(plan: SubscriptionPlan) {
  return PLAN_LIMITS[plan];
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    plan: { type: String, enum: ['free', 'pro', 'agency'], default: 'free' },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'incomplete'],
      default: 'active',
    },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    currentPeriodStart: { type: Date, default: () => new Date() },
    currentPeriodEnd: {
      type: Date,
      default: () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    },
    canceledAt: { type: Date },
    seats: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const Subscription = model<ISubscription>('Subscription', SubscriptionSchema);
export default Subscription;
