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