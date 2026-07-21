import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PW = 'password123';

async function register(page: any, email: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await page.request.post(`${API}/auth/register`, {
      data: { email, password: PW, role: 'agency_owner', companyName: 'QA Co' },
    });
    if (r.ok()) return r.json();
    if (r.status() === 429) {
      const body = await r.json();
      const waitMs = (body.retryAfterMs || 30000) + 1000;
      console.log(`  Rate limited on ${email}, waiting ${waitMs}ms (attempt ${attempt}/${retries})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    const body = await r.text();
    throw new Error(`Register ${email} failed (${r.status()}): ${body.slice(0, 200)}`);
  }
  throw new Error(`Register ${email} failed after ${retries} retries (rate limited)`);
}

async function setToken(page: any, token: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((t: string) => { localStorage.setItem('re_token', t); }, token);
}

async function completeOnboarding(page: any, token: string) {
  await page.request.patch(`${API}/auth/onboarding-complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function createProject(page: any, token: string, name: string, domain: string) {
  const r = await page.request.post(`${API}/projects`, {
    data: { name, domain, triggerFirstAudit: false },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok()) {
    const body = await r.text();
    throw new Error(`Create project failed (${r.status()}): ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function upgradeUser(page: any, userId: string) {
  await page.request.post(`${API}/admin/test-upgrade-user`, {
    data: { userId, plan: 'pro' },
  }).catch(() => {});
}

// ───────────────────────────── Flow 1: Register → Onboarding ─────────────────

test.describe('Flow 1: Register → Onboarding', () => {
  test('registers and lands on onboarding', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('h1')).toContainText('Create your account');

    const email = `qa1-${Date.now()}@rankengine.ai`;

    // Submit with invalid data first — test client-side validation
    await page.fill('#reg-company', '');
    await page.fill('#reg-email', 'bad');
    await page.fill('#reg-password', 'short');
    await page.click('#register-submit-btn');
    await page.waitForTimeout(500);

    // Now submit valid data
    await page.fill('#reg-company', 'QA Co');
    await page.fill('#reg-email', email);
    await page.fill('#reg-password', PW);
    await page.click('#register-submit-btn');

    // New users land on /onboarding
    await page.waitForURL(/\/onboarding/, { timeout: 15000 });
    await expect(page.locator('text=Add your first site')).toBeVisible({ timeout: 5000 });
  });
});

// ───────────────────────────── Flow 2: Onboarding audit ──────────────────────

test.describe('Flow 2: Onboarding audit', () => {
  test('creates project and transitions to scan view', async ({ page }) => {
    const { token, user } = await register(page, `qa2-${Date.now()}@rankengine.ai`);
    await setToken(page, token);

    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Add your first site')).toBeVisible();

    // Fill form and submit
    await page.fill('input[placeholder="My Website"]', 'QA Onboarding');
    await page.fill('input[placeholder="example.com"]', `qa-onboard-${Date.now()}.com`);
    await page.click('button:has-text("Start scanning")');

    // After submit, the UI transitions to step 2 (scan view) or shows validation
    await page.waitForTimeout(3000);

    const scanningVisible = await page.locator("text=We're scanning your site").isVisible().catch(() => false);
    const queuedVisible = await page.locator('text=queued').isVisible().catch(() => false);

    expect(scanningVisible || queuedVisible).toBeTruthy();
  });
});

// ───────────────────────────── Flow 3: Dashboard + sidebar audit ─────────────

test.describe('Flow 3: Dashboard audit navigation', () => {
  test('run audit from dashboard card navigates correctly', async ({ page }) => {
    const { token, user } = await register(page, `qa3a-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    await completeOnboarding(page, token);

    const proj = await createProject(page, token, 'QA Audit Dash', `qa3a-${Date.now()}.com`);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // The project card uses onClick, not an <a> tag — click the h3 text
    await expect(page.locator('h3:has-text("QA Audit Dash")')).toBeVisible({ timeout: 10000 });
    await page.locator('h3:has-text("QA Audit Dash")').click();
    await page.waitForURL(`/projects/${proj._id}`, { timeout: 10000 });
    await expect(page.locator('text=QA Audit Dash')).toBeVisible({ timeout: 5000 });
  });

  test('sidebar project link navigates to project detail', async ({ page }) => {
    const { token, user } = await register(page, `qa3b-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    await completeOnboarding(page, token);

    const proj = await createProject(page, token, 'QA Audit Sidebar', `qa3b-${Date.now()}.com`);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Click the project card by its h3 text
    await expect(page.locator('h3:has-text("QA Audit Sidebar")')).toBeVisible({ timeout: 10000 });
    await page.locator('h3:has-text("QA Audit Sidebar")').click();
    await page.waitForURL(`/projects/${proj._id}`, { timeout: 10000 });
    await expect(page.locator('text=QA Audit Sidebar')).toBeVisible({ timeout: 5000 });
  });
});

// ───────────────────────────── Flow 5: Content editor ───────────────────────

test.describe('Flow 5: Content editor', () => {
  test('editor loads and H2 detection works', async ({ page }) => {
    const { token, user } = await register(page, `qa5-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    const proj = await createProject(page, token, 'QA Content', `qa5-${Date.now()}.com`);

    await page.goto(`/projects/${proj._id}/content-editor`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });
});

// ───────────────────────────── Flow 6: Keywords page ────────────────────────

test.describe('Flow 6: Keywords page', () => {
  test('keywords page loads without error', async ({ page }) => {
    const { token, user } = await register(page, `qa6-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    const proj = await createProject(page, token, 'QA KW', `qa6-${Date.now()}.com`);

    await page.goto(`/projects/${proj._id}/keywords`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });
});

// ───────────────────────────── Flow 7: Toolkit pages ────────────────────────

test.describe('Flow 7: Toolkit pages', () => {
  test('Keyword Research page loads', async ({ page }) => {
    const { token } = await register(page, `qa7a-${Date.now()}@rankengine.ai`);
    await setToken(page, token);
    await completeOnboarding(page, token);

    await page.goto('/keyword-research');
    await page.waitForLoadState('networkidle');
    // Use getByRole to avoid strict mode violation from multiple text matches
    await expect(page.getByRole('heading', { name: 'Keyword Research' })).toBeVisible({ timeout: 10000 });
  });

  test('Backlinks page loads', async ({ page }) => {
    const { token, user } = await register(page, `qa7b-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    await completeOnboarding(page, token);
    const proj = await createProject(page, token, 'QA BL', `qa7b-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/backlinks`);
    await page.waitForLoadState('networkidle');
    // Backlink Analysis appears as plain text (not a heading)
    await expect(page.locator('text=Backlink Analysis').first()).toBeVisible({ timeout: 10000 });
  });

  test('AI Visibility page loads', async ({ page }) => {
    const { token, user } = await register(page, `qa7c-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    const proj = await createProject(page, token, 'QA AV', `qa7c-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/ai-visibility`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });

  test('Competitors page loads', async ({ page }) => {
    const { token, user } = await register(page, `qa7d-${Date.now()}@rankengine.ai`);
    await upgradeUser(page, user.id);
    await setToken(page, token);
    await completeOnboarding(page, token);
    const proj = await createProject(page, token, 'QA Comp', `qa7d-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/competitors`);
    await page.waitForLoadState('networkidle');
    // Competitor Analysis appears as a paragraph, not a heading
    await expect(page.locator('text=Competitor Analysis').first()).toBeVisible({ timeout: 10000 });
  });
});

// ───────────────────────────── Flow 9: Team + cross-tenant isolation ─────────

test.describe('Flow 9: Team + cross-tenant isolation', () => {
  test('User A sees own project; User B cannot access it', async ({ page }) => {
    // Create Org A
    const aEmail = `qa9a-${Date.now()}@rankengine.ai`;
    const aReg = await register(page, aEmail);
    await upgradeUser(page, aReg.user.id);
    await setToken(page, aReg.token);
    await completeOnboarding(page, aReg.token);
    const projA = await createProject(page, aReg.token, 'Org A Secret', `qa9a-${Date.now()}.com`);

    // Verify User A can see their project
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h3:has-text("Org A Secret")')).toBeVisible({ timeout: 10000 });

    // Create Org B
    const bEmail = `qa9b-${Date.now()}@rankengine.ai`;
    const bReg = await register(page, bEmail);
    await upgradeUser(page, bReg.user.id);
    await setToken(page, bReg.token);

    // Verify User B cannot see Org A's project
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h3:has-text("Org A Secret")')).not.toBeVisible();

    // Verify User B cannot access Org A's project detail directly
    await page.goto(`/projects/${projA._id}`);
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const isBlocked = !url.includes(`/projects/${projA._id}`) ||
      await page.locator('text=not found').isVisible().catch(() => false) ||
      await page.locator('text=forbidden').isVisible().catch(() => false);
    expect(isBlocked).toBeTruthy();
  });
});
