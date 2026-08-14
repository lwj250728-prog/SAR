/**
 * Deterministic vectorizer: hashed bag-of-words vectors for actions (the
 * retrieval axis) and utility-weighted vectors for outcomes (the clustering
 * axis). No external embedding service is required; the same text always
 * produces the same vector, which keeps the store, tests, and rebuilds
 * reproducible across processes.
 * @module @deepseek-ai/dsh-cognitive-pipeline/vectorizer
 */
import type { OutcomeUtility } from './types.ts';
/** Action-vector dimension (the design's `all-MiniLM-L6-v2` stand-in). */
export declare const ACTION_VECTOR_DIM = 384;
/** Outcome-vector dimension: 3 utility slots + hashed outcome features. */
export declare const OUTCOME_VECTOR_DIM = 512;
/** Number of utility slots at the head of the outcome vector. */
export declare const UTILITY_SLOTS = 3;
/** Signed composite utility of an outcome: gains and valence minus cost.
 * @param utility - the outcome utility.
 * @returns a signed score in [-15, 15].
 */
export declare function utilityScore(utility: OutcomeUtility): number;
/** Whether an outcome counts as a positive hit for the frequency prior.
 * @param utility - the outcome utility.
 * @returns true when the composite score is positive.
 */
export declare function isPositiveOutcome(utility: OutcomeUtility): boolean;
/** FNV-1a 32-bit hash, a stable deterministic token hash.
 * @param token - the token to hash.
 * @returns an unsigned 32-bit hash.
 */
export declare function hashToken(token: string): number;
/** Tokenize text: lowercase latin/digit runs plus each CJK char separately.
 * @param text - the input text.
 * @returns the token list.
 */
export declare function tokenize(text: string): string[];
/** L2-normalize a vector; a zero vector stays zero.
 * @param vector - the input vector.
 * @returns a normalized copy.
 */
export declare function normalize(vector: readonly number[]): number[];
/** Cosine similarity between two vectors; a zero-norm pair scores 0.
 * @param a - the first vector.
 * @param b - the second vector.
 * @returns the cosine in [-1, 1].
 */
export declare function cosine(a: readonly number[], b: readonly number[]): number;
/** Build the action retrieval vector from action text plus keywords.
 * @param action - the action text.
 * @param keywords - SAR-extracted action keywords.
 * @returns a normalized ACTION_VECTOR_DIM vector.
 */
export declare function actionVector(action: string, keywords: readonly string[]): number[];
/**
 * Build the outcome clustering vector: three signed utility slots dominate the
 * head (weighted before normalization), and hashed outcome-text features fill
 * the tail. Clustering therefore groups by result *utility pattern*, not by
 * outcome wording.
 * @param utility - the quantified outcome utility.
 * @param outcomeText - the outcome description.
 * @returns a normalized OUTCOME_VECTOR_DIM vector.
 */
export declare function outcomeVector(utility: OutcomeUtility, outcomeText: string): number[];
/** Stable signature hash for one action text (temp-strategy keys).
 * @param action - the action text.
 * @returns the FNV hash value.
 */
export declare function signatureHash(action: string): number;
//# sourceMappingURL=vectorizer.d.ts.map