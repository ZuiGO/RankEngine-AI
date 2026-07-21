import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

// Mock BullMQ to prevent needing Redis
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    Worker: jest.fn(),
    QueueEvents: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock the stripeService module entirely to avoid needing real Stripe SDK
const mockCreateOrRetrieveCustomer = jest.fn();
const mockCreateCheckoutSession = jest.fn();
const mockCreatePortalSession = jest.fn();
const mockConstructWebhookEvent = jest.fn();
const mockParseSubscriptionMetadata = jest.fn();

jest.mock('../src/services/stripeService', () => ({
  createOrRetrieveCustomer: mockCreateOrRetrieveCustomer,
  createCheckoutSession: mockCreateCheckoutSession,
  createPortalSession: mockCreatePortalSession,
  constructWebhookEvent: mockConstructWebhookEvent,
  parseSubscriptionMetadata: mockParseSubscriptionMetadata,
}));

// Set env vars before importing app
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_billing';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
process.env.STRIPE_PRICE_PRO = 'price_pro_mock';
process.env.STRIPE_PRICE_AGENCY = 'price_agency_mock';

const app = require('../src/app').default;
const { User } = require('../src/models/User');

const request = supertest(app);

let userToken: string;
let userId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  const res = await request
    .post('/api/auth/register')
    .send({
      email: 'billing@rankengine.ai',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Billing Test Co',
    })
    .expect(201);
  userToken = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/billing/create-checkout-session', () => {
  const validPayload = { planId: 'pro' };

  it('requires authentication', async () => {
    const res = await request
      .post('/api/billing/create-checkout-session')
      .send(validPayload)
      .expect(401);

    expect(res.body.error).toBe('Unauthorized: No token provided');
  });

  it('validates planId is required', async () => {
    const res = await request
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects free plan', async () => {
    const res = await request
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ planId: 'free' })
      .expect(400);

    expect(res.body.error).toBe('Free plan does not require a checkout session');
  });

  it('creates a Stripe customer and checkout session, returns URL', async () => {
    mockCreateOrRetrieveCustomer.mockResolvedValue('cus_mock123');
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/cs_test_mock');

    const res = await request
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send(validPayload)
      .expect(200);

    expect(res.body.url).toBe('https://checkout.stripe.com/cs_test_mock');
    expect(mockCreateOrRetrieveCustomer).toHaveBeenCalledWith(
      userId,
      'billing@rankengine.ai',
      undefined
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      'cus_mock123',
      'pro',
      expect.stringContaining('success=1'),
      expect.stringContaining('canceled=1')
    );

    const user = await User.findById(userId);
    expect(user.stripeCustomerId).toBe('cus_mock123');
  });

  it('reuses existing Stripe customer ID', async () => {
    await User.findByIdAndUpdate(userId, { stripeCustomerId: 'cus_existing' });

    mockCreateOrRetrieveCustomer.mockResolvedValue('cus_existing');
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/cs_test_456');

    const res = await request
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send(validPayload)
      .expect(200);

    expect(res.body.url).toBe('https://checkout.stripe.com/cs_test_456');
    expect(mockCreateOrRetrieveCustomer).toHaveBeenCalledWith(
      userId,
      'billing@rankengine.ai',
      'cus_existing'
    );

    await User.findByIdAndUpdate(userId, { $unset: { stripeCustomerId: '' } });
  });
});

describe('GET /api/billing/portal-session', () => {
  it('requires authentication', async () => {
    const res = await request.get('/api/billing/portal-session').expect(401);

    expect(res.body.error).toBe('Unauthorized: No token provided');
  });

  it('returns error if user has no Stripe customer', async () => {
    const res = await request
      .get('/api/billing/portal-session')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);

    expect(res.body.error).toBe('No Stripe customer found. Subscribe first.');
  });

  it('creates a portal session and returns URL', async () => {
    await User.findByIdAndUpdate(userId, { stripeCustomerId: 'cus_portal_test' });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/session/mock');

    const res = await request
      .get('/api/billing/portal-session')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.url).toBe('https://billing.stripe.com/session/mock');
    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      'cus_portal_test',
      expect.stringContaining('billing')
    );
  });
});

