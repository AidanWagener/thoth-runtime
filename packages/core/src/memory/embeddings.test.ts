// Unit tests for memory/embeddings — pure function paths only.
// We don't load the actual Xenova model in tests (~12s warmup).
// The model load is exercised by `pnpm smoke` against a real environment.

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  embeddingToBlob,
  blobToEmbedding,
  EMBEDDING_DIM,
} from './embeddings';

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal unit vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns -1 for anti-parallel unit vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it('computes dot product (since inputs are assumed normalized)', () => {
    const a = new Float32Array([0.6, 0.8, 0]);
    const b = new Float32Array([0, 0.6, 0.8]);
    // dot = 0*0.6 + 0.8*0.6 + 0*0.8 = 0.48
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.48, 6);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow(/dimension mismatch/);
  });

  it('handles 384-dim vectors (the production size)', () => {
    const a = new Float32Array(EMBEDDING_DIM);
    const b = new Float32Array(EMBEDDING_DIM);
    a[0] = 1;
    b[0] = 1;
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });
});

describe('embeddingToBlob + blobToEmbedding (round-trip)', () => {
  it('round-trips a 384-dim zero vector', () => {
    const original = new Float32Array(EMBEDDING_DIM);
    const blob = embeddingToBlob(original);
    expect(blob.byteLength).toBe(EMBEDDING_DIM * 4);
    const recovered = blobToEmbedding(blob);
    expect(recovered.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(recovered[i]).toBe(0);
    }
  });

  it('round-trips a 384-dim arbitrary vector', () => {
    const original = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      original[i] = Math.sin(i * 0.123) * 0.5;
    }
    const blob = embeddingToBlob(original);
    const recovered = blobToEmbedding(blob);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(recovered[i]).toBeCloseTo(original[i], 6);
    }
  });

  it('blob byteLength is exactly dim * 4 (Float32)', () => {
    const v = new Float32Array(EMBEDDING_DIM);
    expect(embeddingToBlob(v).byteLength).toBe(384 * 4);
  });

  it('returns a copy independent of the source Buffer pool', () => {
    const original = new Float32Array(EMBEDDING_DIM);
    original[0] = 0.5;
    const blob = embeddingToBlob(original);
    const recovered = blobToEmbedding(blob);
    // Mutating the recovered vector must not affect future calls
    recovered[0] = 999;
    const recoveredAgain = blobToEmbedding(blob);
    expect(recoveredAgain[0]).toBeCloseTo(0.5, 6);
  });
});

describe('blobToEmbedding error cases', () => {
  it('rejects blob with non-multiple-of-4 byte length', () => {
    const bad = Buffer.alloc(7); // not a multiple of 4
    expect(() => blobToEmbedding(bad)).toThrow(/not float32-aligned/);
  });

  it('rejects blob with wrong dimension', () => {
    const wrongDim = Buffer.alloc(100 * 4); // 100-dim, not 384
    expect(() => blobToEmbedding(wrongDim)).toThrow(/dim mismatch/);
  });

  it('rejects empty blob', () => {
    const empty = Buffer.alloc(0);
    expect(() => blobToEmbedding(empty)).toThrow(/dim mismatch/);
  });
});

describe('EMBEDDING_DIM constant', () => {
  it('is 384 (matches Xenova MiniLM-L6-v2 output)', () => {
    expect(EMBEDDING_DIM).toBe(384);
  });
});
