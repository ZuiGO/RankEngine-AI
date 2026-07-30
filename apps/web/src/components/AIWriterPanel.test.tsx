import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AIWriterPanel from './AIWriterPanel';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

const defaultProps = {
  targetKeyword: 'SEO tips',
  onInsert: vi.fn(),
  onReplaceContent: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

function findButton(text: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(text, 'i') }) as HTMLButtonElement;
}

describe('AIWriterPanel', () => {
  it('generates full custom AI article when topic input and Generate Full AI Article is clicked', async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        title: 'Mastering SEO Tips for 2026',
        content: '# Mastering SEO Tips for 2026\n\n## What is SEO?\nSEO is optimization.',
        metaDescription: 'Complete guide to SEO tips and strategies.',
        keyPoints: ['Point 1', 'Point 2'],
      },
    });

    const onReplaceContent = vi.fn();
    render(<AIWriterPanel {...defaultProps} onReplaceContent={onReplaceContent} />);

    const topicInput = screen.getByPlaceholderText(/Complete Guide to SEO tips/i);
    fireEvent.change(topicInput, { target: { value: 'Mastering SEO Tips for 2026' } });

    fireEvent.click(findButton('Generate Full AI Article'));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/content/write-article', expect.objectContaining({
        topic: 'Mastering SEO Tips for 2026',
        targetKeyword: 'SEO tips',
      }));
      expect(onReplaceContent).toHaveBeenCalledWith('# Mastering SEO Tips for 2026\n\n## What is SEO?\nSEO is optimization.');
      expect(screen.getByText('Mastering SEO Tips for 2026')).toBeInTheDocument();
    });
  });

  it('renders title variants when Generate Titles is clicked and API succeeds', async () => {
    mockedApi.post.mockResolvedValue({ data: { variants: ['Title A', 'Title B'] } });

    render(<AIWriterPanel {...defaultProps} />);

    fireEvent.click(findButton('Generate Titles'));

    await waitFor(() => {
      expect(screen.getByText('Title A')).toBeInTheDocument();
      expect(screen.getByText('Title B')).toBeInTheDocument();
    });
  });

  it('calls onInsert with the title string when Insert is clicked on a variant', async () => {
    const onInsert = vi.fn();
    mockedApi.post.mockResolvedValue({ data: { variants: ['SEO Title One'] } });

    render(<AIWriterPanel {...defaultProps} onInsert={onInsert} />);

    fireEvent.click(findButton('Generate Titles'));

    await waitFor(() => {
      expect(screen.getByText('SEO Title One')).toBeInTheDocument();
    });

    const insertButtons = screen.getAllByRole('button', { name: /insert/i });
    fireEvent.click(insertButtons[0]);
    expect(onInsert).toHaveBeenCalledWith('SEO Title One');
  });

  it('shows error message on API failure and other buttons remain interactive', async () => {
    mockedApi.post.mockRejectedValue(new Error('Network error'));

    render(<AIWriterPanel {...defaultProps} />);

    fireEvent.click(findButton('Generate Titles'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    expect(findButton('Generate Meta Description')).not.toBeDisabled();
  });

  it('shows friendly message when schema response has valid: false', async () => {
    mockedApi.post.mockResolvedValue({
      data: { jsonLd: null, valid: false, error: 'Could not generate valid schema after retry' },
    });

    render(<AIWriterPanel {...defaultProps} />);

    fireEvent.click(findButton('Generate Schema Markup'));

    await waitFor(() => {
      expect(
        screen.getByText('Could not generate valid schema after retry'),
      ).toBeInTheDocument();
    });
  });
});
