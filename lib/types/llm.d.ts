/**
 * Typed LLM helpers for the cognitive pipeline. Each model-assisted step is a
 * best-effort enhancement over a deterministic fallback: a missing adapter, an
 * unreachable route, or a malformed JSON reply never breaks the pipeline — it
 * degrades to the mathematically safe path (附录C of the design).
 * @module @deepseek-ai/dsh-cognitive-pipeline/llm
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { AccumulationDecision, DeriveReferenceDecision, Experience, OutcomeUtility, SarTriplet } from './types.ts';
/** Explicit provider/model route; both or neither must be set. */
export interface CognitiveLlmRoute {
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
}
/** Stable error taxonomy for pipeline-side failures. */
export declare class CognitivePipelineError extends Error {
    /** Stable machine-readable error code. */
    readonly code: string;
    /**
     * @param message - non-empty human-readable failure summary.
     * @param code - non-empty stable machine code.
     */
    constructor(message: string, code: string);
}
/** Structured template-2 OOD review result. */
export interface OodReview {
    readonly isKnown: boolean;
    readonly confidenceScore: number;
    readonly reasoningShort: string;
    readonly suggestedInitialRiskLevel: 'low' | 'medium' | 'high';
}
/** Structured template-3 calibration result. */
export interface CalibrationOutput {
    readonly baseSuccessRate: number;
    readonly riskFactors: readonly string[];
    readonly finalConfidenceIntervalLow: number;
    readonly finalConfidenceIntervalHigh: number;
    readonly finalCalibratedProbability: number;
    readonly advicePreview: string;
}
/** A cluster as returned by template 4, before backend evidence verification. */
export interface RawReconstructCluster {
    readonly clusterName: string;
    readonly decisionRule: string;
    readonly expectedUtilityRange: {
        low: number;
        high: number;
    };
    readonly supportingEvidenceIds: readonly string[];
    readonly fallbackAction: string;
}
/** Structured template-4 reconstruction result. */
export interface ReconstructOutput {
    readonly newClusters: readonly RawReconstructCluster[];
    readonly taxonomySummaryShort: string;
}
/** Whether an explicit route is configured at all.
 * @param route - the configured route pair.
 * @returns true when both provider and model are set.
 */
export declare function hasExplicitRoute(route: CognitiveLlmRoute): boolean;
/** Validate the route pair; both or neither must be present and non-empty.
 * @param route - the candidate route.
 * @returns a validated route, or an empty route.
 */
export declare function resolveRoute(route: CognitiveLlmRoute): CognitiveLlmRoute;
/** Extract the first balanced JSON object from model text.
 * @param text - the raw model output.
 * @returns the parsed JSON value.
 */
export declare function extractJson(text: string): unknown;
/** Options for one pipeline LLM call. */
interface CallOptions {
    readonly sessionId?: GenerateOptions['sessionId'] | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly maxTokens?: number;
}
/**
 * Template 1: extract the SAR triplet. Falls back to a deterministic split.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param rawText - the raw experience text.
 * @param options - call context (session/signal/maxTokens).
 * @returns the extracted triplet.
 */
export declare function extractSar(ctx: Context, route: CognitiveLlmRoute, rawText: string, options: CallOptions): Promise<SarTriplet>;
/** Deterministic template-2 fallback: trust the math-only OOD signal.
 * @param isKnown - the math-only decision.
 * @returns a review with 50% confidence.
 */
export declare function oodReviewFallback(isKnown: boolean): OodReview;
/**
 * Template 2: confirm or deny OOD. Falls back to the math-only decision.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param action - the proposed action text.
 * @param topActions - the top historical actions for review.
 * @param mathSaysKnown - the math-only OOD decision.
 * @param options - call context (session/signal/maxTokens).
 * @returns the review verdict.
 */
export declare function reviewOod(ctx: Context, route: CognitiveLlmRoute, action: string, topActions: readonly {
    expId: string;
    action: string;
    similarity: number;
}[], mathSaysKnown: boolean, options: CallOptions): Promise<OodReview>;
/** Deterministic template-3 fallback: pure frequency prior with a wide interval.
 * @param positiveCount - positive history hits.
 * @param negativeCount - negative history hits.
 * @returns a fallback calibration output.
 */
