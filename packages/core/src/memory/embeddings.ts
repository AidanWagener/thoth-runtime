import { logger } from '../logger';

/**
 * Local sentence embeddings via @xenova/transformers (ONNX runtime).
 *
 * Model: Xenova/all-MiniLM-L6-v2
 *   - Output: 384-dim Float32Array
 *   - Size on disk: ~25 MB (cached after first download)
 *   - Speed: ~50-100ms per encode on a modern CPU
 *   - Vectors are L2-normalized (so cosine == dot product)
 *
 * Lazy-loaded on first call to embed(); call ensureLoaded() at boot to
 * front-load the ~5-10s warmup so the first DM doesn't pay it.
 *
 * Why local rather than an embeddings API:
 *   - $0 recurring (the whole point of staying on Max-only)
 *   - No additional latency budget eaten on the hot path
 *   - Lock-step with the rest of the bridge: no extra rate-limiter,
 *     no extra failure mode.
 */

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

// Use `any` for the pipeline because @xenova/transformers v2 doesn't
// ship great TS types for the FeatureExtractionPipeline output.
// We only consume `.data` which is a TypedArray.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeatureExtractor = any;

let cached: FeatureExtractor | undefined;
let loadingPromise: Promise<FeatureExtractor> | undefined;

async function loadExtractor(): Promise<FeatureExtractor> {
  if (cached) return cached;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const t0 = Date.now();
    // Dynamic import — the package emits ESM-style exports and our
    // tsconfig is CommonJS; dynamic import works in both.
    const transformers = await import('@xenova/transformers');
    // Quiet the WASM thread warning on Node.
    if (transformers.env?.backends?.onnx?.wasm) {
      transformers.env.backends.onnx.wasm.numThreads = 1;
    }
    const extractor = await transformers.pipeline(
      'feature-extraction',
      MODEL_ID,
    );
    cached = extractor;
    logger.info(
      { model: MODEL_ID, dim: EMBEDDING_DIM, loadMs: Date.now() - t0 },
      'embedding model loaded',
    );
    return extractor;
  })().catch((err) => {
    loadingPromise = undefined;
    throw err;
  });

  return loadingPromise;
}

/** Optional: front-load the model so the first encode doesn't pay it. */
export async function ensureEmbeddingsLoaded(): Promise<void> {
  await loadExtractor();
}

/**
 * Embed a single string. Returns a 384-dim Float32Array (L2-normalized).
 *
 * Truncates inputs longer than 4000 chars to avoid the tokenizer's
 * 256-token limit driving up encode time and to keep recall queries
 * focused on the most salient prefix.
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await loadExtractor();
  const trimmed = text.trim().slice(0, 4000);
  // pooling=mean + normalize=true gives a unit-norm sentence vector.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await extractor(trimmed, {
    pooling: 'mean',
    normalize: true,
  });
  // out.data is a Float32Array; copy to detach from internal buffer.
  return new Float32Array(out.data as Float32Array);
}

/**
 * Cosine similarity between two L2-normalized vectors. With normalized
 * inputs (which our model emits), this is just the dot product.
 *
 * Returns a value in [-1, 1] where 1 = identical, 0 = orthogonal.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Pack a Float32Array into a Buffer for SQLite BLOB storage.
 * Uses the underlying ArrayBuffer directly — no copy.
 */
export function embeddingToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Unpack a SQLite BLOB back into a Float32Array. Validates the byte
 * length is a multiple of 4 (Float32) and matches expected dim.
 */
export function blobToEmbedding(buf: Buffer): Float32Array {
  if (buf.byteLength % 4 !== 0) {
    throw new Error(`blobToEmbedding: blob is not float32-aligned (${buf.byteLength} bytes)`);
  }
  const n = buf.byteLength / 4;
  if (n !== EMBEDDING_DIM) {
    throw new Error(
      `blobToEmbedding: dim mismatch (got ${n}, expected ${EMBEDDING_DIM})`,
    );
  }
  // Copy out so the resulting view is independent of the Buffer's pool.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return new Float32Array(copy);
}
