import { describe, it, expect } from 'vitest';
import { resolveNavRoute, NAV_GROUPS } from './Layout';

const PROJECT_ID = '507f1f77bcf86cd799439011';

function flattenItems() {
  const items: { label: string; to: string | null }[] = [];
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
      if (item.to === '/keyword-research') continue; // global route — works without project
      it(`"${item.label}" returns null`, () => {
        const route = resolveNavRoute(item, null);
        expect(route).toBeNull();
      });
    }
  });

  it('routes "Audit / Checklist" to the project detail page root', () => {
    const route = resolveNavRoute(
      { label: 'Audit / Checklist', to: null, icon: '' },
      PROJECT_ID,
    );
    expect(route).toBe(`/projects/${PROJECT_ID}`);
  });

  it('routes "Migration Check" to the project detail page root', () => {
    const route = resolveNavRoute(
      { label: 'Migration Check', to: null, icon: '' },
      PROJECT_ID,
    );
    expect(route).toBe(`/projects/${PROJECT_ID}`);
  });

  it('routes "Keyword Research" globally regardless of project selection', () => {
    const route = resolveNavRoute(
      { label: 'Keyword Research', to: '/keyword-research', icon: '' },
      null,
    );
    expect(route).toBe('/keyword-research');
  });
});
