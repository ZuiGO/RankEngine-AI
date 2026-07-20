import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import {
  buildDigestForUser,
  sendWeeklyDigests,
} from '../src/services/weeklyDigestService';
import { User } from '../src/models/User';
import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { TrackedKeyword } from '../src/models/TrackedKeyword';
import { RankSnapshot } from '../src/models/RankSnapshot';
import { Notification } from '../src/models/Notification';
import { _setEmailService, IEmailService } from '../src/services/emailService';

let mongoServer: MongoMemoryServer;

// Capture sent emails for assertion
const sentEmails: { to: string; subject: string; textBody: string }[] = [];

class MockEmailService implements IEmailService {
  async sendEmail(to: string, subject: string, textBody: string): Promise<boolean> {
    sentEmails.push({ to, subject, textBody });
    return true;
  }
}

let userId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  _setEmailService(new MockEmailService());

  // Create a test user
  const passwordHash = await bcrypt.hash('password123', 12);
  const user = await User.create({
    email: 'testuser@rankengine.ai',
    passwordHash,
    role: 'agency_owner',
    companyName: 'TestCo',
    emailDigestEnabled: true,
  });
  userId = user._id.toString();
});

afterAll(async () => {
  _setEmailService(new (require('../src/services/emailService').ConsoleEmailService)());
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(() => {
  sentEmails.length = 0; // Clear captured emails
});

describe('Weekly Digest', () => {
  it('should return null when user has digest disabled', async () => {
    await User.findByIdAndUpdate(userId, { emailDigestEnabled: false });
    const result = await buildDigestForUser(userId);
    expect(result).toBeNull();

    await User.findByIdAndUpdate(userId, { emailDigestEnabled: true });
  });

  it('should return null when user has no projects', async () => {
    const result = await buildDigestForUser(userId);
    expect(result).toBeNull();
  });

  it('should build correct digest from a week of mock activity', async () => {
    // Create a project
    const project = await Project.create({
      name: 'TestSite',
      domain: 'https://testsite.com',
      ownerId: new mongoose.Types.ObjectId(userId),
    });

    // Create a crawl job from 3 days ago (within the 7-day window)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      pageCount: 10,
      completedAt: threeDaysAgo,
    });

    // Create critical issue on that crawl
    await AuditIssue.create({
      crawlJobId: crawlJob._id,
      severity: 'critical',
      category: 'meta',
      url: 'https://testsite.com/page1',
      description: 'Missing meta title',
      recommendation: 'Add a meta title',
    });

    // Create a tracked keyword
    const kw = await TrackedKeyword.create({
      projectId: project._id,
      keyword: 'seo audit tool',
      targetUrl: 'https://testsite.com/audit',
    });

    // Create an old snapshot (10 days ago) at position 10
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    await RankSnapshot.create({
      keywordId: kw._id,
      projectId: project._id,
      position: 10,
      date: tenDaysAgo,
    });

    // Create a recent snapshot (1 day ago) at position 5 (improved)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    await RankSnapshot.create({
      keywordId: kw._id,
      projectId: project._id,
      position: 5,
      date: oneDayAgo,
    });

    // Create a competitor alert notification from 2 days ago
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    await Notification.create({
      userId: new mongoose.Types.ObjectId(userId),
      projectId: project._id,
      message: 'Competitor "rival.com" jumped 5 positions for "seo audit tool"',
      createdAt: twoDaysAgo,
    });

    // Build and assert digest
    const digest = await buildDigestForUser(userId);
    expect(digest).not.toBeNull();

    expect(digest!.auditsRun).toBe(1);
    expect(digest!.newCriticalIssues).toBe(1);
    expect(digest!.keywordsUp).toBe(1); // 10 → 5 is improvement
    expect(digest!.keywordsDown).toBe(0);
    expect(digest!.competitorAlerts).toBe(1);

    // Per-project summary
    expect(digest!.projectSummaries).toHaveLength(1);
    expect(digest!.projectSummaries[0].projectName).toBe('TestSite');
    expect(digest!.projectSummaries[0].auditsRun).toBe(1);
    expect(digest!.projectSummaries[0].criticalIssues).toBe(1);
    expect(digest!.projectSummaries[0].keywordsUp).toBe(1);
    expect(digest!.projectSummaries[0].keywordsDown).toBe(0);
    expect(digest!.projectSummaries[0].alerts).toBe(1);
  });

  it('should send email via the email service and contain correct summary text', async () => {
    const count = await sendWeeklyDigests();
    expect(count).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('testuser@rankengine.ai');
    expect(sentEmails[0].subject).toContain('weekly RankEngine AI digest');

    // Verify email body contains key digest numbers
    const body = sentEmails[0].textBody;
    expect(body).toContain('Audits run: 1');
    expect(body).toContain('New critical issues found: 1');
    expect(body).toContain('Rankings: 1 improved, 0 declined');
    expect(body).toContain('Competitor alerts triggered: 1');
    expect(body).toContain('TestCo');
    expect(body).toContain('https://app.rankengine.ai/dashboard');
  });
});
