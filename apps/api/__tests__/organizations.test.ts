import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn(),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_organizations';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Organization } = require('../src/models/Organization');
const { Membership } = require('../src/models/Membership');
const { TeamInvite } = require('../src/models/TeamInvite');

const request = supertest(app);

let ownerToken: string;
let ownerId: string;
let orgId: string;

let memberToken: string;
let memberId: string;

let outsiderToken: string;
let outsiderId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Register owner (User A)
  const ownerRes = await request
    .post('/api/auth/register')
    .send({
      email: 'owner@org.test',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Owner Co',
    })
    .expect(201);
  ownerToken = ownerRes.body.token;
  ownerId = ownerRes.body.user.id;

  // Get the auto-created org
  const org = await Organization.findOne({ ownerId });
  orgId = org!._id.toString();

  // Register a second user to be a regular member
  const memberRes = await request
    .post('/api/auth/register')
    .send({
      email: 'member@org.test',
      password: 'password123',
      role: 'marketer',
      companyName: 'Member Co',
    })
    .expect(201);
  memberToken = memberRes.body.token;
  memberId = memberRes.body.user.id;

  // Make them a member of orgA
  await Membership.create({
    organizationId: orgId,
    userId: memberId,
    role: 'member',
    joinedAt: new Date(),
  });

  // Register a third user with NO membership in orgA
  const outsiderRes = await request
    .post('/api/auth/register')
    .send({
      email: 'outsider@org.test',
      password: 'password123',
      role: 'developer',
      companyName: 'Outsider Co',
    })
    .expect(201);
  outsiderToken = outsiderRes.body.token;
  outsiderId = outsiderRes.body.user.id;

  // Upgrade owner to Agency plan so team features are available
  await User.findByIdAndUpdate(ownerId, { planId: 'agency' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Organization Team Management', () => {
  describe('POST /api/organizations/:orgId/invites', () => {
    it('should allow owner to invite a new member by email', async () => {
      const res = await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'newmember@test.com', role: 'member' })
        .expect(201);

      expect(res.body.message).toBe('Invitation sent');
      expect(res.body.email).toBe('newmember@test.com');
      expect(res.body.role).toBe('member');
      expect(res.body.token).toBeDefined();

      // Verify invite was persisted
      const invite = await TeamInvite.findOne({ email: 'newmember@test.com', status: 'pending' });
      expect(invite).not.toBeNull();
      expect(invite!.organizationId.toString()).toBe(orgId);
    });

    it('should reject duplicate pending invite for the same email', async () => {
      await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'newmember@test.com', role: 'member' })
        .expect(409);
    });

    it('should reject invite for a user who is already a member', async () => {
      await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'member@org.test', role: 'member' })
        .expect(409);
    });

    it('should reject invite when caller is not owner/admin', async () => {
      await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ email: 'another@test.com', role: 'member' })
        .expect(403);
    });

    it('should reject invite without auth', async () => {
      await request
        .post(`/api/organizations/${orgId}/invites`)
        .send({ email: 'noauth@test.com', role: 'member' })
        .expect(401);
    });

    it('should reject self-invite', async () => {
      await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'owner@org.test', role: 'member' })
        .expect(400);
    });

    it('should reject invite for non-existent org', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request
        .post(`/api/organizations/${fakeId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'any@test.com', role: 'member' })
        .expect(404);
    });
  });

  describe('POST /api/invites/:token/accept', () => {
    let inviteToken: string;

    beforeAll(async () => {
      // Create a fresh invite for a NEW email that has no account yet
      const res = await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'accept-test@test.com', role: 'admin' })
        .expect(201);
      inviteToken = res.body.token;
    });

    it('should reject accept with a different user (email mismatch)', async () => {
      // outsiderToken belongs to outsider@org.test, not accept-test@test.com
      await request
        .post(`/api/invites/${inviteToken}/accept`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
    });

    it('should accept invite when the matching user calls it', async () => {
      // Register a user with the invited email
      const newUserRes = await request
        .post('/api/auth/register')
        .send({
          email: 'accept-test@test.com',
          password: 'password123',
          role: 'developer',
          companyName: 'Accept Co',
        })
        .expect(201);
      const newUserToken = newUserRes.body.token;

      const res = await request
        .post(`/api/invites/${inviteToken}/accept`)
        .set('Authorization', `Bearer ${newUserToken}`)
        .expect(200);

      expect(res.body.message).toBe('Invitation accepted');
      expect(res.body.organizationId).toBe(orgId);

      // Verify membership was created with joinedAt set
      const membership = await Membership.findOne({
        organizationId: orgId,
        userId: newUserRes.body.user.id,
      });
      expect(membership).not.toBeNull();
      expect(membership!.joinedAt).not.toBeNull();
      expect(membership!.role).toBe('admin');
    });

    it('should return 404 for invalid token', async () => {
      await request
        .post('/api/invites/invalidtoken123/accept')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('should return 410 for expired invite', async () => {
      // Create an already-expired invite
      const past = new Date(Date.now() - 1000);
      await TeamInvite.create({
        organizationId: orgId,
        invitedBy: ownerId,
        email: 'expired@test.com',
        role: 'member',
        token: 'expired-token-123',
        expiresAt: past,
        status: 'pending',
      });

      await request
        .post('/api/invites/expired-token-123/accept')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(410);
    });
  });

  describe('GET /api/organizations/:orgId/members', () => {
    it('should list all members and pending invites for the owner', async () => {
      const res = await request
        .get(`/api/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.members).toBeInstanceOf(Array);
      expect(res.body.invites).toBeInstanceOf(Array);

      // Should include owner + member + the user who accepted
      expect(res.body.members.length).toBeGreaterThanOrEqual(3);
      const ownerEntry = res.body.members.find((m: any) => m.role === 'owner');
      expect(ownerEntry).toBeDefined();
      expect(ownerEntry!.email).toBe('owner@org.test');
    });

    it('should reject member listing for regular member (owner/admin only)', async () => {
      await request
        .get(`/api/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('should reject listing for non-member (outsider)', async () => {
      await request
        .get(`/api/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
    });

    it('should reject listing without auth', async () => {
      await request.get(`/api/organizations/${orgId}/members`).expect(401);
    });
  });

  describe('DELETE /api/organizations/:orgId/members/:userId', () => {
    let removableUserId: string;

    beforeAll(async () => {
      // Add a user we can safely remove
      const userRes = await request
        .post('/api/auth/register')
        .send({
          email: 'removable@test.com',
          password: 'password123',
          role: 'developer',
          companyName: 'Removable',
        })
        .expect(201);
      removableUserId = userRes.body.user.id;

      await Membership.create({
        organizationId: orgId,
        userId: removableUserId,
        role: 'member',
        joinedAt: new Date(),
      });
    });

    it('should allow owner to remove a member', async () => {
      await request
        .delete(`/api/organizations/${orgId}/members/${removableUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const membership = await Membership.findOne({
        organizationId: orgId,
        userId: removableUserId,
      });
      expect(membership).toBeNull();
    });

    it('should prevent removing the last owner', async () => {
      // Owner is the only owner — trying to remove them should fail
      await request
        .delete(`/api/organizations/${orgId}/members/${ownerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });

    it('should reject removal by non-admin member', async () => {
      // memberToken belongs to a 'member' role user
      await request
        .delete(`/api/organizations/${orgId}/members/${ownerId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('should return 404 for non-existent user in org', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request
        .delete(`/api/organizations/${orgId}/members/${fakeId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('Team seat gating', () => {
    it('should enforce team seat limits based on plan', async () => {
      // Downgrade owner to Free (1 seat)
      await User.findByIdAndUpdate(ownerId, { planId: 'free' });

      // 1 current accepted member (owner) + 0 pending = 1, which would be at the limit
      // But we already have other accepted members. So the count will be > 1.
      // Free plan has 1 seat, so this should fail.
      const res = await request
        .post(`/api/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'seatlimit@test.com', role: 'member' })
        .expect(403);

      expect(res.body.error).toContain('Team seat limit reached');

      // Restore Agency plan
      await User.findByIdAndUpdate(ownerId, { planId: 'agency' });
    });
  });

  describe('Organization branding', () => {
    describe('GET /api/organizations', () => {
      it('should list organizations for the current user', async () => {
        const res = await request
          .get('/api/organizations')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        expect(res.body).toBeInstanceOf(Array);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
        expect(res.body[0].name).toBe('Owner Co');
      });

      it('should reject without auth', async () => {
        await request.get('/api/organizations').expect(401);
      });
    });

    describe('GET /api/organizations/:orgId', () => {
      it('should return org details with branding fields', async () => {
        const res = await request
          .get(`/api/organizations/${orgId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        expect(res.body._id).toBe(orgId);
        expect(res.body).toHaveProperty('logoUrl');
        expect(res.body).toHaveProperty('primaryColor');
        expect(res.body).toHaveProperty('reportFooterText');
      });

      it('should reject for non-member', async () => {
        await request
          .get(`/api/organizations/${orgId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);
      });
    });

    describe('POST /api/organizations/:orgId/branding', () => {
      it('should update branding fields (primaryColor, reportFooterText)', async () => {
        const res = await request
          .post(`/api/organizations/${orgId}/branding`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .field('primaryColor', '#ff6600')
          .field('reportFooterText', 'Powered by My Agency — contact@myagency.com')
          .expect(200);

        expect(res.body.message).toBe('Branding updated');
        expect(res.body.organization.primaryColor).toBe('#ff6600');
        expect(res.body.organization.reportFooterText).toBe(
          'Powered by My Agency — contact@myagency.com'
        );

        // Verify persisted
        const org = await Organization.findById(orgId);
        expect(org!.primaryColor).toBe('#ff6600');
        expect(org!.reportFooterText).toBe('Powered by My Agency — contact@myagency.com');
      });

      it('should reject invalid hex color', async () => {
        await request
          .post(`/api/organizations/${orgId}/branding`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .field('primaryColor', 'not-a-color')
          .expect(400);
      });

      it('should clear branding fields when empty string sent', async () => {
        await request
          .post(`/api/organizations/${orgId}/branding`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .field('primaryColor', '')
          .field('reportFooterText', '')
          .expect(200);

        const org = await Organization.findById(orgId);
        expect(org!.primaryColor).toBe('');
        expect(org!.reportFooterText).toBe('');
      });

      it('should reject branding update from member on free plan (402)', async () => {
        await request
          .post(`/api/organizations/${orgId}/branding`)
          .set('Authorization', `Bearer ${memberToken}`)
          .field('primaryColor', '#ff0000')
          .expect(402);
      });

      it('should reject branding update from outsider on free plan (402)', async () => {
        await request
          .post(`/api/organizations/${orgId}/branding`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .field('primaryColor', '#ff0000')
          .expect(402);
      });

      it('should reject branding update without auth', async () => {
        await request
          .post(`/api/organizations/${orgId}/branding`)
          .field('primaryColor', '#ff0000')
          .expect(401);
      });
    });
  });
});
