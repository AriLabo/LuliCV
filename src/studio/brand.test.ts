import { describe, expect, it } from 'vitest';
import { wordmarkAccent } from './brand';

describe('wordmarkAccent', () => {
  it('uses theme accents that read on the white top bar', () => {
    for (const color of ['#274472', '#9a3b2e', '#2e6b4f', '#222', '#2F5D62']) expect(wordmarkAccent(color)).toBe(color);
  });

  it('falls back to ink for light or unparsable colours', () => {
    for (const color of ['#ffd700', '#eee', '#9ad', 'rebeccapurple', 'rgb(0 0 0)', '#12345'])
      expect(wordmarkAccent(color)).toBeUndefined();
  });
});
