import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KeywordResearchPage from './KeywordResearchPage';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

const mockResults = [
  { keyword: 'seo tips', searchVolume: 1000, difficulty: 45, cpc: 2.5, intent: 'informational' },
  { keyword: 'seo tools', searchVolume: 2000, difficulty: 30, cpc: 3.0, intent: 'commercial' },
  { keyword: 'seo audit', searchVolume: 800, difficulty: 55, cpc: 4.0, intent: 'commercial' },
  { keyword: 'seo checklist', searchVolume: 600, difficulty: 25, cpc: 1.5, intent: 'informational' },
  { keyword: 'seo strategy', searchVolume: 1500, difficulty: 60, cpc: 3.5, intent: 'commercial' },
];

const mockClusterResponse = {
  clusters: [
    { topicName: 'On-Page SEO', keywords: ['seo tips', 'seo audit'] },
    { topicName: 'SEO Tools & Strategy', keywords: ['seo tools', 'seo checklist', 'seo strategy'] },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <KeywordResearchPage />
    </MemoryRouter>
  );
}

describe('KeywordResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clusters keywords and displays cluster cards with topic names and badges', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { queries: [] } })
      .mockResolvedValueOnce({ data: [] });

    renderPage();

    const input = screen.getByPlaceholderText(/seed keyword/i);
    fireEvent.change(input, { target: { value: 'seo' } });

    mockedApi.post.mockResolvedValueOnce({
      data: { seedKeyword: 'seo', results: mockResults },
    });

    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText('seo tips')).toBeInTheDocument();
    });

    mockedApi.post.mockResolvedValueOnce({ data: mockClusterResponse });

    fireEvent.click(screen.getByRole('button', { name: /cluster these keywords/i }));

    await waitFor(() => {
      expect(screen.getByText('On-Page SEO')).toBeInTheDocument();
      expect(screen.getByText('SEO Tools & Strategy')).toBeInTheDocument();
    });

    expect(screen.getAllByText('seo tips').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('seo audit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('seo tools').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('seo checklist').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('seo strategy').length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to content editor with topic and keyword query params', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { queries: [] } })
      .mockResolvedValueOnce({
        data: [{ _id: 'proj1', name: 'My Site', domain: 'mysite.com' }],
      });

    renderPage();

    const input = screen.getByPlaceholderText(/seed keyword/i);
    fireEvent.change(input, { target: { value: 'seo' } });

    mockedApi.post.mockResolvedValueOnce({
      data: { seedKeyword: 'seo', results: mockResults },
    });

    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText('seo tips')).toBeInTheDocument();
    });

    mockedApi.post.mockResolvedValueOnce({ data: mockClusterResponse });

    fireEvent.click(screen.getByRole('button', { name: /cluster these keywords/i }));

    await waitFor(() => {
      expect(screen.getByText('On-Page SEO')).toBeInTheDocument();
    });

    const startButtons = screen.getAllByRole('button', { name: /start content/i });
    fireEvent.click(startButtons[0]);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/topic=On-Page%20SEO&keyword=seo%20tips/),
    );
  });
});
