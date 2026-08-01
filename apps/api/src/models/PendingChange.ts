import { Schema, model, Document, Types } from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// PendingChange — tracks the write-back lifecycle for a single AuditIssue fix.
//
// Lifecycle: open → proposed → approved → applied
//   open:     AuditIssue exists but no change has been proposed yet
//             (this state is implicit — no PendingChange document is stored)
//   proposed: a fix has been drafted and is awaiting review
//   approved: the fix has been reviewed and accepted, ready to apply
//   applied:  the fix has been deployed to the site
// ─────────────────────────────────────────────────────────────────────────────

export type PendingChangeStatus = 'proposed' | 'approved' | 'applied';

export interface IPendingChange extends Document {
  /** The AuditIssue this change resolves. The canonical join key. */
  sourceAuditIssueId: Types.ObjectId;

  /** Owning project — redundant with the AuditIssue chain but makes queries cheaper. */
  projectId: Types.ObjectId;

  /** Lifecycle status. Note: 'open' is the implicit state (no document stored). */
  status: PendingChangeStatus;

  /** Human-readable summary of the proposed change. */
  proposedChange: string;

  /** ISO date when the fix was applied, if status === 'applied'. */
  appliedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const PendingChangeSchema = new Schema<IPendingChange>(
  {
    sourceAuditIssueId: {
      type: Schema.Types.ObjectId,
      ref: 'AuditIssue',
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    status: {
      type: String,
      enum: ['proposed', 'approved', 'applied'],
      required: true,
      default: 'proposed',
    },
    proposedChange: {
      type: String,
      required: true,
      trim: true,
    },
    appliedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// One PendingChange per AuditIssue — enforced at the DB level.
PendingChangeSchema.index({ sourceAuditIssueId: 1 }, { unique: true });
PendingChangeSchema.index({ projectId: 1, status: 1 });

export const PendingChange = model<IPendingChange>('PendingChange', PendingChangeSchema);
export default PendingChange;
