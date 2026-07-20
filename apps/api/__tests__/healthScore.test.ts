import { computeHealthScore } from '../src/services/healthScoreService';

describe('computeHealthScore', () => {
  it('should return 100 when there are no issues', () => {
    expect(computeHealthScore(0, 0)).toBe(100);
  });

  it('should deduct 15 per critical issue', () => {
    expect(computeHealthScore(1, 0)).toBe(85);
    expect(computeHealthScore(2, 0)).toBe(70);
    expect(computeHealthScore(6, 0)).toBe(10);
  });

  it('should deduct 5 per warning', () => {
    expect(computeHealthScore(0, 1)).toBe(95);
    expect(computeHealthScore(0, 5)).toBe(75);
    expect(computeHealthScore(0, 20)).toBe(0);
  });

  it('should combine critical and warning deductions', () => {
    expect(computeHealthScore(1, 1)).toBe(80);
    expect(computeHealthScore(2, 4)).toBe(50);
  });

  it('should clamp to 0', () => {
    expect(computeHealthScore(10, 10)).toBe(0);
    expect(computeHealthScore(100, 100)).toBe(0);
  });

  it('should never exceed 100', () => {
    expect(computeHealthScore(-1, -1)).toBe(100);
  });
});
