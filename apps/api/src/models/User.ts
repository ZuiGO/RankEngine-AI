import { Schema, model, Document } from 'mongoose';

export type UserRole = 'agency_owner' | 'marketer' | 'developer';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  companyName: string;
  emailDigestEnabled: boolean;
  createdAt: Date;
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Mongoose unique constraint on email field serves as the unique index

export const User = model<IUser>('User', UserSchema);
export default User;
