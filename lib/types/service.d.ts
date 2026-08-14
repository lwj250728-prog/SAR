/**
 * CognitivePipelineService: the pipeline's public service. It owns the store
 * and both engines, and exposes the online (`remember`/`predict`/`report`),
 * offline (`rebuild`), and observational (`inspect`) entry points the tools
 * and other plugins call. Extends Cordis `Service`, so loading the plugin
 * provides `ctx.cognitivePipeline`.
 * @module @deepseek-ai/dsh-cognitive-pipeline/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { ColdEngine } from './cold-engine.ts';
import type { ColdEngineConfig } from './cold-engine.ts';
import { HotEngine } from './hot-engine.ts';
import type { HotEngineConfig } from './hot-engine.ts';
import type { CognitiveLlmRoute } from './llm.ts';
import { CognitiveStore } from './store.ts';
import type { CalibrationBucket, Cluster, FeedbackInput, FeedbackResult, InspectResult, OutcomeUtility, PredictInput, PredictResult, RebuildResult, RememberInput, SarTriplet, TaxonomyState, TempStrategy } from './types.ts';
/** Plugin configuration (all fields optional; engine defaults apply). */
export interface CognitivePipelineConfig {
    /** Store directory; default `<dshHome>/cognitive-pipeline`. */
    root?: string;
    /** Explicit LLM provider route; must be paired with `model`. */
    provider?: string;
    /** Explicit LLM model id; must be paired with `provider`. */
    model?: string;
    /** False disables tool registration while keeping the service loadable. */
    enabled?: boolean;
    /** Hot-loop retrieval depth (default 10). */
    topK?: number;
    /** OOD low-similarity threshold (default 0.65). */
    oodSimThreshold?: number;
    /** OOD flat-top spread threshold (default 0.1). */
    oodFlatThreshold?: number;
    /** OOD strangeness-index threshold (default 1.5). */
    oodSiThreshold?: number;
    /** Scratchpad TTL in milliseconds (default 24h). */
    tempStrategyTtlMs?: number;
    /** Scratchpad graduation hit count (default 3). */
    tempStrategyHitThreshold?: number;
    /** Scratchpad graduation positive ratio (default 0.667). */
    tempStrategyPositiveRatio?: number;
    /** Scratchpad fuzzy-match cosine (default 0.5). */
    tempStrategyMatchThreshold?: number;
    /** Layer-2 shrinkage alpha (default 50). */
    shrinkageAlpha?: number;
    /** Minimum 80%-interval width (default 0.2). */
    minConfidenceIntervalWidth?: number;
    /** Cold-loop time-decay lambda per day (default 0.01). */
    decayLambda?: number;
    /** Cold-loop minimum decay weight (default 0.1). */
    minDecayWeight?: number;
    /** Cold-loop prediction-error inclusion threshold (default 0.3). */
    predictionErrorThreshold?: number;
    /** Cold-loop max sample ratio of the population (default 0.15). */
    maxSampleRatio?: number;
    /** Evidence hard-constraint minimum count (default 3). */
    evidenceMinCount?: number;
    /** Evidence hard-constraint max pairwise cosine distance (default 0.85). */
    evidenceMaxDistance?: number;
    /** Sandbox acceptance: required error reduction ratio (default 0.15). */
    sandboxImprovement?: number;
    /** Validation slice ratio of the sampled set (default 0.2). */
    validationRatio?: number;
    /** Agglomerative merge cosine threshold (default 0.4). */
    clusterMergeCosine?: number;
    /** Cluster-membership cosine threshold (default 0.3). */
    clusterMatchCosine?: number;
    /** Feedback error at/above which an emergency local rebuild fires (default 0.8). */
    emergencyErrorThreshold?: number;
}
/** Resolved configuration with every optional field materialized. */
export interface ResolvedCognitivePipelineConfig {
    readonly root: string;
    readonly enabled: boolean;
    readonly route: CognitiveLlmRoute;
    readonly hot: HotEngineConfig;
    readonly cold: ColdEngineConfig;
    readonly tempStrategyHitThreshold: number;
    readonly tempStrategyPositiveRatio: number;
    readonly emergencyErrorThreshold: number;
}
/** Config schema for Loader validation and defaulting. */
export declare const Config: z<CognitivePipelineConfig>;
/** Validate an untrusted config object without Loader normalization.
 * @param config - untrusted plugin configuration.
 * @returns the resolved immutable configuration.
 */
