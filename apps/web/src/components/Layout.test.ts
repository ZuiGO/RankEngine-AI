import { describe, it, expect } from 'vitest';
import { resolveNavRoute, NAV_GROUPS, type NavItemDef } from './Layout';

const PROJECT_ID = '507f1f77bcf86cd799439011';

function flattenItems() {
  const items: NavItemDef[] = [];
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      items.push(item);
    }
  }
  return items;
}

describe('resolveNavRoute', () => {
  describe('returns a non-null route for every NAV_GROUPS item when a project is selected', () => {
    const items = flattenItems();

    for (const item of items) {
      it(`"${item.label}" resolves to a non-null path`, () => {
        const route = resolveNavRoute(item, PROJECT_ID);
        expect(route).not.toBeNull();
      });
    }
  });

  describe('returns null for project-scoped items when no project is selected', () => {
    const items = flattenItems();

    for (const item of items) {
      if (item.to === '/keyword-research') continue;
      it(`"${item.label}" returns null`, () => {
        const route = resolveNavRoute(item, null);
        expect(route).toBeNull();
      });
    }
  });

  it('routes "Audit / Checklist" to the project detail page root', () => {
    const route = resolveNavRoute(
      { label: 'Audit / Checklist', to: null, icon: 'M9 12l2 2 4-4' },
      PROJECT_ID,
    );
    expect(route).toBe(`/projects/${PROJECT_ID}`);
  });

  it('routes "Migration Check" to the project detail page root', () => {
    const route = resolveNavRoute(
      { label: 'Migration Check', to: null, icon: 'M9 12l2 2 4-4' },
      PROJECT_ID,
    );
    expect(route).toBe(`/projects/${PROJECT_ID}`);
  });

  it('routes "Keyword Research" globally regardless of project selection', () => {
    const route = resolveNavRoute(
      { label: 'Keyword Research', to: '/keyword-research', icon: 'M9 12l2 2 4-4' },
      null,
    );
    expect(route).toBe('/keyword-research');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE ↔ NAVIGATION CROSS-REFERENCE
// Every nav item must point to a route that exists in the router, and every
// route (except intentional orphans) must be reachable from at least one nav
// path.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_ROUTES = [
  '/dev/score-reveal',
  '/',
  '/dashboard',
  '/projects/:id',
  '/projects/:id/content-editor',
  '/projects/:id/content-writer',
  '/projects/:id/keywords',
  '/projects/:id/keyword-clustering',
  '/projects/:id/cwv',
  '/projects/:id/internal-links',
  '/projects/:id/chat',
  '/projects/:id/backlinks',
  '/projects/:id/ai-visibility',
  '/projects/:id/competitors',
  '/projects/:id/reports/content-performance',
  '/projects/:id/reports/comparison',
  '/projects/:id/settings',
  '/keyword-research',
  '/settings',
  '/notifications',
] as const;

type Route = (typeof ALL_ROUTES)[number];

/** Routes that intentionally have no nav link (dev-only, redirect-only, or direct-link). */
const INTENTIONAL_ORPHANS: Route[] = [
  '/dev/score-reveal',
  '/',
  '/projects/:id/chat',
  '/projects/:id/content-writer',
];

/**
 * Resolves :id param placeholders — a nav item pointing to a concrete
 * `/projects/abc123/keywords` should match the abstract route `/projects/:id/keywords`.
 */
function abstractify(path: string): string {
  return path.replace(/\/projects\/[^/]+/g, '/projects/:id');
}

/** All navigation paths that a user can click or be redirected to. */
function collectAllNavPaths(): string[] {
  const paths: string[] = [];

  // NAV_GROUPS with a project selected
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const resolved = resolveNavRoute(item as any, PROJECT_ID);
      if (resolved) paths.push(resolved);
    }
  }

  // Static sidebar links (Layout.tsx)
  paths.push('/dashboard');           // All Projects
  paths.push('/settings');            // Settings
  paths.push('/notifications');       // Notifications

  // User menu (Layout.tsx)
  paths.push('/settings');

  return [...new Set(paths)];
  // ^ deduplicate before returning
}

describe('Route ↔ nav cross-reference', () => {
  const navPaths = collectAllNavPaths();

  describe('every nav path resolves to a route in the router', () => {
    for (const navPath of navPaths) {
      it(`${navPath} exists in ALL_ROUTES`, () => {
        const abstract = abstractify(navPath);
        expect(ALL_ROUTES).toContain(abstract);
      });
    }
  });

  describe('every route (except intentional orphans) is reachable from at least one nav path', () => {
    for (const route of ALL_ROUTES) {
      if (INTENTIONAL_ORPHANS.includes(route)) continue;

      it(`${route} is reachable from nav`, () => {
        const matching = navPaths.filter((p) => abstractify(p) === route);
        expect(
          matching.length,
          `${route} has no nav item pointing to it`,
        ).toBeGreaterThanOrEqual(1);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED Link / navigate() TARGET CROSS-REFERENCE
// Every static Link to / navigate() path found across the codebase must also
// resolve to a route in ALL_ROUTES.
// ─────────────────────────────────────────────────────────────────────────────

const LINK_TARGETS = [
  // LandingPage.tsx
  '/',
  // ProjectDetailPage.tsx — breadcrumb
  '/dashboard',
  // BacklinksPage.tsx — breadcrumb
  '/projects/:id',    // "Back to Project"
  // CompetitorsPage.tsx — breadcrumb
  '/projects/:id',    // "Back to Project"
  // AiVisibilityPage.tsx — breadcrumb
  '/projects/:id',    // "Back to Project"
];

const NAVIGATE_CALLS = [
  '/dashboard',
];

describe('Link / navigate() targets cross-reference', () => {
  for (const target of [...new Set(LINK_TARGETS)]) {
    it(`Link target "${target}" exists in ALL_ROUTES`, () => {
      expect(ALL_ROUTES).toContain(target);
    });
  }

  for (const target of [...new Set(NAVIGATE_CALLS)]) {
    it(`navigate() target "${target}" exists in ALL_ROUTES`, () => {
      expect(ALL_ROUTES).toContain(target);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LABEL_ROUTE_MAP INTEGRITY
// Every NAV_GROUPS item with `to: null` (project-scoped) must have an entry
// in LABEL_ROUTE_MAP so resolveNavRoute can resolve it.
// ─────────────────────────────────────────────────────────────────────────────

describe('LABEL_ROUTE_MAP covers every project-scoped nav item', () => {
  // This is the same map defined in Layout.tsx — duplicated here as a safety net
  // so any future edit to NAV_GROUPS without updating the map will fail the test.
  const LABEL_ROUTE_MAP: Record<string, string> = {
    'Audit / Checklist': '',
    'Migration Check': '',
    'Core Web Vitals': '/cwv',
    'Content Editor & AI Writer': '/content-editor',
    'Content Editor': '/content-editor',
    'AI Writer': '/content-editor',
    'Keywords': '/keywords',
    'Keyword Clustering': '/keyword-clustering',
    'Backlinks': '/backlinks',
    'AI Visibility': '/ai-visibility',
    'Overview & Gap Analysis': '/competitors',
    'Internal Linking': '/internal-links',
    'Content Performance': '/reports/content-performance',
    'Before / After': '/reports/comparison',
    'Project Settings': '/settings',
  };

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.to !== null) continue; // global route, not project-scoped

      it(`"${item.label}" has a LABEL_ROUTE_MAP entry`, () => {
        expect(
          LABEL_ROUTE_MAP,
          `Missing LABEL_ROUTE_MAP entry for "${item.label}"`,
        ).toHaveProperty(item.label);
      });
    }
  }
});
