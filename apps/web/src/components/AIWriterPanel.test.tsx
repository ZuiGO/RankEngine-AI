import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AIWriterPanel from './AIWriterPanel';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

const defaultProps = {
  targetKeyword: 'SEO tips',
  onInsert: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

function findButton(text: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(text, 'i') }) as HTMLButtonElement;
}

describe('AIWriterPanel', () => {
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
