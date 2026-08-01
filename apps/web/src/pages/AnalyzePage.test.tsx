import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnalyzePage, { type SiteReportData } from './AnalyzePage';
import api from '../lib/api';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === 'then' || prop === 'constructor' || prop === 'prototype') {
          return undefined;
        }
        return ({ children, className, ...props }: any) => {
          const Component = prop as any;
          return <Component className={className} {...props}>{children}</Component>;
        };
      },
    }
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('../lib/api');
const mockedApi = api as any;

const mockReportData: SiteReportData = {
  report: {
    projectId: 'proj-123',
    generatedAt: new Date().toISOString(),
    counts: {
      pageCount: 1,
      totalLinks: 5,
      totalHyperlinks: 5,
      internalLinks: 3,
      backlinkCount: 10,
    },
    pages: [
      {
        url: 'https://example.com/report-page',
        issues: [
          {
            severity: 'critical',
            category: 'seo-title',
            description: 'Title tag missing',
          },
        ],
        content: [
          {
            contentType: 'pdf',
            sourceUrl: 'https://example.com/guide.pdf',
            extractionStatus: 'success',
            extractedText: 'Extracted PDF text sample',
            extractedTables: [
              {
                sheetName: 'Table 1',
                headers: ['Keyword', 'Volume'],
                rows: [['seo tool', '10000']],
              },
            ],
          },
          {
            contentType: 'video',
            sourceUrl: 'https://example.com/promo.mp4',
            hasTranscript: false,
            extractionStatus: 'success',
          },
          {
            contentType: 'image',
            sourceUrl: 'https://example.com/logo.png',
            altText: 'Company Logo',
            extractionStatus: 'success',
          },
        ],
      },
    ],
  },
  actionItems: [
    {
      contentId: 'issue-1',
      pageUrl: 'https://example.com/report-page',
      impactOnRanking: 'Crucial ranking signal missing',
      identifiedIssues: 'seo-title — Title tag missing',
      howToImprove: 'Add title tag',
      status: 'open',
    },
    {
      contentId: 'content-issue-2',
      pageUrl: 'https://example.com/report-page',
      impactOnRanking: 'Search engines cannot index audio streams',
      identifiedIssues: 'video-transcript — Video missing caption track',
      howToImprove: 'Add WebVTT captions',
      status: 'open',
    },
  ],
};

describe('AnalyzePage — Content Inventory & Unified Action Items (Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.includes('report')) {
        return { data: mockReportData };
      }
      return { data: { _id: 'proj-123', name: 'Example Project', domain: 'example.com' } };
    });
  });

  it('Test 1: renders page section with mock PageContent items of varying types and asserts correct badges per type', async () => {
    render(
      <MemoryRouter>
        <AnalyzePage initialProjectId="proj-123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-url-0')).toHaveTextContent('https://example.com/report-page');
    });

    // Expand page item
    fireEvent.click(screen.getByTestId('page-expand-btn-0'));

    // Assert content badges render for pdf, video, image
    await waitFor(() => {
      expect(screen.getByTestId('content-badge-pdf')).toBeInTheDocument();
      expect(screen.getByTestId('content-badge-video')).toBeInTheDocument();
      expect(screen.getByTestId('content-badge-image')).toBeInTheDocument();
    });
  });

  it('Test 2: clicks into a PDF content item with mock extractedTables and asserts the table renders', async () => {
    render(
      <MemoryRouter>
        <AnalyzePage initialProjectId="proj-123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-url-0')).toHaveTextContent('https://example.com/report-page');
    });

    // Expand page
    fireEvent.click(screen.getByTestId('page-expand-btn-0'));

    await waitFor(() => {
      expect(screen.getByTestId('view-content-0-0')).toBeInTheDocument();
    });

    // Click "View Extracted Data" for PDF (index 0)
    fireEvent.click(screen.getByTestId('view-content-0-0'));

    // Assert table headers and rows render
    await waitFor(() => {
      expect(screen.getByTestId('extracted-table-0')).toBeInTheDocument();
      expect(screen.getByText('Keyword')).toBeInTheDocument();
      expect(screen.getByText('Volume')).toBeInTheDocument();
      expect(screen.getByText('seo tool')).toBeInTheDocument();
    });
  });

  it('Test 3: asserts content-type action items appear in the SAME table component as page-level ones', async () => {
    render(
      <MemoryRouter>
        <AnalyzePage initialProjectId="proj-123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('action-items-table')).toBeInTheDocument();
    });

    const table = screen.getByTestId('action-items-table');

    // Both page-level issue and content-level issue exist inside the same table
    expect(table).toHaveTextContent('seo-title — Title tag missing');
    expect(table).toHaveTextContent('video-transcript — Video missing caption track');

    // Type indicators render inside the table
    await waitFor(() => {
      expect(screen.getByTestId('type-indicator-issue-1')).toHaveTextContent(/page/i);
      expect(screen.getByTestId('type-indicator-content-issue-2')).toHaveTextContent(/content/i);
    });
  });
});
