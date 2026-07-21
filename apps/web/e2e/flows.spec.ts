import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

async function createProject(page: any, name: string, domain: string) {
  const r = await page.request.post(`${API}/projects`, {
    data: { name, domain, triggerFirstAudit: false },
  });
  if (!r.ok()) {
    const body = await r.text();
    throw new Error(`Create project failed (${r.status()}): ${body.slice(0, 200)}`);
  }
  return r.json();
}

// ────────────────────────────── Flow 1: Landing page ─────────────────────────

test.describe('Flow 1: Landing page', () => {
  test('landing page loads with heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Rank in AI Overviews');
  });
});

// ──────────────────────────── Flow 2: Dashboard page ─────────────────────────

test.describe('Flow 2: Dashboard page', () => {
  test('dashboard loads empty state', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Application Error/i);
  });

  test('created project appears on dashboard', async ({ page }) => {
    const proj = await createProject(page, 'QA Dashboard', `qa-dash-${Date.now()}.com`);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`text=${proj.name}`).first()).toBeVisible({ timeout: 10000 });
  });
});

// ────────────────────────── Flow 3: Project detail page ──────────────────────

test.describe('Flow 3: Project detail page', () => {
  test('project detail loads', async ({ page }) => {
    const proj = await createProject(page, 'QA Detail', `qa-detail-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`text=${proj.name}`).first()).toBeVisible({ timeout: 10000 });
  });
});

// ──────────────────────────── Flow 4: Content editor ─────────────────────────

test.describe('Flow 4: Content editor', () => {
  test('editor loads without error', async ({ page }) => {
    const proj = await createProject(page, 'QA Content', `qa-content-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/content-editor`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });
});

// ──────────────────────────── Flow 5: Keywords page ──────────────────────────

test.describe('Flow 5: Keywords page', () => {
  test('keywords page loads without error', async ({ page }) => {
    const proj = await createProject(page, 'QA KW', `qa-kw-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/keywords`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });
});

// ──────────────────────────── Flow 6: Toolkit pages ──────────────────────────

test.describe('Flow 6: Toolkit pages', () => {
  test('Keyword Research page loads', async ({ page }) => {
    await page.goto('/keyword-research');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Keyword Research' })).toBeVisible({ timeout: 10000 });
  });

  test('Backlinks page loads', async ({ page }) => {
    const proj = await createProject(page, 'QA BL', `qa-bl-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/backlinks`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Backlink Analysis').first()).toBeVisible({ timeout: 10000 });
  });

  test('AI Visibility page loads', async ({ page }) => {
    const proj = await createProject(page, 'QA AV', `qa-av-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/ai-visibility`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/Application Error|not found/i);
  });

  test('Competitors page loads', async ({ page }) => {
    const proj = await createProject(page, 'QA Comp', `qa-comp-${Date.now()}.com`);
    await page.goto(`/projects/${proj._id}/competitors`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Competitor Analysis').first()).toBeVisible({ timeout: 10000 });
  });
});

// ──────────────────────────── Flow 7: Settings page ──────────────────────────

test.describe('Flow 7: Settings page', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });
});
