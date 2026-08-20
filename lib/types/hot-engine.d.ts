/**
 * Hot-loop engine: online prediction with OOD detection, branch routing
 * (familiar path vs novel path), and the five-layer confidence calibration.
 * All math is synchronous and fast; the only awaits are the best-effort LLM
 * assists (SAR-independent: OOD review and calibration).
 * @module @deepseek-ai/dsh-cognitive-pipeline/hot-engine
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { CognitiveLlmRoute } from './llm.ts';
import { CognitiveStore } from './store.ts';
import type { Experience, PredictInput, PredictResult, TempStrategy } from './types.ts';
/** Fully resolved engine thresholds (no optional fields). */
export interface HotEngineConfig {
    readonly topK: number;
    readonly oodSimThreshold: number;
    readonly oodFlatThreshold: number;
    readonly oodSiThreshold: number;
    readonly shrinkageAlpha: number;
    readonly minConfidenceIntervalWidth: number;
    /** Situation-centroid cosine at/above which a success cluster is returned as a reference strategy (default 0.4). */
    readonly successReferenceThreshold: number;
    /** Situation-centroid cosine below which the taxonomy is considered uncovered (default 0.3). */
    readonly coverageThreshold: number;
    /** Routing margin (best-minus-second-best cluster cosine) below which a
     * known-path prediction is treated as a retrieval failure and SAR-ized (default 0.1). */
    readonly retrievalFailureMargin: number;
    readonly tempStrategyTtlMs: number;
    readonly tempStrategyMatchThreshold: number;
}
/** One ranked history hit. */
interface RankedHit {
    readonly exp: Experience;
    readonly similarity: number;
}
/**
 * Hot-loop engine. Constructed once per service; `predict` is the online
 * entry point.
 */
export declare class HotEngine {
    private readonly ctx;
    private readonly store;
    private readonly config;
    private readonly route;
    constructor(ctx: Context, store: CognitiveStore, config: HotEngineConfig, route: CognitiveLlmRoute);
    /** Retrieve the top-K experiences by action-vector cosine similarity.
     * @param action - the proposed action text.
     * @param k - how many hits to return.
     * @returns ranked hits, best first.
     */
    retrieveTopK(action: string, k: number): RankedHit[];
    /** Detect OOD signals from the top-K similarity set.
     * @param ranked - the retrieved hits, best first.
     * @returns the strongest signal and the top-1 similarity.
     */
    detectOod(ranked: readonly RankedHit[]): {
        signal: PredictResult['oodSignal'];
        top1: number;
    };
    /**
     * Run one hot-loop prediction.
     * @param input - the situation/action to predict.
     * @param sessionId - optional session identity for LLM-assisted calls.
     * @param signal - optional cancellation for LLM-assisted calls.
     * @returns the calibrated prediction result.
     */
    predict(input: PredictInput, sessionId?: GenerateOptions['sessionId'], signal?: AbortSignal): Promise<PredictResult>;
    /**
     * Consult the taxonomy during retrieval: match the query situation against
     * every cluster's situation centroid (any polarity), report the routed
     * region, the routing confidence (best-minus-second-best margin), and
     * whether SAR has coverage there. This is the structural layer of the
     * pipeline's self-knowledge — retrieval knows what SAR contains before it
     * scans the experience store.
     * @param situation - the query situation text.
     * @returns the taxonomy context for this query.
     */
    private taxonomyContext;
    /** Compact retrieval-advice line appended to the advice text. */
    private taxonomyAdviceLine;
    /** Match the current situation against proven success clusters. Returns the
     * closest success cluster whose situation centroid clears the threshold, so
     * the model can reference a proven strategy even when the action itself is
     * novel.
     * @param situation - the current situation text.
     * @returns the matched success reference, or null.
     */
    private matchSuccessReference;
    /** Novel branch: scratchpad lookup or creation, conservative calibration. */
    private predictNovel;
    /** Familiar branch: five-layer calibration over the top-K samples. */
    private predictKnown;
    /** Layer-2 shrinkage: P_cal = (k/(k+α))·P_raw + (α/(k+α))·0.5. */
    private shrink;
    /** Find an active scratchpad strategy loosely matching one action.
     * @param action - the action text to match.
     * @returns the matching active strategy, or undefined.
     */
    findMatchingTempStrategy(action: string): TempStrategy | undefined;
}
export {};
//# sourceMappingURL=hot-engine.d.ts.map