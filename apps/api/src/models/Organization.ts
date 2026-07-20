import { Schema, model, Document, Types } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  ownerId: Types.ObjectId;
  createdAt: Date;
  logoUrl?: string;
  primaryColor?: string;
  reportFooterText?: string;
}

const OrganizationSchema = new Schema<IOrganization>({
  name: { type: String, required: true, trim: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  logoUrl: { type: String, trim: true },
  primaryColor: { type: String, trim: true, match: /^#[0-9a-fA-F]{6}$/ },
  reportFooterText: { type: String, trim: true, maxlength: 500 },
});

export const Organization = model<IOrganization>('Organization', OrganizationSchema);
export default Organization;
