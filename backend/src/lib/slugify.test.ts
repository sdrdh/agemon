import { describe, test, expect } from 'bun:test';
import { slugify } from './slugify.ts';

describe('slugify', () => {
  test('converts to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  test('replaces non-alphanumeric with hyphens', () => {
    expect(slugify('Fix bug #123')).toBe('fix-bug-123');
    expect(slugify('Add support for @mentions')).toBe('add-support-for-mentions');
  });

  test('collapses consecutive hyphens', () => {
    expect(slugify('Fix   multiple   spaces')).toBe('fix-multiple-spaces');
    expect(slugify('Test---dashes')).toBe('test-dashes');
  });

  test('trims leading and trailing hyphens', () => {
    expect(slugify('-leading')).toBe('leading');
    expect(slugify('trailing-')).toBe('trailing');
    expect(slugify('-both-')).toBe('both');
  });

  test('handles empty input', () => {
    expect(slugify('')).toBe('task');
    expect(slugify('   ')).toBe('task');
    expect(slugify('---')).toBe('task');
  });

  test('truncates on word boundary', () => {
    const longTitle = 'this is a very long title that should be truncated at some point';
    const result = slugify(longTitle, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).not.toEndWith('-');
  });

  test('handles unicode characters', () => {
    expect(slugify('Hello 世界')).toBe('hello');
    expect(slugify('Café')).toBe('caf');
  });

  test('preserves numbers', () => {
    expect(slugify('Task 123')).toBe('task-123');
    expect(slugify('v2.0.1')).toBe('v2-0-1');
  });
});
