/**
 * Prediction-error-driven dynamic cognition (DCA-PED) as a harness plugin:
 * SAR experience memory, a hot-loop online predictor with OOD detection and
 * five-layer confidence calibration, a temp-strategy scratchpad, simulated
 * experience generation, and a cold-loop taxonomy rebuild gated by sandbox
 * backtesting. The plugin exposes six model-facing tools, the
 * `ctx.cognitivePipeline` service, and a dynamic `cognition:taxonomy`
 * system-prompt section.
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
/** Template-7 retrieval refinement, reused by consumers (cognitive-inject)
 * as the pre-injection veto gate. */
export { refineRetrieval, refineRetrievalFallback } from "./llm.js";
/** Reconstruct one completed turn into candidate accumulation material.
 * Reads the turn's events back from the session ledger: the genuine user
 * request (source kind 'user') becomes the situation, tool calls become the
 * action, the final assistant text and the end reason become the outcome.
 * @param session - the session whose ledger holds the turn's events.
 * @param endEvent - the turn/end event that closes the turn.
 * @returns the reconstructed episode.
 */
export function reconstructTurn(session, endEvent) {
    const turn = endEvent.data.turn;
    const events = session.events;
    const texts = [];
    const actions = [];
    const outcomes = [];
    let toolCallCount = 0;
    let failed = false;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'turn/start' && event.data.turn === turn)
            break;
        const data = event.data;
        switch (event.type) {
            case 'user/message': {
                // The user/message payload IS the message ({ content, source }), not a
                // { message } wrapper. Only the genuine user request (source kind
                // 'user') feeds the situation; injected reference blocks are noise.
                const source = data.source;
                if (source?.kind !== 'user')
                    break;
                const content = data.content;
                const text = content?.filter(block => block.type === 'text').map(block => block.text ?? '').join(' ');
                if (text !== undefined && text.trim().length > 0)
                    texts.push(text);
                break;
            }
            case 'assistant/message': {
                const message = data.message;
                const text = message?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join(' ');
                if (text !== undefined && text.trim().length > 0)
                    outcomes.push(text);
                break;
            }
            case 'tool/call': {
                toolCallCount += 1;
                const name = typeof data.name === 'string' ? data.name : '?';
                actions.push(`调用 ${name}`);
                break;
            }
            case 'tool/result': {
                // Failure lives on the result message's content blocks, not on the
                // event payload itself.
                const message = data.message;
                if (message?.content?.some(block => block.isError === true) === true || data.error !== undefined)
                    failed = true;
                break;
            }
            default:
                break;
        }
    }
    const reason = endEvent.data.reason?.kind ?? 'unknown';
    const outcome = [...outcomes, `轮次结束（${reason}）`].join(' ').trim();
    return {
        situation: texts.reverse().join(' ').slice(0, 800),
        action: actions.reverse().join('；').slice(0, 800) || outcome.slice(0, 300),
        outcome: outcome.slice(0, 800),
        toolCallCount,
        failed,
        turnId: turn,
    };
}
/**
 * Mount the pipeline: construct the service (its `Service` base registers
 * `ctx.cognitivePipeline` on this fiber's context), wait for the store, then
 * register the dynamic taxonomy prompt section and (unless disabled) the
 * model tools. When `autoAccumulate` is enabled, also listen for completed
 * turns and run each through the accumulation gate.
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
    if (service.resolved.autoAccumulate) {
        ctx.on('session/event', (session, event) => {
            if (event.type !== 'turn/end')
                return;
            const reason = event.data.reason?.kind;
            if (reason !== 'completed' && reason !== 'error')
                return;
            const episode = reconstructTurn(session, event);
            if (episode.situation.trim().length === 0)
                return;
            void service.accumulateTurn(episode).catch((error) => {
                ctx.logger.warn(`cognitive-pipeline: automatic accumulation failed: ${String(error)}`);
            });
        });
    }
}
//# sourceMappingURL=index.js.map