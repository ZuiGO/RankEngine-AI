import { Schema, model, Document, Types } from 'mongoose';

export type InviteStatus = 'pending' | 'accepted' | 'expired';

export interface ITeamInvite extends Document {
  organizationId: Types.ObjectId;
  invitedBy: Types.ObjectId;
  email: string;
  role: 'member' | 'admin';
  status: InviteStatus;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

const TeamInviteSchema = new Schema<ITeamInvite>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['member', 'admin'], default: 'member' },
  status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending' },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

TeamInviteSchema.index({ organizationId: 1, email: 1, status: 1 });

export const TeamInvite = model<ITeamInvite>('TeamInvite', TeamInviteSchema);
export default TeamInvite;
