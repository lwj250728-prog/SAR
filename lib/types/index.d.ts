/**
 * Prediction-error-driven dynamic cognition (DCA-PED) as a harness plugin:
 * SAR experience memory, a hot-loop online predictor with OOD detection and
 * five-layer confidence calibration, a temp-strategy scratchpad, and a
 * cold-loop taxonomy rebuild gated by sandbox backtesting. The plugin exposes
 * five model-facing tools, the `ctx.cognitivePipeline` service, and a dynamic
 * `cognition:taxonomy` system-prompt section.
 *
 * @module @deepseek-ai/dsh-cognitive-pipeline
 */
import type { Context } from '@deepseek-ai/cordis';
import { CognitivePipelineService, Config } from './service.ts';
import type { CognitivePipelineConfig } from './service.ts';
/** Stable Cordis plugin name. */
export declare const name = "cognitive-pipeline";
/** Services required before the pipeline can mount. */
export declare const inject: string[];
/** Re-export the service and config schema for consumers and Loader validation. */
export { CognitivePipelineService, Config };
export type { CognitivePipelineConfig } from './service.ts';
export * from './types.ts';
export * from './vectorizer.ts';
/**
 * Mount the pipeline: construct the service (its `Service` base registers
 * `ctx.cognitivePipeline` on this fiber's context), wait for the store, then
 * register the dynamic taxonomy prompt section and (unless disabled) the
 * model tools.
 * @param ctx - plugin context carrying llm/tools/systemPrompt.
 * @param config - pipeline configuration; every field optional.
 */
export declare function apply(ctx: Context, config?: CognitivePipelineConfig): Promise<void>;
//# sourceMappingURL=index.d.ts.map