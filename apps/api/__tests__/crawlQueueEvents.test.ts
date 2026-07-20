jest.mock('bullmq', () => ({
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

import { parseCrawlCompletionResult } from '../src/queues/crawlQueueEvents';

describe('parseCrawlCompletionResult', () => {
  it('uses the worker result reference from a serialized BullMQ return value', () => {
    expect(
      parseCrawlCompletionResult(
        JSON.stringify({ pageCount: 12, rawResultsRef: '668aef9e2a35d5d9d9462e31' })
      )
    ).toEqual({ pageCount: 12, rawResultsRef: '668aef9e2a35d5d9d9462e31' });
  });

  it('does not treat the old crawlResultId key as a result reference', () => {
    expect(parseCrawlCompletionResult({ pageCount: 0, crawlResultId: 'legacy-result-id' })).toEqual(
      {
        pageCount: 0,
      }
    );
  });

  it('leaves the result reference unset for malformed payloads', () => {
    expect(parseCrawlCompletionResult('not-json')).toEqual({ pageCount: 0 });
  });
});
