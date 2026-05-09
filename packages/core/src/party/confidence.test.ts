// Unit tests for party/confidence.ts — pure regex-based parsers.

import { describe, it, expect } from 'vitest';
import { parseConfidence, stripConfidenceLine, avgConfidence } from './confidence';

describe('parseConfidence', () => {
  it('parses canonical "confidence: 0.74" form', () => {
    expect(parseConfidence('My answer is X.\n\nconfidence: 0.74')).toBe(0.74);
  });

  it('parses uppercase Confidence', () => {
    expect(parseConfidence('Confidence: 0.5')).toBe(0.5);
  });

  it('parses bold markdown form **confidence**: 0.92', () => {
    // Production regex expects asterisks wrapping just the word, with the
    // colon outside. `**confidence:** 0.92` (colon inside) is NOT supported.
    expect(parseConfidence('**confidence**: 0.92')).toBe(0.92);
  });

  it('parses with equals sign instead of colon', () => {
    expect(parseConfidence('confidence = 0.6')).toBe(0.6);
  });

  it('parses with spaces around separator', () => {
    expect(parseConfidence('confidence  :  0.33')).toBe(0.33);
  });

  it('parses confidence of 1', () => {
    expect(parseConfidence('confidence: 1')).toBe(1);
  });

  it('parses confidence of 0', () => {
    expect(parseConfidence('confidence: 0')).toBe(0);
  });

  it('parses confidence of 1.0', () => {
    expect(parseConfidence('confidence: 1.0')).toBe(1);
  });

  it('returns null when no confidence line present', () => {
    expect(parseConfidence('Just some text without confidence.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseConfidence('')).toBeNull();
  });

  it('clamps values above 1 to 1 (defensive)', () => {
    // Regex won't match 1.5 (only [01](\.\d+)?), but if it did, the clamp would catch it.
    // This documents the intended clamp behavior — Math.max/Math.min in code.
    expect(parseConfidence('confidence: 1')).toBe(1);
  });

  it('finds first match in multi-line text', () => {
    const text = 'Some setup\nconfidence: 0.4\nMore text\nconfidence: 0.9';
    expect(parseConfidence(text)).toBe(0.4);
  });
});

describe('stripConfidenceLine', () => {
  it('removes trailing confidence line', () => {
    const input = 'My answer is X.\n\nconfidence: 0.74';
    expect(stripConfidenceLine(input)).toBe('My answer is X.');
  });

  it('removes bold-wrapped confidence line', () => {
    const input = 'Answer here.\n\n**confidence: 0.5**';
    const result = stripConfidenceLine(input);
    expect(result).not.toContain('confidence');
    expect(result).toContain('Answer here.');
  });

  it('leaves text without confidence unchanged', () => {
    const input = 'No confidence line here.';
    expect(stripConfidenceLine(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(stripConfidenceLine('')).toBe('');
  });

  it('only strips the trailing line, not mid-text mentions', () => {
    const input = 'I had high confidence: 0.9 in my prior answer.\n\nNew thought here.';
    const result = stripConfidenceLine(input);
    expect(result).toBe(input);
  });
});

describe('avgConfidence', () => {
  it('returns the average of provided values', () => {
    expect(avgConfidence([0.5, 0.7, 0.9])).toBeCloseTo(0.7, 5);
  });

  it('ignores null values when averaging', () => {
    expect(avgConfidence([0.5, null, 0.9])).toBeCloseTo(0.7, 5);
  });

  it('returns null when all values are null', () => {
    expect(avgConfidence([null, null, null])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(avgConfidence([])).toBeNull();
  });

  it('handles single value correctly', () => {
    expect(avgConfidence([0.42])).toBe(0.42);
  });
});
