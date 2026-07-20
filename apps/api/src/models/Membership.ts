import { Schema, model, Document, Types } from 'mongoose';

export type MembershipRole = 'owner' | 'admin' | 'member';

export interface IMembership extends Document {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: MembershipRole;
  invitedAt: Date;
  joinedAt: Date | null;
}

const MembershipSchema = new Schema<IMembership>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  invitedAt: { type: Date, default: Date.now },
  joinedAt: { type: Date, default: null },
});

MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const Membership = model<IMembership>('Membership', MembershipSchema);
export default Membership;
