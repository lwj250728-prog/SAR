/**
 * File-backed store of the cognitive pipeline. In-memory maps serve the hot
 * path; JSONL files under the configured root persist each table. Mutations
 * are synchronous in memory and enqueue an atomic (write-temp + rename)
 * persistence pass; `flush()` awaits all pending writes.
 * @module @deepseek-ai/dsh-cognitive-pipeline/store
 */
import type { CalibrationBucket, ChannelWeights, Cluster, Experience, Prediction, TaxonomyState, TempStrategy } from './types.ts';
/** How many calibration deciles the lifetime stats keep. */
export declare const CALIBRATION_BUCKETS = 10;
/**
 * Index a probability into its decile bucket.
 * @param probability - the probability in [0, 1].
 * @returns the decile index 0–9.
 */
export declare function bucketIndex(probability: number): number;
/** The complete persisted state of one pipeline store. */
export declare class CognitiveStore {
    private readonly root;
    private readonly queue;
    private experiences;
    private predictions;
    private tempStrategies;
    private clusterList;
    private calibration;
    private channelWeights;
    private taxonomyState;
    private nextExpSeq;
    private nextPredictionSeq;
    private nextClusterSeq;
    /**
     * @param root - directory that will hold the JSONL/JSON state files.
     */
    constructor(root: string);
    private file;
    /** Create the root and load every table. Missing files start empty. */
    load(): Promise<void>;
    /** Await every pending persistence write. */
    flush(): Promise<void>;
    private enqueue;
    private enqueueLines;
    /**
     * Store one experience and enqueue its persistence.
     * @param exp - the experience to add.
     */
    addExperience(exp: Experience): void;
    /**
     * Read one experience by id.
     * @param expId - the experience id.
     * @returns the experience, or undefined.
     */
    getExperience(expId: string): Experience | undefined;
    /** Snapshot of every stored experience.
     * @returns experiences in insertion order.
     */
    experiencesSnapshot(): readonly Experience[];
    /**
     * Apply a partial patch to one experience and enqueue its persistence.
     * @param expId - the experience id.
     * @param patch - the fields to replace.
     * @returns the updated experience.
     */
    updateExperience(expId: string, patch: Partial<Experience>): Experience;
    /**
     * Fold one real-feedback evidence weight into a simulated experience's
     * verification state (the evidence-replacement model): a single decisive
     * weight fast-tracks to provisional, cumulative evidence upgrades to
     * verified, and a contradictory provisional feedback rolls back. Ordinary
     * experiences are verified by construction and unaffected.
     * @param expId - the experience id.
     * @param weight - the feedback evidence weight in [0, 1].
     * @param contradictory - whether the feedback contradicts the simulation.
     * @param fastTrackThreshold - weight at/above which one feedback fast-tracks.
     * @param permanentThreshold - cumulative evidence needed for permanent verified.
     * @returns the updated experience.
     */
    applyFeedbackEvidence(expId: string, weight: number, contradictory: boolean, fastTrackThreshold: number, permanentThreshold: number): Experience;
    /**
     * Expire simulated experiences that never earned real feedback within the
     * fallback TTL. This is the backstop of the evidence-replacement model:
     * verification and density are primary, the timeout guards the
     * never-verified corner.
     * @param now - the reference timestamp.
     * @param ttlMs - the fallback TTL for unverified simulated experiences.
     * @returns the expIds removed.
     */
    expireUnverifiedSimulated(now: number, ttlMs: number): string[];
    /** Store one prediction and enqueue its persistence.
     * @param prediction - the prediction to add.
     */
    addPrediction(prediction: Prediction): void;
    /** Read one prediction by id.
     * @param predictionId - the prediction id.
     * @returns the prediction, or undefined.
     */
    getPrediction(predictionId: string): Prediction | undefined;
    /** Snapshot of every stored prediction.
     * @returns predictions in insertion order.
     */
    predictionsSnapshot(): readonly Prediction[];
    /**
     * Resolve one prediction with its actual outcome, propagating the absolute
     * prediction error to the bound experience's cumulative error. When the
     * feedback carries a result-quality label, it is folded back into the bound
     * experience's utility so "predicted wrong but quality known" experiences
     * carry a real tag instead of staying neutral.
     * @param predictionId - the prediction to resolve.
     * @param actualOutcome - the observed outcome text.
     * @param predictionError - absolute error in [0, 1].
     * @param outcomeQuality - optional result quality 0-10 to fold into the bound experience.
     * @returns the resolved prediction.
     */
    resolvePrediction(predictionId: string, actualOutcome: string, predictionError: number, outcomeQuality?: number): Prediction;
    /** Read one scratchpad strategy by signature hash.
     * @param signatureHash - the strategy key.
     * @returns the strategy, or undefined.
     */
    getTempStrategy(signatureHash: string): TempStrategy | undefined;
    /** Store one scratchpad strategy and enqueue its persistence.
     * @param strategy - the strategy to add.
     */
    addTempStrategy(strategy: TempStrategy): void;
    /** Apply a partial patch to one scratchpad strategy.
     * @param signatureHash - the strategy key.
     * @param patch - the fields to replace.
     * @returns the updated strategy.
     */
    updateTempStrategy(signatureHash: string, patch: Partial<TempStrategy>): TempStrategy;
    /** Snapshot of every scratchpad strategy.
     * @returns strategies in insertion order.
     */
    tempStrategiesSnapshot(): readonly TempStrategy[];
    /**
     * Expire active strategies past their TTL.
     * @param now - the reference timestamp; defaults to the current time.
     * @returns the hashes that were expired.
     */
    expireTempStrategies(now?: number): string[];
    /** Record one resolved prediction in its confidence decile.
     * @param probability - the calibrated probability.
     * @param hit - whether the outcome was positive.
     */
    recordCalibration(probability: number, hit: boolean): void;
    /** Snapshot of every calibration bucket.
     * @returns a detached decile table.
     */
    calibrationBucketsSnapshot(): readonly CalibrationBucket[];
    /**
     * Lifetime empirical accuracy for one probability's decile bucket.
     * @param probability - the calibrated probability.
     * @returns the bucket accuracy, or null when the bucket has no count.
     */
    empiricalAccuracyFor(probability: number): number | null;
    /** Snapshot of the learned retrieval channel weights.
     * @returns a detached weight record.
     */
    channelWeightsSnapshot(): ChannelWeights;
    /** Apply one EWMA step to the learned retrieval channel weights.
     * @param weights - the new weights; each must already be clamped.
     */
    updateChannelWeights(weights: ChannelWeights): void;
    /** Snapshot of the cluster table.
     * @returns clusters with detached fields.
     */
    clustersSnapshot(): readonly Cluster[];
    /** Snapshot of the current taxonomy.
     * @returns the taxonomy, or null before the first rebuild.
     */
    taxonomySnapshot(): TaxonomyState | null;
    /** Allocate the next cluster id.
     * @returns a fresh monotonically increasing id.
     */
    nextClusterId(): number;
    /**
     * Atomically replace the cluster table and taxonomy, and reassign member
     * experiences to their new clusters. One enqueued flush per table keeps the
     * files consistent with each other.
     * @param clusters - the new cluster table.
     * @param taxonomy - the new taxonomy snapshot.
     * @param assignments - per-experience cluster membership to write back.
     */
    applyTaxonomy(clusters: readonly Cluster[], taxonomy: TaxonomyState, assignments: ReadonlyMap<string, {
        clusterId: number;
        strategyLabel: string;
    }>): void;
    /** Simple in-memory + disk counts for inspection.
     * @returns experience, prediction, and resolved counts.
     */
    stats(): {
        experienceCount: number;
        predictionCount: number;
        resolvedPredictionCount: number;
    };
    /** Allocate the next experience id.
     * @returns `exp_<n>`.
     */
    nextExpId(): string;
    /** Allocate the next prediction id.
     * @returns `pred_<n>`.
     */
    nextPredictionId(): string;
    /** Derive a normalized cluster view when the on-disk row predates the new
     * polarity / situationCentroid fields: polarity from the expected utility
     * range, centroid from the supporting experiences' situations.
     * @param raw - the loaded, still-untrusted cluster row.
     * @returns the cluster with both new fields present.
     */
    private normalizeCluster;
}
//# sourceMappingURL=store.d.ts.map