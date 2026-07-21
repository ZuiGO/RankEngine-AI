/**
 * One-off migration script: User-owned projects → Organization-owned projects.
 *
 * For every existing User:
 *   1. Create an Organization with name = user.companyName, ownerId = user._id
 *   2. Create an "owner" Membership linking the user to the new org
 *   3. Reassign all projects where project.ownerId === user._id to
 *      project.organizationId = org._id
 *
 * Run: npx ts-node --compiler-options '{"rootDir":"."}' scripts/migrate-ownership.ts
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rankengine';

const userSchema = new mongoose.Schema({}, { strict: false });
const projectSchema = new mongoose.Schema({}, { strict: false });
const orgSchema = new mongoose.Schema({}, { strict: false });
const membershipSchema = new mongoose.Schema({}, { strict: false });

const User = mongoose.model('User', userSchema);
const Project = mongoose.model('Project', projectSchema);
const Organization = mongoose.model('Organization', orgSchema);
const Membership = mongoose.model('Membership', membershipSchema);

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to ${MONGODB_URI}`);

  const users = await User.find({}).lean();
  console.log(`Found ${users.length} users`);

  let orgsCreated = 0;
  let projectsMigrated = 0;

  for (const user of users) {
    const userId = user._id.toString();

    // Check if an org already exists for this user (idempotent)
    const existingOrg = await Organization.findOne({ ownerId: userId });
    if (existingOrg) {
      console.log(`  User ${userId} already has org ${existingOrg._id}, skipping creation`);
    } else {
      const org = await Organization.create({
        name: user.companyName || `${user.email}'s Organization`,
        ownerId: userId,
        createdAt: user.createdAt || new Date(),
      });
      orgsCreated++;
      console.log(`  Created org ${org._id} for user ${userId}`);

      await Membership.create({
        organizationId: org._id,
        userId: userId,
        role: 'owner',
        invitedAt: user.createdAt || new Date(),
        joinedAt: user.createdAt || new Date(),
      });
    }
  }

  // Reload orgs after creation
  const allOrgs = await Organization.find({}).lean();
  const ownerToOrg: Record<string, string> = {};
  for (const org of allOrgs) {
    ownerToOrg[org.ownerId.toString()] = org._id.toString();
  }

  // Migrate projects that still have ownerId
  const projectsWithOwnerId = await Project.find({
    ownerId: { $exists: true },
    organizationId: { $exists: false },
  }).lean();
  console.log(`Found ${projectsWithOwnerId.length} projects with ownerId (no organizationId)`);

  for (const project of projectsWithOwnerId) {
    const ownerId = project.ownerId.toString();
    const orgId = ownerToOrg[ownerId];
    if (!orgId) {
      console.warn(`  WARNING: No org found for owner ${ownerId}, skipping project ${project._id}`);
      continue;
    }

    await Project.findByIdAndUpdate(project._id, {
      $unset: { ownerId: '' },
      $set: { organizationId: new mongoose.Types.ObjectId(orgId) },
    });
    projectsMigrated++;
  }

  // Also handle projects that might have BOTH fields (partial migration)
  const projectsWithBoth = await Project.find({
    ownerId: { $exists: true },
    organizationId: { $exists: true },
  }).lean();
  for (const project of projectsWithBoth) {
    await Project.findByIdAndUpdate(project._id, {
      $unset: { ownerId: '' },
    });
  }
  if (projectsWithBoth.length > 0) {
    console.log(
      `Cleaned up ownerId from ${projectsWithBoth.length} already-partially-migrated projects`
    );
  }

  console.log(`\nMigration complete:`);
  console.log(`  Orgs created: ${orgsCreated}`);
  console.log(`  Projects migrated: ${projectsMigrated}`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
