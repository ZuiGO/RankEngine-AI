// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyzePage from './AnalyzePage';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...mod,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  };
});

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    motion: new Proxy({}, {
      get: (_target, prop: string) => {
        return ({ children, whileHover, whileTap, initial, animate, exit, transition, ...rest }: any) => {
          const Tag = (prop || 'div') as any;
          return <Tag {...rest}>{children}</Tag>;
        };
      },
    }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

const mockReportData = {
  report: {
    projectId: 'proj1',
    generatedAt: '2025-01-15T12:00:00Z',
    counts: {
      pageCount: 15,
      totalLinks: 120,
      totalHyperlinks: 120,
      internalLinks: 95,
      backlinkCount: 500,
    },
    pages: [
      {
        url: 'https://test.com/page-1',
        issues: [
          {
            severity: 'critical' as const,
            category: 'redirect',
            description: 'Redirect chain detected',
          },
        ],
      },
    ],
  },
  actionItems: [
    {
      contentId: 'issue123',
      pageUrl: 'https://test.com/page-1',
      impactOnRanking: 'Redirect chains dilute link equity.',
      identifiedIssues: 'redirect — Redirect chain detected',
      howToImprove: 'Replace with direct 301 redirect.',
      status: 'open' as const,
    },
  ],
};

describe('AnalyzePage Component Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('Test 1: submits a URL, mocks successful audit completion, and loads/navigates to report view', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/projects/by-domain')) {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url.includes('/report')) {
        return Promise.resolve({ data: mockReportData } as any);
      }
      if (url.includes('/crawl-jobs/')) {
        return Promise.resolve({ data: { _id: 'job123', status: 'completed', pageCount: 15 } } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    mockedApi.post.mockImplementation((url: string) => {
      if (url.includes('/crawl')) {
        return Promise.resolve({ data: { crawlJobId: 'job123' } } as any);
      }
      if (url === '/projects' || url.endsWith('/projects')) {
        return Promise.resolve({ data: { _id: 'proj1', name: 'Test', domain: 'https://newsite.com' } } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    render(
      <MemoryRouter>
        <AnalyzePage />
      </MemoryRouter>
    );

    const input = screen.getByTestId('url-analyze-input');
    fireEvent.change(input, { target: { value: 'https://newsite.com' } });

    const button = screen.getByTestId('url-analyze-btn');
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj1');
    });
  });

  it('Test 2: renders report view with mock data, asserting Overview, Pages, and Action Items sections', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/report')) {
        return Promise.resolve({ data: mockReportData } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    render(
      <MemoryRouter>
        <AnalyzePage initialProjectId="proj1" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-section')).toBeInTheDocument();
      expect(screen.getByTestId('pages-section')).toBeInTheDocument();
      expect(screen.getByTestId('action-items-section')).toBeInTheDocument();
    });

    // Assert counts render in overview
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getAllByText('120')).toHaveLength(2); // totalLinks + totalHyperlinks
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();

    // Assert page URL in pages section and action items section
    expect(screen.getAllByText('https://test.com/page-1')).toHaveLength(2);

    // Assert action item fields in action items section
    expect(screen.getByText('Redirect chains dilute link equity.')).toBeInTheDocument();
    expect(screen.getByText('Replace with direct 301 redirect.')).toBeInTheDocument();
  });

  it('Test 3: clicks Approve on an action item and asserts it calls the PendingChange approval endpoint', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/report')) {
        return Promise.resolve({ data: mockReportData } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    mockedApi.post.mockImplementation((url: string) => {
      if (url.includes('/pending-changes/')) {
        return Promise.resolve({ data: { success: true } } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    render(
      <MemoryRouter>
        <AnalyzePage initialProjectId="proj1" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overview-section')).toBeInTheDocument();
    });

    const approveBtn = screen.getByTestId('approve-btn-issue123');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        expect.stringMatching(/\/pending-changes\/issue123\/approve/)
      );
    });
  });
});
