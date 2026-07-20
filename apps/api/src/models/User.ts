import { Schema, model, Document } from 'mongoose';
import { getPlanConfig } from '../config/plans';

export type UserRole = 'agency_owner' | 'marketer' | 'developer';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'unpaid';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  companyName: string;
  emailDigestEnabled: boolean;
  hasCompletedOnboarding: boolean;
  createdAt: Date;
  dataProviderCallsThisMonth: number;
  dataProviderMonthlyLimit: number;
  dataProviderQuotaResetAt: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  planId: string;
  subscriptionStatus: SubscriptionStatus;
}

const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['agency_owner', 'marketer', 'developer'],
    required: true,
  },
  companyName: {
    type: String,
    required: true,
  },
  emailDigestEnabled: {
    type: Boolean,
    default: true,
  },
  hasCompletedOnboarding: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  dataProviderCallsThisMonth: {
    type: Number,
    default: 0,
  },
  dataProviderMonthlyLimit: {
    type: Number,
    default: () => getPlanConfig('free').dataProviderMonthlyLimit,
  },
  dataProviderQuotaResetAt: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    },
  },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  planId: { type: String, default: 'free' },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid'],
    default: 'active',
  },
});

// Mongoose unique constraint on email field serves as the unique index

export const User = model<IUser>('User', UserSchema);
export default User;