export declare function resolveConfig(config: CognitivePipelineConfig): ResolvedCognitivePipelineConfig;
/** Durable prediction/experience context for LLM-assisted calls. */
export interface PipelineCallContext {
    readonly sessionId?: GenerateOptions['sessionId'];
    readonly signal?: AbortSignal;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        cognitivePipeline: CognitivePipelineService;
    }
}
/** The pipeline service. */
export declare class CognitivePipelineService extends Service {
    static readonly Config: z<CognitivePipelineConfig>;
    /** Resolved configuration. */
    readonly resolved: ResolvedCognitivePipelineConfig;
    /** The file-backed store (public for inspection). */
    readonly store: CognitiveStore;
    /** Hot-loop engine. */
    readonly hot: HotEngine;
    /** Cold-loop engine. */
    readonly cold: ColdEngine;
    private readonly readinessPromise;
    constructor(ctx: Context, config?: CognitivePipelineConfig);
    /** Resolve after the store finished loading (never rejects). */
    ready(): Promise<void>;
    /** Flush all pending persistence writes. */
    flush(): Promise<void>;
    /** Encode one raw experience into SAR, vectorize, and store it.
     * @param input - the raw experience text.
     * @param call - optional session/signal context.
     * @returns the new experience id and its SAR triplet.
     */
    remember(input: RememberInput, call?: PipelineCallContext): Promise<{
        expId: string;
        sar: SarTriplet;
    }>;
    /** Hot-loop prediction.
     * @param input - the situation/action to predict.
     * @param call - optional session/signal context.
     * @returns the calibrated prediction result.
     */
    predict(input: PredictInput, call?: PipelineCallContext): Promise<PredictResult>;
    /** Feedback loop: resolve a prediction, update calibration and scratchpad.
     * @param input - the prediction id and actual outcome.
     * @param call - optional session/signal context.
     * @returns the logged feedback result.
     */
    report(input: FeedbackInput, call?: PipelineCallContext): Promise<FeedbackResult>;
    /** Cold-loop rebuild.
     * @param scope - local or global.
     * @param call - optional session/signal context.
     * @returns the backtested rebuild outcome.
     */
    rebuild(scope: 'local' | 'global', call?: PipelineCallContext): Promise<RebuildResult>;
    /** Observational snapshot for the inspect tool.
     * @returns counts, clusters, calibration, taxonomy, and recent resolved predictions.
     */
    inspect(): InspectResult;
    /** The dynamic cognition prefix for the system-prompt section.
     * @returns the 附录B prefix text.
     */
    taxonomyPrefix(): string;
    /** All clusters (public for inspection).
     * @returns a detached cluster list.
     */
    clusters(): readonly Cluster[];
    /** All calibration buckets (public for inspection).
     * @returns a detached bucket table.
     */
    calibrationBuckets(): readonly CalibrationBucket[];
    /** Current taxonomy (public for inspection).
     * @returns the taxonomy, or null before the first rebuild.
     */
    taxonomy(): TaxonomyState | null;
    /** Active + graduated scratchpad strategies (public for inspection).
     * @returns a detached strategy list.
     */
    tempStrategies(): readonly TempStrategy[];
    /** Map an actual outcome to a 0–1 observed value. */
    private observedOutcome;
    /** Record scratchpad feedback and graduate qualifying strategies. */
    private feedbackTempStrategy;
}
/** Re-exported utility score for consumers.
 * @param utility - the outcome utility.
 * @returns the signed composite score.
 */
export declare function scoreUtility(utility: OutcomeUtility): number;
//# sourceMappingURL=service.d.ts.map