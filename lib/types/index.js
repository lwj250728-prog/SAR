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
import { CognitivePipelineService, Config, } from "./service.js";
import { registerPipelineTools } from "./tools.js";
/** Stable Cordis plugin name. */
export const name = 'cognitive-pipeline';
/** Services required before the pipeline can mount. */
export const inject = ['llm', 'tools', 'systemPrompt'];
/** Re-export the service and config schema for consumers and Loader validation. */
export { CognitivePipelineService, Config };
export * from "./types.js";
export * from "./vectorizer.js";
/**
 * Mount the pipeline: construct the service (its `Service` base registers
 * `ctx.cognitivePipeline` on this fiber's context), wait for the store, then
 * register the dynamic taxonomy prompt section and (unless disabled) the
 * model tools.
 * @param ctx - plugin context carrying llm/tools/systemPrompt.
 * @param config - pipeline configuration; every field optional.
 */
export async function apply(ctx, config = {}) {
    const service = new CognitivePipelineService(ctx, config);
    await service.ready();
    ctx.systemPrompt.section({
        name: 'cognition:taxonomy',
        order: 300,
        text: () => service.taxonomyPrefix(),
    });
    if (service.resolved.enabled) {
        registerPipelineTools(ctx, service);
    }
}
//# sourceMappingURL=index.js.map