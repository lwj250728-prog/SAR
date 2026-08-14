/**
 * Cold-loop engine: offline taxonomy reconstruction. Samples decay-weighted
 * high-error experiences, clusters them in utility space, anchors clusters
 * with LLM causal evidence (hard-constrained), backtests the proposal on the
 * newest slice, and atomically writes back only on a ≥15% error reduction.
 * @module @deepseek-ai/dsh-cognitive-pipeline/cold-engine
 */
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { CognitiveLlmRoute } from './llm.ts';
import { CognitiveStore } from './store.ts';
import type { RebuildResult } from './types.ts';
/** Fully resolved cold-loop thresholds (no optional fields). */
export interface ColdEngineConfig {
    readonly decayLambda: number;
    readonly minDecayWeight: number;
    readonly predictionErrorThreshold: number;
    readonly maxSampleRatio: number;
    readonly evidenceMinCount: number;
    readonly evidenceMaxDistance: number;
    readonly sandboxImprovement: number;
    readonly validationRatio: number;
    readonly clusterMergeCosine: number;
    readonly clusterMatchCosine: number;
}
/**
 * Cold-loop engine. `runRebuild` is the offline entry point; it never throws
 * for domain reasons — every outcome is a {@link RebuildResult}.
 */
export declare class ColdEngine {
    private readonly ctx;
    private readonly store;
    private readonly config;
    private readonly route;
    constructor(ctx: Context, store: CognitiveStore, config: ColdEngineConfig, route: CognitiveLlmRoute);
    /**
     * Run one rebuild. `local` restricts sampling to the highest-error cluster;
     * `global` samples the whole store.
     * @param scope - the rebuild scope.
     * @param sessionId - optional session identity for the reconstruction call.
     * @param signal - optional cancellation for the reconstruction call.
     * @returns the backtested rebuild outcome; never rejects for domain reasons.
     */
    runRebuild(scope: 'local' | 'global', sessionId?: GenerateOptions['sessionId'], signal?: AbortSignal): Promise<RebuildResult>;
    /** Short-circuit rejection result. */
    private rejected;
    /** Decay-weighted, error-preferring sample selection (≤ maxSampleRatio). */
    private sample;
    /**
     * Keep at most maxSampleRatio of the total population, error-first, with a
     * small-store floor so a rebuild stays possible before a store reaches
     * production scale (the ratio cap targets the 10万-record regime).
     */
    private cap;
    /** Deterministic candidate clusters from the agglomerative groups. */
    private fallbackCandidates;
    /** ≤30-char summary of the rebuild's logical change from group statistics. */
    private composeGroupSummary;
    /** Build normalized views for the stored cluster table. */
    private clusterViews;
    /** Predict 0/1 positivity for each validation experience under a taxonomy. */
    private predictionsFor;
    /** Mean absolute error of a taxonomy over the validation slice. */
    private evaluateViews;
    /** Apply the accepted taxonomy: new clusters, assignments, summary, rules. */
    private writeBack;
    /** Index of the graduated strategy's nearest verified cluster, or -1. */
    private nearestClusterIndex;
    /** Compose the one-sentence taxonomy summary for the prompt prefix. */
    private composeVersionSummary;
}
//# sourceMappingURL=cold-engine.d.ts.map