export declare function calibrationFallback(positiveCount: number, negativeCount: number): CalibrationOutput;
/**
 * Template 3: five-layer calibration (frequency prior, adversarial factors,
 * interval output). Backend shrinkage and bucket correction happen in the hot
 * engine; this helper only covers the LLM-facing layers.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param input - the situation/action plus history statistics.
 * @param options - call context (session/signal/maxTokens).
 * @returns the calibration output.
 */
export declare function calibrate(ctx: Context, route: CognitiveLlmRoute, input: {
    situation: string;
    action: string;
    context?: string | undefined;
    positiveCount: number;
    negativeCount: number;
    samples: readonly {
        expId: string;
        actionKeywords: string;
        utility: string;
    }[];
}, options: CallOptions): Promise<CalibrationOutput>;
/** Deterministic template-4 fallback: name clusters from utility means.
 * @param groups - the agglomerative groups with evidence and mean utility.
 * @param summaryShort - the fallback taxonomy summary.
 * @returns deterministic cluster output.
 */
export declare function reconstructFallback(groups: readonly {
    evidenceIds: readonly string[];
    meanUtility: OutcomeUtility;
}[], summaryShort: string): ReconstructOutput;
/**
 * Template 4: causal-anchored taxonomy reconstruction. Falls back to
 * deterministic cluster naming when the model path is unavailable.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param samples - the sampled train experiences.
 * @param groups - the agglomerative groups with evidence and mean utility.
 * @param summaryShort - fallback taxonomy summary.
 * @param options - call context (session/signal/maxTokens).
 * @returns the reconstruction output.
 */
export declare function reconstructTaxonomy(ctx: Context, route: CognitiveLlmRoute, samples: readonly Experience[], groups: readonly {
    evidenceIds: readonly string[];
    meanUtility: OutcomeUtility;
}[], summaryShort: string, options: CallOptions): Promise<ReconstructOutput>;
/** Deterministic template-5 fallback: reject accumulation (no route → no gate). */
export declare function accumulationFallback(): AccumulationDecision;
/**
 * Template 5: the accumulation gate. The LLM route judges whether a completed
 * turn is worth becoming an experience and extracts the SAR triplet when it is.
 * Without an explicit route the gate deterministically rejects — automatic
 * accumulation never runs unjudged.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param episode - the completed turn's situation/action/outcome material.
 * @param similar - retrieved history hits for the novelty judgment.
 * @param options - call context (session/signal/maxTokens).
 * @returns the accumulation decision.
 */
export declare function evaluateAccumulation(ctx: Context, route: CognitiveLlmRoute, episode: {
    situation: string;
    action: string;
    outcome: string;
}, similar: readonly {
    expId: string;
    text: string;
    similarity: number;
}[], options: CallOptions): Promise<AccumulationDecision>;
/** Deterministic template-6 fallback: reject derivation (no route → no reference). */
export declare function deriveReferenceFallback(): DeriveReferenceDecision;
/**
 * Template 6: derive a reference experience from the commonalities of similar
 * history — an online generalization for cold start. The LLM route extracts
 * the shared situation/action/outcome/utility pattern; without a route it
 * deterministically rejects.
 * @param ctx - plugin context for the LLM call.
 * @param route - explicit model route.
 * @param query - the current situation/action to anchor the derivation.
 * @param similar - the retrieved similar history hits.
 * @param options - call context (session/signal/maxTokens).
 * @returns the derivation decision with the reference SAR when derived.
 */
export declare function deriveReference(ctx: Context, route: CognitiveLlmRoute, query: {
    situation: string;
    action: string;
}, similar: readonly {
    expId: string;
    text: string;
    similarity: number;
}[], options: CallOptions): Promise<DeriveReferenceDecision>;
export {};
//# sourceMappingURL=llm.d.ts.map