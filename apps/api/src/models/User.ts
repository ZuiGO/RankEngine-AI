import { Schema, model, Document } from 'mongoose';

export type UserRole = 'agency_owner' | 'marketer' | 'developer';

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
    default: 500,
  },
  dataProviderQuotaResetAt: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    },
  },
});

// Mongoose unique constraint on email field serves as the unique index

export const User = model<IUser>('User', UserSchema);
export default User;
