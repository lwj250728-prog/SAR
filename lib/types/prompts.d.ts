/**
 * Prompt templates of the cognitive pipeline, adapted from the DCA-PED
 * production prompt library (03-提示词模板库.md). Four templates plus the
 * dynamic cognition prefix (附录B). Every template demands structured JSON
 * output; callers enforce the JSON contract and degrade deterministically.
 * @module @deepseek-ai/dsh-cognitive-pipeline/prompts
 */
import type { Experience, TaxonomyState } from './types.ts';
/** Template 1: SAR triplet extraction and utility scoring. */
export declare const SAR_SYSTEM_PROMPT: string;
/** Template 2: hot-loop OOD review / strangeness confirmation. */
export declare const OOD_REVIEW_SYSTEM_PROMPT: string;
/** Template 3: five-layer confidence calibration with adversarial challenge. */
export declare const CALIBRATION_SYSTEM_PROMPT: string;
/** Template 4: cold-loop causal-anchored taxonomy reconstruction. */
export declare const RECONSTRUCT_SYSTEM_PROMPT: string;
/** Frame template-1 input.
 * @param rawText - the raw experience text.
 * @returns the user message body.
 */
export declare function frameSarInput(rawText: string): string;
/** Frame template-2 input with the new action and the top-3 historical actions.
 * @param action - the proposed action.
 * @param topActions - historical actions with similarity.
 * @returns the user message body.
 */
export declare function frameOodInput(action: string, topActions: readonly {
    expId: string;
    action: string;
    similarity: number;
}[]): string;
/** Frame template-3 input with the situation/action and top-K sample stats.
 * @param situation - the current situation.
 * @param action - the proposed action.
 * @param context - optional extra context.
 * @param positiveCount - positive history hits.
 * @param negativeCount - negative history hits.
 * @param samples - compact sample summaries.
 * @returns the user message body.
 */
export declare function frameCalibrationInput(situation: string, action: string, context: string | undefined, positiveCount: number, negativeCount: number, samples: readonly {
    expId: string;
    actionKeywords: string;
    utility: string;
    meta?: boolean;
}[]): string;
/** Frame template-4 input with the sampled experiences.
 * @param samples - the sampled train experiences.
 * @returns the user message body.
 */
export declare function frameReconstructInput(samples: readonly Experience[]): string;
/** Template 5: the accumulation gate — judge whether a completed turn is worth
 * becoming an experience, and extract the SAR triplet when it is. */
export declare const ACCUMULATE_SYSTEM_PROMPT: string;
/** Frame template-5 input with the completed episode and similar history. */
export declare function frameAccumulateInput(episode: {
    situation: string;
    action: string;
    outcome: string;
}, similar: readonly {
    expId: string;
    text: string;
    similarity: number;
}[]): string;
/** 附录B: the dynamic cognition prefix injected into the hot-loop system prompt.
 * @param taxonomy - the current taxonomy, or null before the first rebuild.
 * @returns the prefix text.
 */
export declare function cognitionPrefix(taxonomy: TaxonomyState | null): string;
/** Template 6: derive a reference experience from the commonalities of similar
 * history — an online generalization for cold start. */
export declare const DERIVE_REFERENCE_SYSTEM_PROMPT: string;
/** Frame template-6 input with the query and its similar history. */
export declare function frameDeriveReferenceInput(query: {
    situation: string;
    action: string;
}, similar: readonly {
    expId: string;
    text: string;
    similarity: number;
}[]): string;
/** Template 7: refine retrieval when the deterministic routing is
 * low-confidence — the LLM route judges whether the fused top hit genuinely
 * applies, instead of the hot loop blindly trusting the cosine ranking. */
export declare const REFINE_RETRIEVAL_SYSTEM_PROMPT: string;
/** Frame template-7 input with the query and the fused candidates. */
export declare function frameRefineRetrievalInput(query: {
    situation: string;
    action: string;
}, candidates: readonly {
    expId: string;
    text: string;
    similarity: number;
}[]): string;
//# sourceMappingURL=prompts.d.ts.map