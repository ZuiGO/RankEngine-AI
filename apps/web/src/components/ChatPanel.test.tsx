import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatPanel from './ChatPanel';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

function renderPanel() {
  return render(<ChatPanel projectId="507f1f77bcf86cd799439011" />);
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a question and displays both question and answer', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { answer: 'test answer' } });

    renderPanel();

    const input = screen.getByPlaceholderText(/Ask about/i);
    const sendButton = screen.getByTestId('send-chat-btn');

    fireEvent.change(input, { target: { value: 'How is my site doing?' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('How is my site doing?')).toBeInTheDocument();
      expect(screen.getByText('test answer')).toBeInTheDocument();
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/projects/507f1f77bcf86cd799439011/chat',
      expect.objectContaining({ question: 'How is my site doing?', history: [] }),
    );
  });

  it('sends conversation history on second question', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { answer: 'first answer' } });
    mockedApi.post.mockResolvedValueOnce({ data: { answer: 'second answer' } });

    renderPanel();

    const input = screen.getByPlaceholderText(/Ask about/i);
    const sendButton = screen.getByTestId('send-chat-btn');

    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('first answer')).toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: 'Second question' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('second answer')).toBeInTheDocument();
    });

    expect(mockedApi.post).toHaveBeenLastCalledWith(
      '/projects/507f1f77bcf86cd799439011/chat',
      expect.objectContaining({
        question: 'Second question',
        history: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'first answer' },
        ],
      }),
    );
  });

  it('renders error message in message list when API fails and input remains usable', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { data: { error: 'LLM API error' } } });
    mockedApi.post.mockResolvedValueOnce({ data: { answer: 'second attempt answer' } });

    renderPanel();

    const input = screen.getByPlaceholderText(/Ask about/i);
    const sendButton = screen.getByTestId('send-chat-btn');

    fireEvent.change(input, { target: { value: 'Failed question' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('Error: LLM API error')).toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: 'Retry question' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('second attempt answer')).toBeInTheDocument();
    });
  });
});
