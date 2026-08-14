/**
 * File-backed store of the cognitive pipeline. In-memory maps serve the hot
 * path; JSONL files under the configured root persist each table. Mutations
 * are synchronous in memory and enqueue an atomic (write-temp + rename)
 * persistence pass; `flush()` awaits all pending writes.
 * @module @deepseek-ai/dsh-cognitive-pipeline/store
 */
import type { CalibrationBucket, Cluster, Experience, Prediction, TaxonomyState, TempStrategy } from './types.ts';
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
     * prediction error to the bound experience's cumulative error.
     * @param predictionId - the prediction to resolve.
     * @param actualOutcome - the observed outcome text.
     * @param predictionError - absolute error in [0, 1].
     * @returns the resolved prediction.
     */
    resolvePrediction(predictionId: string, actualOutcome: string, predictionError: number): Prediction;
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
}
//# sourceMappingURL=store.d.ts.map