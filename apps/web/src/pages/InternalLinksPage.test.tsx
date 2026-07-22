import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InternalLinksPage from './InternalLinksPage';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

const mockSuggestions = [
  {
    sourcePage: 'https://example.com/about',
    targetPage: 'https://example.com/contact',
    suggestedAnchorText: 'Contact Us',
  },
  {
    sourcePage: 'https://example.com/blog',
    targetPage: 'https://example.com/services',
    suggestedAnchorText: 'Our Services',
  },
  {
    sourcePage: 'https://example.com/home',
    targetPage: 'https://example.com/portfolio',
    suggestedAnchorText: 'View Our Work',
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/507f1f77bcf86cd799439011/internal-links']}>
      <InternalLinksPage />
    </MemoryRouter>
  );
}

describe('InternalLinksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 3 table rows with correct column values when suggestions are provided', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { suggestions: mockSuggestions } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('https://example.com/about')).toBeInTheDocument();
      expect(screen.getByText('https://example.com/contact')).toBeInTheDocument();
      expect(screen.getByText('Contact Us')).toBeInTheDocument();
    });

    expect(screen.getByText('https://example.com/blog')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/services')).toBeInTheDocument();
    expect(screen.getByText('Our Services')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/home')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/portfolio')).toBeInTheDocument();
    expect(screen.getByText('View Our Work')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
  });

  it('renders EmptyState when suggestions array is empty', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { suggestions: [] } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No internal link suggestions yet')).toBeInTheDocument();
    });

    expect(screen.getByText(/suggestions appear after a completed audit/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