describe('POST /api/billing/webhook', () => {
  const sendWebhook = (payload: object, signature?: string) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = request.post('/api/billing/webhook').set('Content-Type', 'application/json');
    if (signature) {
      req.set('stripe-signature', signature);
    }
    return req.send(body);
  };

  it('rejects request without stripe-signature header', async () => {
    const res = await sendWebhook({ type: 'checkout.session.completed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing stripe-signature header');
  });

  it('rejects request with invalid signature', async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const res = await sendWebhook({ type: 'checkout.session.completed' }, 'invalid_sig');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  describe('checkout.session.completed', () => {
    it('updates user plan and subscription fields', async () => {
      await User.findByIdAndUpdate(userId, {
        stripeCustomerId: 'cus_webhook_test',
        planId: 'free',
        subscriptionStatus: 'active',
        dataProviderMonthlyLimit: 100,
      });

      mockConstructWebhookEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_webhook_test',
            subscription: 'sub_webhook_test_123',
            metadata: { planId: 'pro' },
          },
        },
      });

      const res = await sendWebhook({ type: 'checkout.session.completed' }, 'valid_sig');
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      const user = await User.findById(userId);
      expect(user.stripeSubscriptionId).toBe('sub_webhook_test_123');
      expect(user.planId).toBe('pro');
      expect(user.subscriptionStatus).toBe('active');
      expect(user.dataProviderMonthlyLimit).toBe(2000);
    });
  });

  describe('customer.subscription.updated', () => {
    it('updates status to past_due when subscription becomes past_due', async () => {
      await User.findByIdAndUpdate(userId, {
        stripeCustomerId: 'cus_pastdue_test',
        planId: 'pro',
        subscriptionStatus: 'active',
      });

      mockConstructWebhookEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_pastdue',
            customer: 'cus_pastdue_test',
            status: 'past_due',
            metadata: { planId: 'pro' },
          },
        },
      });
      mockParseSubscriptionMetadata.mockReturnValue({
        customerId: 'cus_pastdue_test',
        subscriptionId: 'sub_pastdue',
        planId: 'pro',
        status: 'past_due',
      });

      const res = await sendWebhook({ type: 'customer.subscription.updated' }, 'valid_sig');
      expect(res.status).toBe(200);

      const user = await User.findById(userId);
      expect(user.subscriptionStatus).toBe('past_due');
      expect(user.planId).toBe('pro');
    });
  });

  describe('customer.subscription.deleted', () => {
    it('resets user to free plan', async () => {
      await User.findByIdAndUpdate(userId, {
        stripeCustomerId: 'cus_cancel_test',
        stripeSubscriptionId: 'sub_cancel_test',
        planId: 'agency',
        subscriptionStatus: 'active',
        dataProviderMonthlyLimit: 10000,
      });

      mockConstructWebhookEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_cancel_test',
            customer: 'cus_cancel_test',
            status: 'canceled',
            metadata: { planId: 'agency' },
          },
        },
      });
      mockParseSubscriptionMetadata.mockReturnValue({
        customerId: 'cus_cancel_test',
        subscriptionId: 'sub_cancel_test',
        planId: 'agency',
        status: 'canceled',
      });

      const res = await sendWebhook({ type: 'customer.subscription.deleted' }, 'valid_sig');
      expect(res.status).toBe(200);

      const user = await User.findById(userId);
      expect(user.planId).toBe('free');
      expect(user.subscriptionStatus).toBe('canceled');
      expect(user.stripeSubscriptionId).toBeNull();
      expect(user.dataProviderMonthlyLimit).toBe(100);
    });
  });

  it('handles unhandled event types gracefully', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_mock' } },
    });

    const res = await sendWebhook({ type: 'invoice.payment_succeeded' }, 'valid_sig');
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
