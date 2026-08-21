import { a as actionVector, c as isPositiveOutcome, d as outcomeVector, f as signatureHash, h as utilityScore, i as UTILITY_SLOTS, l as normalize, m as tokenize, n as OUTCOME_VECTOR_DIM, o as cosine, p as symptomOverlap, r as SYMPTOM_MARKERS, s as hashToken, t as ACTION_VECTOR_DIM, u as outcomePolarity } from "./vectorizer-D1RYVmyo.js";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { BlockAssembler, ReasoningEffortId, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region lib/types/prompts.js
/**
* Prompt templates of the cognitive pipeline, adapted from the DCA-PED
* production prompt library (03-提示词模板库.md). Four templates plus the
* dynamic cognition prefix (附录B). Every template demands structured JSON
* output; callers enforce the JSON contract and degrade deterministically.
* @module @deepseek-ai/dsh-cognitive-pipeline/prompts
*/
/** Template 1: SAR triplet extraction and utility scoring. */
const SAR_SYSTEM_PROMPT = [
	"你是一位经验编码专家。你的任务是从用户提供的原始经历文本中，提取出严格的\"情境-行动-结果\"（SAR）三元组。",
	"【提取规则】：",
	"1. 情境（S）：客观约束，不含主观情绪（如\"老板深夜发来修改意见\"）。若是排障/失败经历，必须把可观测的失败症状写进情境——错误信息、挂起、编译失败、超时、exit code 等（如\"测试脚本突然无限挂起\"而非\"测试出了问题\"）。症状是未来相似问题被检索到的关键线索。",
	"2. 行动（A）：主体发出的具体行为策略（如\"立即起身去健身房\"而非\"感觉很糟\"）。",
	"3. 结果（R）：可观测的短期+长期反馈（如\"失眠但次日获得表扬\"）。必须包含收益/代价的量化描述。",
	"【输出格式】：严格按照以下JSON Schema输出：",
	"{",
	"  \"situation\": \"string\",",
	"  \"action\": \"string\",",
	"  \"outcome\": \"string\",",
	"  \"action_keywords\": [\"list\", \"of\", \"verbs\"],",
	"  \"outcome_utility_score\": {",
	"    \"material_gain\": 0-10,",
	"    \"emotional_valence\": 0-10,",
	"    \"energy_cost\": 0-10",
	"  }",
	"}"
].join("\n");
/** Template 2: hot-loop OOD review / strangeness confirmation. */
const OOD_REVIEW_SYSTEM_PROMPT = [
	"你是系统的\"不确定性雷达\"。给你一段新的【行动描述】和检索到的【Top-3历史相似行动】。",
	"请判断：新行动是否属于历史模式中某个已知策略的合理变体，还是完全陌生的新物种？",
	"判断标准：",
	"- 如果只是\"参数调整\"（如跑步距离从5公里变6公里），标记为\"known\"。",
	"- 如果\"逻辑意图\"发生了变化（如从\"为健康跑步\"变为\"为逃避工作跑步\"），标记为\"novel\"。",
	"【输出JSON格式】：",
	"{",
	"  \"is_known\": boolean,",
	"  \"confidence_score\": 0-100,",
	"  \"reasoning_short\": \"一句话理由\",",
	"  \"suggested_initial_risk_level\": \"low\" | \"medium\" | \"high\"",
	"}"
].join("\n");
/** Template 3: five-layer confidence calibration with adversarial challenge. */
const CALIBRATION_SYSTEM_PROMPT = [
	"你是一位严谨的决策顾问。基于用户当前的【情境】和【拟采取行动】，以及系统检索到的历史相似案例（其中正向结果M个，负向结果N个），请执行以下分步思维：",
	"第一步（基准估算）：仅根据M和N的比例，给出初始成功率基准。",
	"第二步（对抗性挑战，关键步骤）：请强制列举3个独立的、具体的、即使历史数据看起来不错但仍可能导致本次行动彻底失败的外部因素。例如：天气突变、关键人物临时缺席、政策窗口关闭等。",
	"第三步（区间校准）：基于上述风险因素，重新校正你的判断。不要给单点概率，而是给出一个80%的置信区间 [下限, 上限]。注意：越不确定，区间应该越宽（例如允许20%~80%）；越确定，区间可以缩窄（如60%~75%）。",
	"【严格JSON输出格式】：",
	"{",
	"  \"base_success_rate\": 0-100,",
	"  \"risk_factors\": [\"具体因素1\", \"具体因素2\", \"具体因素3\"],",
	"  \"final_confidence_interval_low\": 0-100,",
	"  \"final_confidence_interval_high\": 0-100,",
	"  \"final_calibrated_probability\": 0-100,",
	"  \"advice_preview\": \"给用户的极简行动建议（不超过20字）\"",
	"}"
].join("\n");
/** Template 4: cold-loop causal-anchored taxonomy reconstruction. */
const RECONSTRUCT_SYSTEM_PROMPT = [
	"你是认知架构的\"首席重构官\"。现在提供给你一组经过筛选的经历样本（每个样本包含ID、情境、行动、结果效用评分）。当前旧的分类体系已经因为高频预测误差而失效。",
	"【重构任务】：",
	"1. 放弃旧标签，基于【情境-策略配对的重现模式】重新聚类：把情境前提（行动者水平、环境约束、时间压力等）与所采用策略一起反复出现的模式识别为簇。",
	"2. 同一类行动在不同前提（例如新手教学 vs 资深例行）下反复出现且策略不同时，拆分为不同簇，各自给出独立策略；情境措辞有差异但策略相同则合并为一簇。",
	"3. 每个新簇必须拥有鲜明的策略导向。标签命名格式必须为：\"当【触发条件】出现，应【采用行动姿态】，预期获得【效用区间】\"。",
	"【证据相干性（硬性约束，后端会按此校验并驳回不相干簇）】：",
	"- 每个簇的支撑证据必须是\"同一效用模式\"的经历：彼此在 material_gain、emotional_valence、energy_cost 三个维度上都应接近（单维差距不宜超过3），并且与簇的 expected_utility_range 一致。",
	"- energy_cost 会把表面相似的\"成功\"拆成不同模式：低成本成功（cost 2~4）与高投入成功（cost 5~8）是不同策略簇，禁止混入同一簇。",
	"- 无法归入任何相干簇的样本——高代价离群、中性（三个维度都是5）、仅出现1次的孤立事件——必须放入\"噪声/偶发池\"并忽略，禁止强行并入某个簇。",
	"- 宁缺毋滥：只有模式差异稳定且有至少3条支撑证据时才拆簇，不要为单次措辞差异过度拆分。",
	"【防幻觉锁】：",
	"- 每创建一个新簇，必须从提供的样本中引用至少3个不同的exp_id作为支撑证据；引用的exp_id必须真实存在于样本列表中，禁止编造。",
	"【输出JSON格式】：",
	"{",
	"  \"new_clusters\": [",
	"    {",
	"      \"cluster_name\": \"string\",",
	"      \"decision_rule\": \"if condition X then action Y\",",
	"      \"expected_utility_range\": {\"low\": 0, \"high\": 10},",
	"      \"supporting_evidence_ids\": [\"exp_001\", \"exp_045\", \"exp_102\"],",
	"      \"fallback_action\": \"当匹配度<60%时的备选策略\"",
	"    }",
	"  ],",
	"  \"taxonomy_summary_short\": \"一句话概括本次重构的核心逻辑变化（限30字）\"",
	"}"
].join("\n");
/** Frame template-1 input.
* @param rawText - the raw experience text.
* @returns the user message body.
*/
function frameSarInput(rawText) {
	return `原始经历文本：\n${rawText}`;
}
/** Frame template-2 input with the new action and the top-3 historical actions.
* @param action - the proposed action.
* @param topActions - historical actions with similarity.
* @returns the user message body.
*/
function frameOodInput(action, topActions) {
	return `【新的行动描述】：${action}\n\n【Top-3历史相似行动】：\n${topActions.length === 0 ? "（无历史相似行动）" : topActions.map((sample) => `- ${sample.expId} (相似度 ${sample.similarity.toFixed(3)}): ${sample.action}`).join("\n")}`;
}
/** Frame template-3 input with the situation/action and top-K sample stats.
* @param situation - the current situation.
* @param action - the proposed action.
* @param context - optional extra context.
* @param positiveCount - positive history hits.
* @param negativeCount - negative history hits.
* @param samples - compact sample summaries.
* @returns the user message body.
*/
function frameCalibrationInput(situation, action, context, positiveCount, negativeCount, samples) {
	return `【情境】：${situation}\n【拟采取行动】：${action}${context === void 0 || context.length === 0 ? "" : `\n【额外上下文】：${context}`}\n\n【历史相似案例统计】：正向结果 ${positiveCount} 个，负向结果 ${negativeCount} 个\n【历史相似案例摘要（仅关键词与效用评分，无完整原文）】：
` + samples.map((sample) => `- ${sample.expId}${sample.meta === true ? "【元经验-管道自身】" : ""}: 关键词[${sample.actionKeywords}] 效用(${sample.utility})`).join("\n");
}
/** Frame template-4 input with the sampled experiences.
* @param samples - the sampled train experiences.
* @returns the user message body.
*/
function frameReconstructInput(samples) {
	return samples.map((sample) => {
		const u = sample.sar.outcomeUtility;
		return `- ${sample.expId}: 情境="${sample.sar.situation}" 行动="${sample.sar.action}" 结果效用(material_gain=${u.materialGain}, emotional_valence=${u.emotionalValence}, energy_cost=${u.energyCost})`;
	}).join("\n");
}
/** Template 5: the accumulation gate — judge whether a completed turn is worth
* becoming an experience, and extract the SAR triplet when it is. */
const ACCUMULATE_SYSTEM_PROMPT = [
	"你是认知管线的\"记忆评估官\"。现在提供给你一段刚完成的代理工作（情境、行动、结果摘要）以及若干历史相似经验。",
	"【判断任务】：",
	"1. 判断这段工作是否值得沉淀为一条新经验：是否包含可复用的情境-策略模式、是否与历史经验显著不同、是否对未来的预测有指导价值。",
	"2. 值得则提取 SAR 三元组与三维效用（material_gain / emotional_valence / energy_cost，0-10，5 为中性）；不值得则 should_accumulate 为 false。",
	"【判断标准（宁缺毋滥）】：",
	"- 纯寒暄、无实质工作、与历史经验高度重复的片段不值得沉淀。",
	"- 成功经验（完成了有价值的工作）与失败经验（踩了坑、定位了根因）都值得沉淀。",
	"- 情境、行动、结果必须来自提供的材料，禁止编造。",
	"【输出JSON格式】：",
	"{",
	"  \"should_accumulate\": true,",
	"  \"situation\": \"string（情境）\",",
	"  \"action\": \"string（行动）\",",
	"  \"outcome\": \"string（结果）\",",
	"  \"material_gain\": 0-10,",
	"  \"emotional_valence\": 0-10,",
	"  \"energy_cost\": 0-10",
	"}"
].join("\n");
/** Frame template-5 input with the completed episode and similar history. */
function frameAccumulateInput(episode, similar) {
	return `【刚完成的工作】：\n- 情境：${episode.situation}\n- 行动：${episode.action}\n- 结果：${episode.outcome}\n\n` + (similar.length === 0 ? "【历史相似经验】：（无）" : "【历史相似经验】（用于判断是否与已积累经验重复）：\n" + similar.map((hit) => `- [${hit.expId}] (相似度 ${hit.similarity.toFixed(2)}) ${hit.text}`).join("\n"));
}
/** 附录B: the dynamic cognition prefix injected into the hot-loop system prompt.
* @param taxonomy - the current taxonomy, or null before the first rebuild.
* @returns the prefix text.
*/
function cognitionPrefix(taxonomy) {
	if (taxonomy === null || taxonomy.rules.length === 0) return [
		"【当前活跃认知框架（最后更新于：无——尚未完成首次重构）】：",
		"1. 分类体系摘要：尚无。系统处于冷启动阶段，一切情境按\"全新现象\"谨慎处理。",
		"",
		"【系统元认知】：",
		"- 对于未列入上述规则的陌生情境，系统将明确告知不确定性。",
		"- 所有概率输出均经过样本量收缩与校准，请用户参考区间而非点估计。"
	].join("\n");
	const ruleLines = taxonomy.rules.map((rule, index) => {
		const marker = rule.polarity === "success" ? "✅成功" : "⚠️风险";
		return `   - 规则${String.fromCharCode(65 + index)}（${marker}）：若 ${rule.condition} → 推荐 ${rule.action}，预期效用 ${rule.utilityRange.low}~${rule.utilityRange.high}`;
	});
	return [
		`【当前活跃认知框架（最后更新于 ${new Date(taxonomy.updatedAt).toISOString()}，版本 ${taxonomy.version}）】：`,
		`1. 分类体系摘要：${taxonomy.summaryShort}`,
		"2. 核心决策规则树：",
		...ruleLines,
		"",
		"【系统元认知】：",
		"- 对于未列入上述规则的陌生情境，系统将明确告知不确定性。",
		"- 所有概率输出均经过样本量收缩与校准，请用户参考区间而非点估计。"
	].join("\n");
}
/** Template 6: derive a reference experience from the commonalities of similar
* history — an online generalization for cold start. */
const DERIVE_REFERENCE_SYSTEM_PROMPT = [
	"你是认知管线的\"经验归纳官\"。现在提供给你一段当前情境/拟行动，以及若干条相似的历史经验。",
	"【归纳任务】：",
	"1. 挖掘这些相似历史经验的【共同模式】：它们在什么典型情境下、采取了什么典型行动、得到了什么典型结果与效用。",
	"2. 基于共同模式，合成一条【参考经验】：一条能代表\"这类情境通常如何解决\"的通用经验，供未来检索使用。",
	"【生成规则】：",
	"- 参考经验的每个字段必须来自提供的相似经验，禁止凭空编造超出共同模式的细节。",
	"- 如果相似经验过少或彼此矛盾（找不到共同模式），应明确拒绝（should_derive 为 false）。",
	"- 参考经验的效用取相似经验的典型区间（material_gain / emotional_valence / energy_cost，0-10，5 为中性）。",
	"【输出JSON格式】：",
	"{",
	"  \"should_derive\": true,",
	"  \"situation\": \"string（典型情境模式）\",",
	"  \"action\": \"string（典型行动策略）\",",
	"  \"outcome\": \"string（典型结果）\",",
	"  \"material_gain\": 0-10,",
	"  \"emotional_valence\": 0-10,",
	"  \"energy_cost\": 0-10",
	"}"
].join("\n");
/** Frame template-6 input with the query and its similar history. */
function frameDeriveReferenceInput(query, similar) {
	return `【当前情境】：${query.situation}\n【拟采取行动】：${query.action}\n\n` + (similar.length === 0 ? "【相似历史经验】：（无——没有足够相似经验时请拒绝派生）" : "【相似历史经验】（按相似度排序）：\n" + similar.map((hit) => `- [${hit.expId}] (相似度 ${hit.similarity.toFixed(2)}) ${hit.text}`).join("\n"));
}
/** Template 7: refine retrieval when the deterministic routing is
* low-confidence — the LLM route judges whether the fused top hit genuinely
* applies, instead of the hot loop blindly trusting the cosine ranking. */
const REFINE_RETRIEVAL_SYSTEM_PROMPT = [
	"你是认知管线的\"检索精排官\"。现在给出当前情境/拟行动，以及按相似度排序的候选经验。",
	"【精排任务】：",
	"1. 判断排第一的候选经验是否【真正适用于】当前情境与行动——余弦相似不代表情境可迁移。",
	"2. 重点关注前提是否一致：相同行动在不同前提（用户熟练度、环境约束、时间压力等）下可能策略相反。",
	"3. 只有当你确信 Top1 会误导（前提矛盾、情境不可迁移）时才拒绝；否则保留。",
	"【输出JSON格式】：",
	"{",
	"  \"should_keep\": true,",
	"  \"rejected_exp_id\": \"string|null（拒绝时填被拒经验的expId）\",",
	"  \"reason\": \"string|null（拒绝理由，一句）\"",
	"}"
].join("\n");
/** Frame template-7 input with the query and the fused candidates. */
function frameRefineRetrievalInput(query, candidates) {
	return `【当前情境】：${query.situation}\n【拟采取行动】：${query.action}\n\n【候选经验】（按融合相似度排序）：\n` + candidates.map((hit) => `- [${hit.expId}] (语义相似度 ${hit.similarity.toFixed(2)}) ${hit.text}`).join("\n");
}
//#endregion
//#region lib/types/llm.js
/**
* Typed LLM helpers for the cognitive pipeline. Each model-assisted step is a
* best-effort enhancement over a deterministic fallback: a missing adapter, an
* unreachable route, or a malformed JSON reply never breaks the pipeline — it
* degrades to the mathematically safe path (附录C of the design).
* @module @deepseek-ai/dsh-cognitive-pipeline/llm
*/
/** Stable error taxonomy for pipeline-side failures. */
var CognitivePipelineError = class extends Error {
	/** Stable machine-readable error code. */
	code;
	/**
	* @param message - non-empty human-readable failure summary.
	* @param code - non-empty stable machine code.
	*/
	constructor(message, code) {
		super(message);
		this.name = "CognitivePipelineError";
		this.code = code;
	}
};
/** Whether an explicit route is configured at all.
* @param route - the configured route pair.
* @returns true when both provider and model are set.
*/
function hasExplicitRoute(route) {
	return route.provider !== void 0 && route.model !== void 0;
}
/** Validate the route pair; both or neither must be present and non-empty.
* @param route - the candidate route.
* @returns a validated route, or an empty route.
*/
function resolveRoute(route) {
	const provider = route.provider;
	const model = route.model;
	if (provider === void 0 && model === void 0) return {};
	if (provider === void 0 || model === void 0 || provider.length === 0 || model.length === 0) throw new CognitivePipelineError("cognitive-pipeline: provider and model must be supplied together as non-empty strings", "INVALID_LLM_ROUTE");
	return {
		provider,
		model
	};
}
/** Extract the first balanced JSON object from model text.
* @param text - the raw model output.
* @returns the parsed JSON value.
*/
function extractJson(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) throw new CognitivePipelineError("cognitive-pipeline: model produced empty output", "EMPTY_LLM_OUTPUT");
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		if (start < 0) throw new CognitivePipelineError("cognitive-pipeline: model output contains no JSON object", "LLM_JSON_PARSE_FAILED");
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < trimmed.length; index += 1) {
			const char = trimmed[index] ?? "";
			if (inString) {
				if (escaped) escaped = false;
				else if (char === "\\") escaped = true;
				else if (char === "\"") inString = false;
				continue;
			}
			if (char === "\"") inString = true;
			else if (char === "{") depth += 1;
			else if (char === "}") {
				depth -= 1;
				if (depth === 0) try {
					return JSON.parse(trimmed.slice(start, index + 1));
				} catch {
					break;
				}
			}
		}
		throw new CognitivePipelineError("cognitive-pipeline: model output is not valid JSON", "LLM_JSON_PARSE_FAILED");
	}
}
/** Map LLM text blocks to one string. */
function textOf(blocks) {
	return blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ");
}
/** Ensure the parsed JSON is a non-null object before field access. */
function asObject(value, label) {
	if (typeof value !== "object" || value === null) throw new CognitivePipelineError(`cognitive-pipeline: ${label} output must be a JSON object`, "LLM_SCHEMA_FAILED");
	return value;
}
/** Translate a terminal finish reason into an error, or undefined on stop. */
function finishError(finish) {
	switch (finish.kind) {
		case "stop": return;
		case "error":
		case "aborted": return new CognitivePipelineError(`cognitive-pipeline: model call failed: ${finish.failure.message}`, finish.failure.code);
		case "max-tokens": return new CognitivePipelineError("cognitive-pipeline: model output reached maxTokens", "LLM_MAX_TOKENS");
		case "tool-calls": return new CognitivePipelineError("cognitive-pipeline: model unexpectedly requested a tool", "LLM_UNEXPECTED_TOOL");
		default: return new CognitivePipelineError("cognitive-pipeline: unsupported finish reason", "LLM_FINISH_FAILED");
	}
}
/** Terminate a stream and return the assembled text; throws on failure. */
async function drainText(ctx, options, maxTokens) {
	const assembler = new BlockAssembler();
	for await (const chunk of ctx.llm.stream(options)) {
		options.signal?.throwIfAborted();
		assembler.push(chunk);
	}
	options.signal?.throwIfAborted();
	const failure = finishError(assembler.finish);
	if (failure !== void 0) throw failure;
	if (assembler.blocks().some((block) => block.type === "tool-call")) throw new CognitivePipelineError("cognitive-pipeline: model output must contain text only", "LLM_UNEXPECTED_TOOL");
	const text = textOf(assembler.blocks());
	if (text.trim().length === 0) throw new CognitivePipelineError(`cognitive-pipeline: model produced no text (maxTokens=${maxTokens})`, "EMPTY_LLM_OUTPUT");
	return text;
}
/** Call one template and parse its JSON output. */
async function callJson(ctx, route, system, user, options) {
	const maxTokens = options.maxTokens ?? 800;
	const messages = [createUserMessage({
		content: [{
			type: "text",
			text: user
		}],
		source: {
			kind: "plugin",
			plugin: "cognitive-pipeline"
		}
	})];
	return extractJson(await drainText(ctx, deepFreeze({
		provider: route.provider,
		model: route.model,
		messages,
		system,
		maxTokens,
		reasoningEffort: ReasoningEffortId("off"),
		...options.sessionId === void 0 ? {} : { sessionId: options.sessionId },
		...options.signal === void 0 ? {} : { signal: options.signal }
	}), maxTokens));
}
/** Clamp a number into [0, 1]. */
function clamp01$1(value) {
	return Math.min(1, Math.max(0, value));
}
/** Clamp an integer into [0, 10]. */
function clampUtility(value) {
	if (!Number.isFinite(value)) return 5;
	return Math.min(10, Math.max(0, Math.round(value)));
}
/** Whether a sentence carries an observable failure symptom. */
function hasSymptom(sentence) {
	const lower = sentence.toLowerCase();
	return SYMPTOM_MARKERS.some((marker) => lower.includes(marker));
}
/** Deterministic template-1 fallback: split sentences, neutral utility. */
function sarFallback(rawText) {
	const sentences = rawText.split(/(?<=[。！？!?.])\s*/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
	const situation = sentences[0] ?? rawText.slice(0, 80);
	const action = sentences[1] ?? rawText.slice(0, 80);
	const outcome = sentences.slice(2).join(" ") || rawText.slice(0, 120);
	const symptomSentences = sentences.filter(hasSymptom);
	return {
		situation: symptomSentences.length === 0 ? situation : [...new Set([situation, ...symptomSentences])].join(" "),
		action,
		outcome,
		actionKeywords: [...new Set(tokenize(action))].slice(0, 8),
		outcomeUtility: {
			materialGain: 5,
			emotionalValence: 5,
			energyCost: 5
		}
	};
}
/**
* Template 1: extract the SAR triplet. Falls back to a deterministic split.
* @param ctx - plugin context for the LLM call.
* @param route - explicit model route.
* @param rawText - the raw experience text.
* @param options - call context (session/signal/maxTokens).
* @returns the extracted triplet.
*/
async function extractSar(ctx, route, rawText, options) {
	if (!hasExplicitRoute(route)) return sarFallback(rawText);
	try {
		const parsed = asObject(await callJson(ctx, route, SAR_SYSTEM_PROMPT, frameSarInput(rawText), {
			...options,
			maxTokens: 500
		}), "SAR");
		if (typeof parsed.situation !== "string" || typeof parsed.action !== "string" || typeof parsed.outcome !== "string") throw new CognitivePipelineError("cognitive-pipeline: SAR output missing string fields", "SAR_SCHEMA_FAILED");
		const utility = parsed.outcome_utility_score;
		const keywords = Array.isArray(parsed.action_keywords) ? parsed.action_keywords.filter((keyword) => typeof keyword === "string").slice(0, 16) : [];
		const materialGain = Number(utility?.material_gain);
		const emotionalValence = Number(utility?.emotional_valence);
		const energyCost = Number(utility?.energy_cost);
		if (!Number.isFinite(materialGain) || !Number.isFinite(emotionalValence) || !Number.isFinite(energyCost)) throw new CognitivePipelineError("cognitive-pipeline: SAR output missing utility fields", "SAR_UTILITY_FAILED");
		return {
			situation: parsed.situation,
			action: parsed.action,
			outcome: parsed.outcome,
			actionKeywords: keywords.length > 0 ? keywords : [...new Set(tokenize(parsed.action))].slice(0, 8),
			outcomeUtility: {
				materialGain: clampUtility(materialGain),
				emotionalValence: clampUtility(emotionalValence),
				energyCost: clampUtility(energyCost)
			}
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: SAR extraction degraded to fallback: ${String(error)}`);
		return sarFallback(rawText);
	}
}
/** Deterministic template-2 fallback: trust the math-only OOD signal.
* @param isKnown - the math-only decision.
* @returns a review with 50% confidence.
*/
function oodReviewFallback(isKnown) {
	return {
		isKnown,
		confidenceScore: 50,
		reasoningShort: "无模型复核（降级模式），仅依据数学相似度判定",
		suggestedInitialRiskLevel: isKnown ? "low" : "high"
	};
}
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
async function reviewOod(ctx, route, action, topActions, mathSaysKnown, options) {
	if (!hasExplicitRoute(route)) return oodReviewFallback(mathSaysKnown);
	try {
		const parsed = asObject(await callJson(ctx, route, OOD_REVIEW_SYSTEM_PROMPT, frameOodInput(action, topActions), {
			...options,
			maxTokens: 300
		}), "OOD review");
		const isKnown = parsed.is_known === true || parsed.is_known === "known";
		const confidence = Number(parsed.confidence_score);
		const risk = parsed.suggested_initial_risk_level;
		return {
			isKnown,
			confidenceScore: Number.isFinite(confidence) ? Math.min(100, Math.max(0, Math.round(confidence))) : 50,
			reasoningShort: typeof parsed.reasoning_short === "string" ? parsed.reasoning_short : "",
			suggestedInitialRiskLevel: risk === "medium" || risk === "high" ? risk : "low"
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: OOD review degraded to fallback: ${String(error)}`);
		return oodReviewFallback(mathSaysKnown);
	}
}
/** Deterministic template-3 fallback: pure frequency prior with a wide interval.
* @param positiveCount - positive history hits.
* @param negativeCount - negative history hits.
* @returns a fallback calibration output.
*/
function calibrationFallback(positiveCount, negativeCount) {
	const total = positiveCount + negativeCount;
	const base = total === 0 ? .5 : positiveCount / total;
	return {
		baseSuccessRate: base,
		riskFactors: [],
		finalConfidenceIntervalLow: Math.max(0, base - .2),
		finalConfidenceIntervalHigh: Math.min(1, base + .2),
		finalCalibratedProbability: base,
		advicePreview: total === 0 ? "无历史样本，谨慎行动" : `历史成功率${Math.round(base * 100)}%`
	};
}
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
async function calibrate(ctx, route, input, options) {
	if (!hasExplicitRoute(route)) return calibrationFallback(input.positiveCount, input.negativeCount);
	try {
		const parsed = asObject(await callJson(ctx, route, CALIBRATION_SYSTEM_PROMPT, frameCalibrationInput(input.situation, input.action, input.context, input.positiveCount, input.negativeCount, input.samples), {
			...options,
			maxTokens: 600
		}), "calibration");
		const base = Number(parsed.base_success_rate);
		const raw = Number(parsed.final_calibrated_probability);
		const low = Number(parsed.final_confidence_interval_low);
		const high = Number(parsed.final_confidence_interval_high);
		const advice = parsed.advice_preview;
		const factors = Array.isArray(parsed.risk_factors) ? parsed.risk_factors.filter((factor) => typeof factor === "string").slice(0, 5) : [];
		const fallbackBase = input.positiveCount / Math.max(1, input.positiveCount + input.negativeCount);
		return {
			baseSuccessRate: clamp01$1(Number.isFinite(base) ? base / 100 : fallbackBase),
			riskFactors: factors,
			finalConfidenceIntervalLow: clamp01$1(Number.isFinite(low) ? low / 100 : .3),
			finalConfidenceIntervalHigh: clamp01$1(Number.isFinite(high) ? high / 100 : .7),
			finalCalibratedProbability: clamp01$1(Number.isFinite(raw) ? raw / 100 : .5),
			advicePreview: typeof advice === "string" && advice.length > 0 ? advice.slice(0, 40) : "参考历史经验谨慎行动"
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: calibration degraded to fallback: ${String(error)}`);
		return calibrationFallback(input.positiveCount, input.negativeCount);
	}
}
/** Deterministic template-4 fallback: name clusters from utility means.
* @param groups - the agglomerative groups with evidence and mean utility.
* @param summaryShort - the fallback taxonomy summary.
* @returns deterministic cluster output.
*/
function reconstructFallback(groups, summaryShort) {
	return {
		newClusters: groups.map((group, index) => {
			const mean = group.meanUtility;
			return {
				clusterName: `策略簇#${index + 1}（收益${mean.materialGain.toFixed(1)}/情绪${mean.emotionalValence.toFixed(1)}/代价${mean.energyCost.toFixed(1)}）`,
				decisionRule: `if 情境特征与簇${index + 1}相似 then 沿用簇内已验证行动`,
				expectedUtilityRange: {
					low: Math.max(0, mean.materialGain - 2),
					high: Math.min(10, mean.materialGain + 2)
				},
				supportingEvidenceIds: group.evidenceIds,
				fallbackAction: "降低行动强度并观察反馈"
			};
		}),
		taxonomySummaryShort: summaryShort
	};
}
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
async function reconstructTaxonomy(ctx, route, samples, groups, summaryShort, options) {
	if (!hasExplicitRoute(route)) return reconstructFallback(groups, summaryShort);
	try {
		const parsed = asObject(await callJson(ctx, route, RECONSTRUCT_SYSTEM_PROMPT, frameReconstructInput(samples), {
			...options,
			maxTokens: 4096
		}), "reconstruction");
		const rawClusters = Array.isArray(parsed.new_clusters) ? parsed.new_clusters : [];
		const newClusters = [];
		for (const raw of rawClusters) {
			if (typeof raw !== "object" || raw === null) continue;
			const cluster = raw;
			if (typeof cluster.cluster_name !== "string" || typeof cluster.decision_rule !== "string") continue;
			const range = cluster.expected_utility_range;
			const evidence = Array.isArray(cluster.supporting_evidence_ids) ? cluster.supporting_evidence_ids.filter((id) => typeof id === "string") : [];
			const low = Number(range?.low);
			const high = Number(range?.high);
			newClusters.push({
				clusterName: cluster.cluster_name,
				decisionRule: cluster.decision_rule,
				expectedUtilityRange: {
					low: Number.isFinite(low) ? Math.min(10, Math.max(0, low)) : 0,
					high: Number.isFinite(high) ? Math.min(10, Math.max(0, high)) : 10
				},
				supportingEvidenceIds: evidence,
				fallbackAction: typeof cluster.fallback_action === "string" ? cluster.fallback_action : "降低行动强度并观察反馈"
			});
		}
		const summary = parsed.taxonomy_summary_short;
		return {
			newClusters,
			taxonomySummaryShort: typeof summary === "string" && summary.length > 0 ? summary.slice(0, 60) : summaryShort
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: taxonomy reconstruction degraded to fallback: ${String(error)}`);
		return reconstructFallback(groups, summaryShort);
	}
}
/** Deterministic template-5 fallback: reject accumulation (no route → no gate). */
function accumulationFallback() {
	return {
		shouldAccumulate: false,
		sar: null
	};
}
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
async function evaluateAccumulation(ctx, route, episode, similar, options) {
	if (!hasExplicitRoute(route)) return accumulationFallback();
	try {
		const parsed = asObject(await callJson(ctx, route, ACCUMULATE_SYSTEM_PROMPT, frameAccumulateInput(episode, similar), {
			...options,
			maxTokens: 500
		}), "accumulation");
		if (!(parsed.should_accumulate === true)) return {
			shouldAccumulate: false,
			sar: null
		};
		const situation = parsed.situation;
		const action = parsed.action;
		const outcome = parsed.outcome;
		const materialGain = Number(parsed.material_gain);
		const emotionalValence = Number(parsed.emotional_valence);
		const energyCost = Number(parsed.energy_cost);
		if (typeof situation !== "string" || typeof action !== "string" || typeof outcome !== "string" || !Number.isFinite(materialGain) || !Number.isFinite(emotionalValence) || !Number.isFinite(energyCost)) throw new CognitivePipelineError("cognitive-pipeline: accumulation output missing SAR fields", "ACCUMULATE_SCHEMA_FAILED");
		return {
			shouldAccumulate: true,
			sar: {
				situation,
				action,
				outcome,
				utility: {
					materialGain: clampUtility(materialGain),
					emotionalValence: clampUtility(emotionalValence),
					energyCost: clampUtility(energyCost)
				}
			}
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: accumulation gate degraded to fallback: ${String(error)}`);
		return accumulationFallback();
	}
}
/** Deterministic template-6 fallback: reject derivation (no route → no reference). */
function deriveReferenceFallback() {
	return {
		shouldDerive: false,
		sar: null
	};
}
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
async function deriveReference(ctx, route, query, similar, options) {
	if (!hasExplicitRoute(route)) return deriveReferenceFallback();
	try {
		const parsed = asObject(await callJson(ctx, route, DERIVE_REFERENCE_SYSTEM_PROMPT, frameDeriveReferenceInput(query, similar), {
			...options,
			maxTokens: 500
		}), "derive-reference");
		if (!(parsed.should_derive === true)) return deriveReferenceFallback();
		const situation = parsed.situation;
		const action = parsed.action;
		const outcome = parsed.outcome;
		const materialGain = Number(parsed.material_gain);
		const emotionalValence = Number(parsed.emotional_valence);
		const energyCost = Number(parsed.energy_cost);
		if (typeof situation !== "string" || typeof action !== "string" || typeof outcome !== "string" || !Number.isFinite(materialGain) || !Number.isFinite(emotionalValence) || !Number.isFinite(energyCost)) throw new CognitivePipelineError("cognitive-pipeline: derive-reference output missing SAR fields", "DERIVE_REFERENCE_SCHEMA_FAILED");
		return {
			shouldDerive: true,
			sar: {
				situation,
				action,
				outcome,
				utility: {
					materialGain: clampUtility(materialGain),
					emotionalValence: clampUtility(emotionalValence),
					energyCost: clampUtility(energyCost)
				}
			}
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: derive-reference degraded to fallback: ${String(error)}`);
		return deriveReferenceFallback();
	}
}
/** Deterministic template-7 fallback: keep the fused ranking untouched. */
function refineRetrievalFallback() {
	return {
		shouldKeep: true,
		rejectedExpId: null,
		reason: null
	};
}
/**
* Template 7: refine retrieval when the deterministic routing is
* low-confidence. The LLM route reads the query and the fused candidates and
* judges whether the fused top hit genuinely applies (cosine similarity does
* not imply premise transferability); without a route it keeps the ranking.
* @param ctx - plugin context for the LLM call.
* @param route - explicit model route.
* @param query - the current situation/action being predicted.
* @param candidates - the fused candidates, best first.
* @param options - call context (session/signal/maxTokens).
* @returns the refinement decision.
*/
async function refineRetrieval(ctx, route, query, candidates, options) {
	if (!hasExplicitRoute(route)) return refineRetrievalFallback();
	try {
		const parsed = asObject(await callJson(ctx, route, REFINE_RETRIEVAL_SYSTEM_PROMPT, frameRefineRetrievalInput(query, candidates), {
			...options,
			maxTokens: 400
		}), "refine-retrieval");
		if (parsed.should_keep !== false) return refineRetrievalFallback();
		const rejectedExpId = parsed.rejected_exp_id;
		const reason = parsed.reason;
		if (typeof rejectedExpId !== "string" || rejectedExpId.length === 0) throw new CognitivePipelineError("cognitive-pipeline: refine-retrieval rejected without an expId", "REFINE_RETRIEVAL_SCHEMA_FAILED");
		return {
			shouldKeep: false,
			rejectedExpId,
			reason: typeof reason === "string" && reason.length > 0 ? reason : null
		};
	} catch (error) {
		ctx.logger.warn(`cognitive-pipeline: refine-retrieval degraded to fallback: ${String(error)}`);
		return refineRetrievalFallback();
	}
}
//#endregion
//#region lib/types/cold-engine.js
/**
* Cold-loop engine: offline taxonomy reconstruction. Samples decay-weighted
* high-error experiences, clusters them in utility space, anchors clusters
* with LLM causal evidence (hard-constrained), backtests the proposal on the
* newest slice, and atomically writes back only on a ≥15% error reduction.
* @module @deepseek-ai/dsh-cognitive-pipeline/cold-engine
*/
/** Mean of outcome utilities. */
function meanUtility(items) {
	if (items.length === 0) return {
		materialGain: 5,
		emotionalValence: 5,
		energyCost: 5
	};
	let materialGain = 0;
	let emotionalValence = 0;
	let energyCost = 0;
	for (const item of items) {
		materialGain += item.sar.outcomeUtility.materialGain;
		emotionalValence += item.sar.outcomeUtility.emotionalValence;
		energyCost += item.sar.outcomeUtility.energyCost;
	}
	return {
		materialGain: materialGain / items.length,
		emotionalValence: emotionalValence / items.length,
		energyCost: energyCost / items.length
	};
}
/** Composite mean utility score (gains + valence − cost). */
function meanUtilityScore(utility) {
	return utilityScore(utility);
}
/** Centroid of outcome vectors, re-normalized. */
function centroidOf$1(vectors) {
	const dim = vectors[0]?.length ?? 0;
	const sum = new Array(dim).fill(0);
	for (const vector of vectors) for (let index = 0; index < dim; index += 1) sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0);
	if (vectors.length === 0) return sum;
	const mean = sum.map((value) => value / vectors.length);
	let norm = 0;
	for (const value of mean) norm += value * value;
	norm = Math.sqrt(norm);
	return norm < 1e-9 ? mean : mean.map((value) => value / norm);
}
/** Agglomerative clustering on outcome vectors (centroid linkage). */
function agglomerate(vectors, mergeCosine) {
	const clusters = vectors.map((vector) => ({
		memberIndices: [0],
		centroid: [...vector],
		meanUtility: {
			materialGain: 5,
			emotionalValence: 5,
			energyCost: 5
		}
	}));
	const membersOf = vectors.map((_, index) => [index]);
	for (;;) {
		let bestI = -1;
		let bestJ = -1;
		let bestScore = mergeCosine;
		for (let i = 0; i < clusters.length; i += 1) for (let j = i + 1; j < clusters.length; j += 1) {
			const score = cosine(clusters[i]?.centroid ?? [], clusters[j]?.centroid ?? []);
			if (score >= bestScore) {
				bestScore = score;
				bestI = i;
				bestJ = j;
			}
		}
		if (bestI < 0 || bestJ < 0) break;
		const aMembers = membersOf[bestI] ?? [];
		const bMembers = membersOf[bestJ] ?? [];
		const mergedMembers = [...aMembers, ...bMembers];
		const merged = {
			memberIndices: mergedMembers,
			centroid: centroidOf$1(mergedMembers.map((index) => vectors[index]).filter((vector) => vector !== void 0)),
			meanUtility: {
				materialGain: 5,
				emotionalValence: 5,
				energyCost: 5
			}
		};
		clusters.splice(bestJ, 1);
		clusters.splice(bestI, 1, merged);
		membersOf.splice(bestJ, 1);
		membersOf.splice(bestI, 1, mergedMembers);
	}
	return clusters.map((cluster, index) => ({
		memberIndices: membersOf[index] ?? cluster.memberIndices,
		centroid: cluster.centroid,
		meanUtility: cluster.meanUtility
	}));
}
/** Verify the evidence hard constraint for one candidate cluster. */
function verifyEvidence(candidate, byId, minCount, maxDistance) {
	if (candidate.evidenceIds.length < minCount) return {
		ok: false,
		reason: `证据不足（${candidate.evidenceIds.length} < ${minCount}）`
	};
	const evidence = candidate.evidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
	if (evidence.length !== candidate.evidenceIds.length) return {
		ok: false,
		reason: "支撑证据包含不存在的exp_id（幻觉因果）"
	};
	let maxDistanceSeen = 0;
	for (let i = 0; i < evidence.length; i += 1) for (let j = i + 1; j < evidence.length; j += 1) {
		const distance = 1 - cosine(evidence[i].outcomeVector, evidence[j].outcomeVector);
		maxDistanceSeen = Math.max(maxDistanceSeen, distance);
	}
	if (maxDistanceSeen > maxDistance) return {
		ok: false,
		reason: `证据间最大余弦距离 ${maxDistanceSeen.toFixed(3)} 超过阈值 ${maxDistance}`
	};
	return {
		ok: true,
		reason: "verified"
	};
}
/**
* Cold-loop engine. `runRebuild` is the offline entry point; it never throws
* for domain reasons — every outcome is a {@link RebuildResult}.
*/
var ColdEngine = class {
	ctx;
	store;
	config;
	route;
	constructor(ctx, store, config, route) {
		this.ctx = ctx;
		this.store = store;
		this.config = config;
		this.route = route;
	}
	/**
	* Run one rebuild. `local` restricts sampling to the highest-error cluster;
	* `global` samples the whole store.
	* @param scope - the rebuild scope.
	* @param sessionId - optional session identity for the reconstruction call.
	* @param signal - optional cancellation for the reconstruction call.
	* @returns the backtested rebuild outcome; never rejects for domain reasons.
	*/
	async runRebuild(scope, sessionId, signal) {
		const all = this.store.experiencesSnapshot();
		if (all.length === 0) return this.rejected(scope, [], 0, "无经验样本，跳过重构");
		const sampled = this.sample(all, scope);
		if (sampled.length < this.config.evidenceMinCount) return this.rejected(scope, sampled, 0, "采样样本不足，跳过重构");
		const metaSamples = sampled.filter((exp) => exp.meta === true);
		const nonMeta = sampled.filter((exp) => exp.meta !== true);
		const validationSize = Math.max(1, Math.floor(nonMeta.length * this.config.validationRatio));
		const validation = nonMeta.slice(nonMeta.length - validationSize);
		const train = [...nonMeta.slice(0, nonMeta.length - validationSize), ...metaSamples].sort((a, b) => a.timestamp - b.timestamp);
		const labeledValidation = validation.filter((exp) => Number.isFinite(exp.sar.outcomeUtility.materialGain)).length;
		if (labeledValidation < this.config.minValidationCount) return this.deferred(scope, sampled, labeledValidation);
		const groups = agglomerate(train.map((exp) => exp.outcomeVector), this.config.clusterMergeCosine).filter((group) => group.memberIndices.length >= this.config.evidenceMinCount);
		const groupsWithUtility = groups.map((group) => {
			const members = group.memberIndices.map((index) => train[index]).filter((exp) => exp !== void 0);
			return {
				evidenceIds: members.map((exp) => exp.expId),
				meanUtility: meanUtility(members)
			};
		});
		const summaryShort = this.composeGroupSummary(groups.length, groupsWithUtility);
		const byId = new Map(all.map((exp) => [exp.expId, exp]));
		let finalCandidates = [];
		let rejectedClusters = 0;
		let modelSummaryShort = "";
		const retries = this.config.reconstructRetries;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			const reconstruct = await reconstructTaxonomy(this.ctx, this.route, train, groupsWithUtility, summaryShort, {
				sessionId,
				signal
			});
			const candidates = reconstruct.newClusters.map((cluster) => {
				const evidence = cluster.supportingEvidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
				const mean = meanUtility(evidence);
				return {
					name: cluster.clusterName,
					decisionRule: cluster.decisionRule,
					expectedUtilityRange: cluster.expectedUtilityRange,
					evidenceIds: cluster.supportingEvidenceIds,
					fallbackAction: cluster.fallbackAction,
					centroid: centroidOf$1(evidence.map((exp) => exp.outcomeVector)),
					meanUtility: mean,
					polarity: meanUtilityScore(mean) > 0 ? "success" : "risk"
				};
			});
			const verified = [];
			for (const candidate of candidates) {
				const check = verifyEvidence(candidate, byId, this.config.evidenceMinCount, this.config.evidenceMaxDistance);
				if (!check.ok) {
					rejectedClusters += 1;
					this.ctx.logger.warn(`cognitive-pipeline: 簇 "${candidate.name}" 被证据校验驳回：${check.reason}`);
					continue;
				}
				verified.push(candidate);
			}
			if (verified.length > 0 || attempt === retries) {
				finalCandidates = verified;
				modelSummaryShort = reconstruct.taxonomySummaryShort;
				if (reconstruct.newClusters.length === 0 && groupsWithUtility.length > 0) this.ctx.logger.warn("cognitive-pipeline: 重构返回0个簇，将本轮样本标记为极端异常以提升下轮采样权重");
				break;
			}
			this.ctx.logger.warn(`cognitive-pipeline: 重构抽样产出不可用（${rejectedClusters} 个候选簇均未通过证据校验），第 ${attempt + 2} 次尝试`);
		}
		if (finalCandidates.length === 0 && groupsWithUtility.length > 0) for (const candidate of this.fallbackCandidates(groupsWithUtility, byId)) {
			const check = verifyEvidence(candidate, byId, this.config.evidenceMinCount, this.config.evidenceMaxDistance);
			if (check.ok) finalCandidates = [...finalCandidates, candidate];
			else {
				rejectedClusters += 1;
				this.ctx.logger.warn(`cognitive-pipeline: 回退簇 "${candidate.name}" 被证据校验驳回：${check.reason}`);
			}
		}
		const oldViews = this.clusterViews(all, this.store.clustersSnapshot());
		const newViews = finalCandidates.map((candidate) => ({
			centroid: candidate.centroid,
			meanUtility: candidate.meanUtility
		}));
		const oldError = this.evaluateViews(all, train, validation, oldViews);
		const newError = this.evaluateViews(all, train, validation, newViews);
		const firstBuild = this.store.clustersSnapshot().length === 0;
		const requiredImprovement = firstBuild ? 0 : this.config.sandboxImprovement;
		const referenceError = oldError ?? this.evaluateViews(all, train, validation, []);
		const deltaError = referenceError === null || referenceError <= 1e-9 || newError === null ? null : (newError - referenceError) / referenceError;
		const accepted = finalCandidates.length > 0 && newError !== null && (referenceError === null ? false : referenceError <= 1e-9 ? false : deltaError !== null && deltaError <= -requiredImprovement);
		const taxonomyVersion = (this.store.taxonomySnapshot()?.version ?? 0) + (accepted ? 1 : 0);
		const reason = finalCandidates.length === 0 ? `证据校验未通过：${rejectedClusters} 个候选簇均未满足证据约束（≥${this.config.evidenceMinCount}条真实经验、两两距离≤${this.config.evidenceMaxDistance}），无可写回簇` : accepted ? firstBuild ? `沙盒验证通过：新误差 ${newError.toFixed(3)} ≤ 基线 ${referenceError?.toFixed(3) ?? "—"}（冷启动，不差于纯基线预测）` : `沙盒验证通过：新误差 ${newError.toFixed(3)} ≤ 旧误差 ${referenceError?.toFixed(3) ?? "—"} × ${(1 - this.config.sandboxImprovement).toFixed(2)}` : deltaError === null ? referenceError !== null && referenceError <= 1e-9 ? firstBuild ? "基线预测已接近完美（验证误差≈0），暂不写入簇" : "旧分类已接近完美（验证误差≈0），无需进一步重构" : "无旧分类基线，跳过回写" : firstBuild ? `冷启动验收未达标：新误差 ${newError?.toFixed(3) ?? "—"} vs 基线 ${referenceError?.toFixed(3) ?? "—"}（不得变差）` : `沙盒验证未达标：新误差 ${newError?.toFixed(3) ?? "—"} vs 旧误差 ${referenceError?.toFixed(3) ?? "—"}（需降低≥${Math.round(this.config.sandboxImprovement * 100)}%）`;
		if (accepted) {
			this.writeBack(finalCandidates, taxonomyVersion, all, modelSummaryShort);
			return {
				scope,
				accepted: true,
				deferred: false,
				oldError,
				newError,
				deltaError,
				clusterCount: finalCandidates.length,
				rejectedClusters,
				sampleCount: sampled.length,
				reason,
				taxonomyVersion
			};
		}
		if (validation.length > 0) {
			const predicted = this.predictionsFor(train, newViews, validation);
			validation.forEach((exp, index) => {
				if (!Number.isFinite(exp.sar.outcomeUtility.materialGain)) return;
				const actual = exp.sar.outcomeUtility.materialGain / 10;
				const error = Math.abs((predicted[index] ?? .5) - actual);
				if (error >= this.config.predictionErrorThreshold) this.store.updateExperience(exp.expId, { cumulativeError: exp.cumulativeError + error });
			});
		}
		return {
			scope,
			accepted: false,
			deferred: false,
			oldError,
			newError,
			deltaError,
			clusterCount: 0,
			rejectedClusters,
			sampleCount: sampled.length,
			reason,
			taxonomyVersion
		};
	}
	/** Short-circuit rejection result. */
	rejected(scope, sampled, rejectedClusters, reason) {
		return {
			scope,
			accepted: false,
			deferred: false,
			oldError: null,
			newError: null,
			deltaError: null,
			clusterCount: 0,
			rejectedClusters,
			sampleCount: sampled.length,
			reason,
			taxonomyVersion: this.store.taxonomySnapshot()?.version ?? 0
		};
	}
	/** Short-circuit deferral result: insufficient labeled validation samples. */
	deferred(scope, sampled, labeledValidation) {
		return {
			scope,
			accepted: false,
			deferred: true,
			oldError: null,
			newError: null,
			deltaError: null,
			clusterCount: 0,
			rejectedClusters: 0,
			sampleCount: sampled.length,
			reason: `验证样本不足（带标签 ${labeledValidation} 条 < ${this.config.minValidationCount}），暂缓重建`,
			taxonomyVersion: this.store.taxonomySnapshot()?.version ?? 0
		};
	}
	/** Decay-weighted, error-preferring sample selection (≤ maxSampleRatio).
	* A candidate joins when it is errorful (high prediction error or any
	* accumulated error) OR carries a clearly successful utility score — so the
	* cold loop learns from proven successes, not only from failures. Pipeline-own
	* meta experiences with a non-neutral utility also join (their error signal
	* has no user-feedback channel), so the cold loop can learn about the
	* pipeline's own failure modes (e.g. retrieval-routing ambiguity).
	*/
	sample(all, scope) {
		const now = Date.now();
		const day = 1440 * 60 * 1e3;
		const candidates = all.filter((exp) => {
			if (exp.simulated && exp.verification === "unverified") return false;
			const days = Math.max(0, (now - exp.timestamp) / day);
			if (Math.exp(-this.config.decayLambda * days) < this.config.minDecayWeight) return false;
			const errorful = (exp.predictionError ?? 0) >= this.config.predictionErrorThreshold || exp.cumulativeError > 0;
			const successful = utilityScore(exp.sar.outcomeUtility) >= this.config.successUtilityThreshold;
			const metaSignal = exp.meta === true && outcomePolarity(exp.sar.outcomeUtility) !== "neutral";
			return errorful || successful || metaSignal;
		});
		if (scope === "local") {
			const clusters = this.store.clustersSnapshot();
			let worst;
			for (const cluster of clusters) if (worst === void 0 || cluster.cumPredictionError > worst.cumPredictionError) worst = cluster;
			if (worst !== void 0) {
				const memberIds = new Set(worst.supportingEvidenceIds);
				const members = candidates.filter((exp) => memberIds.has(exp.expId));
				if (members.length >= this.config.evidenceMinCount) return this.cap(members, all.length).sort((a, b) => a.timestamp - b.timestamp);
			}
		}
		return this.cap(candidates, all.length).sort((a, b) => a.timestamp - b.timestamp);
	}
	/**
	* Keep at most maxSampleRatio of the total population, error-first, with a
	* small-store floor so a rebuild stays possible before a store reaches
	* production scale (the ratio cap targets the 10万-record regime).
	*/
	cap(candidates, total) {
		const budget = Math.min(total, Math.max(32, Math.floor(total * this.config.maxSampleRatio)));
		const kept = [...candidates].sort((a, b) => b.cumulativeError + (b.predictionError ?? 0) - (a.cumulativeError + (a.predictionError ?? 0))).slice(0, budget);
		const meta = candidates.filter((exp) => exp.meta === true && !kept.includes(exp));
		return meta.length === 0 ? kept : [...kept, ...meta];
	}
	/** Deterministic candidate clusters from the agglomerative groups. */
	fallbackCandidates(groups, byId) {
		return groups.map((group, index) => {
			const evidence = group.evidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
			const mean = group.meanUtility;
			return {
				name: `策略簇#${index + 1}（收益${mean.materialGain.toFixed(1)}/情绪${mean.emotionalValence.toFixed(1)}/代价${mean.energyCost.toFixed(1)}）`,
				decisionRule: `if 情境特征与簇${index + 1}相似 then 沿用簇内已验证行动`,
				expectedUtilityRange: {
					low: Math.max(0, mean.materialGain - 2),
					high: Math.min(10, mean.materialGain + 2)
				},
				evidenceIds: group.evidenceIds,
				fallbackAction: "降低行动强度并观察反馈",
				centroid: centroidOf$1(evidence.map((exp) => exp.outcomeVector)),
				meanUtility: mean,
				polarity: meanUtilityScore(mean) > 0 ? "success" : "risk"
			};
		});
	}
	/** ≤30-char summary of the rebuild's logical change from group statistics. */
	composeGroupSummary(groupCount, groups) {
		const tones = groups.map((group) => {
			const score = meanUtilityScore(group.meanUtility);
			if (score > 0) return "正效";
			if (score < 0) return "负效";
			return "中性";
		});
		return `重组为${groupCount}簇（${tones.length === 0 ? "无" : tones.slice(0, 3).join("/")}…）`;
	}
	/** Build normalized views for the stored cluster table. */
	clusterViews(all, clusters) {
		const byId = new Map(all.map((exp) => [exp.expId, exp]));
		const views = [];
		for (const cluster of clusters) {
			const evidence = cluster.supportingEvidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
			if (evidence.length === 0) continue;
			views.push({
				centroid: centroidOf$1(evidence.map((exp) => exp.outcomeVector)),
				meanUtility: meanUtility(evidence)
			});
		}
		return views;
	}
	/** Predict the continuous material-gain label (normalized to [0,1]) for each
	* validation experience under a taxonomy. The prediction is the mean
	* material gain of the nearest cluster; unmatched experiences fall back to
	* the training base-rate gain. This aligns the acceptance metric with the
	* pipeline's first-principle error `|calibrated − observed|` — it measures
	* whether the taxonomy predicts utility, not just which polarity bucket an
	* experience lands in.
	*/
	predictionsFor(train, taxonomy, validation) {
		const baseRate = train.length === 0 ? .5 : train.reduce((sum, exp) => sum + exp.sar.outcomeUtility.materialGain, 0) / train.length / 10;
		return validation.map((exp) => {
			let best = -1;
			let bestScore = this.config.clusterMatchCosine;
			for (const view of taxonomy) {
				const score = cosine(exp.outcomeVector, view.centroid);
				if (score >= bestScore) {
					bestScore = score;
					best = view.meanUtility.materialGain / 10;
				}
			}
			return best < 0 ? baseRate : best;
		});
	}
	/** Mean absolute error of a taxonomy over the validation slice, on the
	* continuous material-gain axis. Every experience with a recorded gain
	* participates (resolved experiences carry a real label after the
	* feedback-backfill), so "predicted wrong but quality known" samples are no
	* longer excluded from the acceptance judgment.
	*/
	evaluateViews(all, train, validation, taxonomy) {
		const labeled = validation.filter((exp) => Number.isFinite(exp.sar.outcomeUtility.materialGain));
		if (labeled.length === 0) return null;
		const predicted = this.predictionsFor(train, taxonomy, validation);
		let error = 0;
		for (let index = 0; index < validation.length; index += 1) {
			const exp = validation[index];
			if (!Number.isFinite(exp.sar.outcomeUtility.materialGain)) continue;
			const actual = exp.sar.outcomeUtility.materialGain / 10;
			error += Math.abs((predicted[index] ?? .5) - actual);
		}
		return error / labeled.length;
	}
	/** Apply the accepted taxonomy: new clusters, assignments, summary, rules. */
	writeBack(candidates, taxonomyVersion, all, modelSummaryShort) {
		const now = Date.now();
		const assignments = /* @__PURE__ */ new Map();
		const clusters = [];
		const byId = new Map(all.map((exp) => [exp.expId, exp]));
		for (const candidate of candidates) {
			const clusterId = this.store.nextClusterId();
			const members = all.filter((exp) => cosine(exp.outcomeVector, candidate.centroid) >= this.config.clusterMatchCosine);
			if (members.length === 0) continue;
			let cumError = 0;
			for (const member of members) {
				cumError += member.cumulativeError + (member.predictionError ?? 0);
				assignments.set(member.expId, {
					clusterId,
					strategyLabel: candidate.name
				});
			}
			const evidence = candidate.evidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
			clusters.push({
				clusterId,
				name: candidate.name,
				decisionRule: candidate.decisionRule,
				expectedUtilityRange: { ...candidate.expectedUtilityRange },
				supportingEvidenceIds: [...candidate.evidenceIds],
				fallbackAction: candidate.fallbackAction,
				createdAt: now,
				origin: "cold-loop",
				sampleCount: members.length,
				cumPredictionError: cumError,
				polarity: candidate.polarity,
				situationCentroid: centroidOf$1(evidence.map((exp) => actionVector(exp.sar.situation, [])))
			});
		}
		for (const strategy of this.store.tempStrategiesSnapshot()) {
			if (strategy.status !== "graduated") continue;
			const index = this.nearestClusterIndex(strategy, clusters, byId);
			if (index < 0) continue;
			clusters[index] = {
				...clusters[index],
				decisionRule: `if 情境与「${strategy.trialAction}」相似 then 沿用该试行策略`
			};
		}
		const rules = [...clusters].sort((a, b) => b.sampleCount - a.sampleCount).slice(0, 5).map((cluster) => ({
			condition: cluster.name,
			action: cluster.decisionRule,
			utilityRange: { ...cluster.expectedUtilityRange },
			polarity: cluster.polarity
		}));
		const taxonomy = {
			version: taxonomyVersion,
			summaryShort: modelSummaryShort.trim().length > 0 ? modelSummaryShort.slice(0, 60) : this.composeVersionSummary(taxonomyVersion, clusters),
			rules,
			updatedAt: now
		};
		this.store.applyTaxonomy(clusters, taxonomy, assignments);
	}
	/** Index of the graduated strategy's nearest verified cluster, or -1. */
	nearestClusterIndex(strategy, clusters, byId) {
		if (strategy.trialAction.length === 0) return -1;
		const source = strategy.sourceExpId === null ? null : byId.get(strategy.sourceExpId) ?? null;
		const strategyVector = outcomeVector(source === null ? {
			materialGain: 6,
			emotionalValence: 6,
			energyCost: 5
		} : source.sar.outcomeUtility, strategy.trialAction);
		let bestIndex = -1;
		let bestScore = this.config.clusterMatchCosine;
		for (let index = 0; index < clusters.length; index += 1) {
			const evidence = clusters[index].supportingEvidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
			if (evidence.length === 0) continue;
			const score = cosine(strategyVector, centroidOf$1(evidence.map((exp) => exp.outcomeVector)));
			if (score >= bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
		return bestIndex;
	}
	/** Compose the one-sentence taxonomy summary for the prompt prefix. */
	composeVersionSummary(version, clusters) {
		const names = clusters.slice(0, 3).map((cluster) => cluster.name);
		return `v${version}:${(names.length === 0 ? "无有效策略簇" : names.join("；")).slice(0, 30)}`;
	}
};
//#endregion
//#region lib/types/hot-engine.js
/**
* Hot-loop engine: online prediction with OOD detection, branch routing
* (familiar path vs novel path), and the five-layer confidence calibration.
* All math is synchronous and fast; the only awaits are the best-effort LLM
* assists (SAR-independent: OOD review and calibration).
* @module @deepseek-ai/dsh-cognitive-pipeline/hot-engine
*/
/** Default semantic scorer: hashed bag-of-words cosine over the action text. */
var HashSemanticScorer = class {
	score(queryText, exp) {
		return cosine(actionVector(queryText, []), exp.actionVector);
	}
};
/** Mean and variance of the top-K similarity set. */
function similarityStats(scores) {
	if (scores.length === 0) return {
		mean: 0,
		variance: 0
	};
	const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
	return {
		mean,
		variance: scores.reduce((sum, score) => sum + (score - mean) * (score - mean), 0) / scores.length
	};
}
/** Clamp a probability into [0, 1]. */
function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}
/**
* Widen an interval symmetrically until it reaches the minimum width. This is
* computed arithmetically (no loop) so floating-point underflow can never
* stall it: when one side is pinned by the [0,1] clamp, the free side takes
* all remaining slack.
*/
function widenInterval(low, high, minWidth) {
	const lo = low;
	const hi = high;
	const width = hi - lo;
	if (width >= minWidth) return {
		low: lo,
		high: hi
	};
	const missing = minWidth - width;
	const lower = clamp01(lo - missing / 2);
	const upper = clamp01(hi + missing / 2);
	if (lo - lower + (upper - hi) >= missing - 1e-12) return {
		low: lower,
		high: upper
	};
	if (lower === 0 && upper < 1) return {
		low: 0,
		high: Math.min(1, minWidth)
	};
	if (upper === 1 && lower > 0) return {
		low: Math.max(0, 1 - minWidth),
		high: 1
	};
	return {
		low: 0,
		high: 1
	};
}
/**
* Hot-loop engine. Constructed once per service; `predict` is the online
* entry point.
*/
var HotEngine = class {
	ctx;
	store;
	config;
	route;
	scorer;
	constructor(ctx, store, config, route, scorer = new HashSemanticScorer()) {
		this.ctx = ctx;
		this.store = store;
		this.config = config;
		this.route = route;
		this.scorer = scorer;
	}
	/** Whether the query text itself carries any failure symptom marker. */
	queryHasFailureMarker(queryText) {
		const lower = queryText.toLowerCase();
		return SYMPTOM_MARKERS.some((marker) => lower.includes(marker));
	}
	/** Per-channel contributions (w_c · s_c) of one experience for one query, in
	* [semantic, situational, symptom, outcome] order.
	* @param exp - the candidate experience.
	* @param queryAction - the query action text.
	* @param querySituation - the query situation text.
	* @param situationVector - the precomputed query situation vector (null when the situation is empty).
	* @param queryText - action + situation, used for symptom/outcome channels.
	* @param weights - the current learned channel weights.
	* @returns the four weighted contributions.
	*/
	channelContributions(exp, queryAction, situationVector, queryText, weights) {
		const semantic = this.scorer.score(queryAction, exp);
		const situational = situationVector === null ? 0 : cosine(situationVector, actionVector(exp.sar.situation, []));
		const symptom = symptomOverlap(queryText, `${exp.sar.situation}。${exp.sar.action}。${exp.sar.outcome}`);
		const outcome = this.queryHasFailureMarker(queryText) && outcomePolarity(exp.sar.outcomeUtility) === "negative" ? 1 : 0;
		return [
			weights.semantic * semantic,
			weights.situational * situational,
			weights.symptom * symptom,
			weights.outcome * outcome
		];
	}
	/** Retrieve the top-K experiences by fused multi-channel similarity. The
	* semantic channel alone decides the classic similarity reported downstream;
	* the situational/symptom/outcome channels participate only in the ranking.
	* @param action - the proposed action text.
	* @param k - how many hits to return.
	* @param situation - the situation text, feeding the situational channel.
	* @returns ranked hits, best first.
	*/
	retrieveTopK(action, k, situation = "") {
		const weights = this.store.channelWeightsSnapshot();
		const situationVector = situation.trim().length > 0 ? actionVector(situation, []) : null;
		const queryText = `${action} ${situation}`.trim();
		return this.store.experiencesSnapshot().map((exp) => {
			const channels = this.channelContributions(exp, action, situationVector, queryText, weights);
			return {
				exp,
				similarity: channels[0] === void 0 ? 0 : channels[0] / weights.semantic,
				fused: channels.reduce((sum, value) => sum + value, 0),
				channels
			};
		}).sort((a, b) => b.fused - a.fused).slice(0, k).map((hit) => ({
			exp: hit.exp,
			similarity: hit.similarity,
			fused: hit.fused,
			channels: hit.channels
		}));
	}
	/** Detect OOD signals from the top-K similarity set.
	* @param ranked - the retrieved hits, best first.
	* @returns the strongest signal and the top-1 similarity.
	*/
	detectOod(ranked) {
		const top1 = ranked[0]?.similarity ?? 0;
		if (ranked.length === 0) return {
			signal: "low-similarity",
			top1
		};
		const scores = ranked.map((hit) => hit.similarity);
		const spread = scores.length >= 3 ? (scores[0] ?? 0) - (scores[2] ?? 0) : 0;
		const { mean, variance } = similarityStats(scores);
		const strangeness = variance / (mean + 1e-9);
		if (top1 < this.config.oodSimThreshold) return {
			signal: "low-similarity",
			top1
		};
		if (spread < this.config.oodFlatThreshold && top1 < .85) return {
			signal: "flat-top",
			top1
		};
		if (strangeness > this.config.oodSiThreshold) return {
			signal: "high-strangeness",
			top1
		};
		return {
			signal: "none",
			top1
		};
	}
	/**
	* Run one hot-loop prediction.
	* @param input - the situation/action to predict.
	* @param sessionId - optional session identity for LLM-assisted calls.
	* @param signal - optional cancellation for LLM-assisted calls.
	* @returns the calibrated prediction result.
	*/
	async predict(input, sessionId, signal) {
		const ranked = this.retrieveTopK(input.action, this.config.topK, input.situation);
		const { signal: oodSignal, top1 } = this.detectOod(ranked);
		const taxonomyContext = this.taxonomyContext(input.situation);
		const { note: refineNote, ranked: refined } = await this.refineRetrieval(input, ranked, oodSignal, taxonomyContext, sessionId, signal);
		const samples = refined.map((hit) => hit.exp);
		const topChannels = refined[0] === void 0 ? null : refined[0].channels;
		let isNovel = oodSignal !== "none";
		if (oodSignal !== "none" && ranked.length > 0) isNovel = !(await reviewOod(this.ctx, this.route, input.action, ranked.slice(0, 3).map((hit) => ({
			expId: hit.exp.expId,
			action: hit.exp.sar.action,
			similarity: hit.similarity
		})), !isNovel, {
			sessionId,
			signal
		})).isKnown;
		const successReference = this.matchSuccessReference(input.situation);
		const adviceSuffix = this.taxonomyAdviceLine(taxonomyContext);
		if (isNovel) return this.predictNovel(input, sessionId, signal, oodSignal, top1, successReference, taxonomyContext, adviceSuffix, refineNote);
		return this.predictKnown(input, samples, topChannels, sessionId, signal, oodSignal, top1, successReference, taxonomyContext, adviceSuffix, refineNote);
	}
	/**
	* LLM-refine the fused ranking when the deterministic routing is
	* low-confidence (thin taxonomy margin or flat-top OOD). The template-7
	* route judges whether the fused top hit genuinely applies; each rejection
	* removes that experience and re-ranks the survivors, bounded by
	* `refineMaxDrops`. Without a route (or when the route keeps the ranking)
	* the original ranking is returned untouched.
	* @param input - the query situation/action.
	* @param ranked - the fused ranking, best first.
	* @param oodSignal - the OOD signal from the original ranking.
	* @param taxonomyContext - the query's taxonomy routing.
	* @param sessionId - optional session identity for the LLM call.
	* @param signal - optional cancellation.
	* @returns the refinement note (null when nothing was dropped) and the refined ranking.
	*/
	async refineRetrieval(input, ranked, oodSignal, taxonomyContext, sessionId, signal) {
		if (!(taxonomyContext.coverage === "covered" && taxonomyContext.margin < this.config.retrievalFailureMargin || oodSignal === "flat-top") || ranked.length === 0) return {
			note: null,
			ranked: [...ranked]
		};
		const remaining = new Set(ranked.map((hit) => hit.exp.expId));
		const reasons = [];
		let dropped = 0;
		for (let attempt = 0; attempt < this.config.refineMaxDrops; attempt += 1) {
			const candidates = ranked.filter((hit) => remaining.has(hit.exp.expId)).slice(0, 3);
			if (candidates.length === 0) break;
			const decision = await refineRetrieval(this.ctx, this.route, {
				situation: input.situation,
				action: input.action
			}, candidates.map((hit) => ({
				expId: hit.exp.expId,
				text: `${hit.exp.sar.situation}。${hit.exp.sar.action}。${hit.exp.sar.outcome}`,
				similarity: hit.similarity
			})), {
				sessionId,
				signal
			});
			if (decision.shouldKeep || decision.rejectedExpId === null) break;
			if (!remaining.has(decision.rejectedExpId)) break;
			remaining.delete(decision.rejectedExpId);
			dropped += 1;
			if (decision.reason !== null && decision.reason.length > 0) reasons.push(decision.reason);
		}
		if (dropped === 0) return {
			note: null,
			ranked: [...ranked]
		};
		return {
			note: ` | 检索复核：LLM 判定 Top1 不适用，已剔除 ${dropped} 条候选（${reasons.join("；") || "前提或情境不可迁移"}）`,
			ranked: ranked.filter((hit) => remaining.has(hit.exp.expId))
		};
	}
	/**
	* Feedback-driven channel-weight learning (第一性原理 |calibrated−observed|):
	* the channel that dominated the fused top-1 at predict time is rewarded
	* when the prediction error is small and penalized when it is large, via an
	* EWMA step clamped to [0.2, 3]. Channels that keep surfacing the
	* actually-relevant experience grow; channels that pull in noise shrink.
	* @param prediction - the resolved prediction carrying its fusion record.
	* @param error - the absolute prediction error |calibrated − observed|.
	*/
	learnFromFeedback(prediction, error) {
		const fusion = prediction.fusion;
		if (fusion === null || fusion.scores.length !== 4) return;
		const weights = this.store.channelWeightsSnapshot();
		let dominant = 0;
		for (let index = 1; index < fusion.scores.length; index += 1) if ((fusion.scores[index] ?? 0) > (fusion.scores[dominant] ?? 0)) dominant = index;
		const lr = this.config.channelLearningRate;
		const target = error < this.config.channelErrorThreshold ? 1.6 : .5;
		const updated = {
			semantic: weights.semantic,
			situational: weights.situational,
			symptom: weights.symptom,
			outcome: weights.outcome
		};
		const key = [
			"semantic",
			"situational",
			"symptom",
			"outcome"
		][dominant];
		if (key === void 0) return;
		updated[key] = Math.min(3, Math.max(.2, weights[key] + lr * (target - weights[key])));
		this.store.updateChannelWeights(updated);
	}
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
	taxonomyContext(situation) {
		const clusters = this.store.clustersSnapshot().filter((cluster) => cluster.situationCentroid.length === 384);
		if (clusters.length === 0) return {
			cluster: null,
			similarity: 0,
			margin: 0,
			coverage: "no-taxonomy"
		};
		const vector = actionVector(situation, []);
		const scored = clusters.map((cluster) => ({
			cluster,
			score: cosine(vector, cluster.situationCentroid)
		})).sort((a, b) => b.score - a.score);
		const best = scored[0];
		if (best === void 0 || best.score < this.config.coverageThreshold) return {
			cluster: null,
			similarity: best?.score ?? 0,
			margin: 0,
			coverage: "gap"
		};
		const runner = scored[1];
		return {
			cluster: {
				clusterId: best.cluster.clusterId,
				name: best.cluster.name,
				decisionRule: best.cluster.decisionRule,
				polarity: best.cluster.polarity
			},
			similarity: best.score,
			margin: best.score - (runner?.score ?? 0),
			coverage: "covered"
		};
	}
	/** Compact retrieval-advice line appended to the advice text. */
	taxonomyAdviceLine(context) {
		if (context.coverage === "no-taxonomy") return " | 检索建议：分类体系尚未建立，按全新现象处理";
		if (context.coverage === "gap") return ` | 检索建议：情境落在分类覆盖缺口（最高相似度 ${context.similarity.toFixed(3)} < ${this.config.coverageThreshold}），SAR 无相关经验`;
		const confidence = context.margin < this.config.retrievalFailureMargin ? "，路由置信低" : "";
		return ` | 检索建议：命中簇「${context.cluster?.name.slice(0, 24) ?? "?"}」（相似度 ${context.similarity.toFixed(3)}，路由余量 ${context.margin.toFixed(3)}${confidence}）`;
	}
	/** Match the current situation against proven success clusters. Returns the
	* closest success cluster whose situation centroid clears the threshold, so
	* the model can reference a proven strategy even when the action itself is
	* novel.
	* @param situation - the current situation text.
	* @returns the matched success reference, or null.
	*/
	matchSuccessReference(situation) {
		const vector = actionVector(situation, []);
		let best = null;
		let bestScore = this.config.successReferenceThreshold;
		for (const cluster of this.store.clustersSnapshot()) {
			if (cluster.polarity !== "success") continue;
			if (cluster.situationCentroid.length !== 384) continue;
			const score = cosine(vector, cluster.situationCentroid);
			if (score >= bestScore) {
				bestScore = score;
				best = {
					clusterId: cluster.clusterId,
					clusterName: cluster.name,
					decisionRule: cluster.decisionRule,
					utilityRange: { ...cluster.expectedUtilityRange }
				};
			}
		}
		return best;
	}
	/** Novel branch: scratchpad lookup or creation, conservative calibration. */
	async predictNovel(input, sessionId, signal, oodSignal, top1, successReference, taxonomyContext, adviceSuffix, refineNote) {
		const hash = String(signatureHash(input.action));
		this.store.expireTempStrategies();
		let strategy = this.store.getTempStrategy(hash);
		let usedTempStrategy = false;
		if (strategy !== void 0 && strategy.status === "active") {
			usedTempStrategy = true;
			strategy = this.store.updateTempStrategy(hash, {
				hitCount: strategy.hitCount + 1,
				pendingResult: null
			});
		}
		const calibration = await calibrate(this.ctx, this.route, {
			situation: input.situation,
			action: input.action,
			context: input.context,
			positiveCount: 0,
			negativeCount: 0,
			samples: []
		}, {
			sessionId,
			signal
		});
		const raw = calibration.finalCalibratedProbability;
		const shrunk = this.shrink(raw, 0);
		const widened = widenInterval(clamp01(calibration.finalConfidenceIntervalLow), clamp01(calibration.finalConfidenceIntervalHigh), this.config.minConfidenceIntervalWidth);
		let advice;
		if (usedTempStrategy && strategy !== void 0) advice = `⚠️ 全新现象（命中临时试行方案）：${strategy.trialAction}。此为临时试行方案，尚未晋升为主记忆。`;
		else {
			advice = `⚠️ 全新现象：历史库无匹配（Top1相似度 ${top1.toFixed(3)}，信号 ${oodSignal}）。建议小步试探：${calibration.advicePreview}`;
			this.store.addTempStrategy({
				signatureHash: hash,
				trialAction: input.action,
				pendingResult: null,
				hitCount: 1,
				positiveCount: 0,
				createdAt: Date.now(),
				expiresAt: Date.now() + this.config.tempStrategyTtlMs,
				status: "active",
				sourceExpId: null
			});
		}
		if (successReference !== null) advice += ` | 参照成功策略（簇「${successReference.clusterName}」）：${successReference.decisionRule}`;
		if (refineNote !== null) advice += refineNote;
		advice += adviceSuffix;
		const predictionId = this.store.nextPredictionId();
		this.store.addPrediction({
			predictionId,
			expId: null,
			situation: input.situation,
			action: input.action,
			predictedOutcome: advice,
			rawProbability: raw,
			calibratedProbability: shrunk,
			confidenceLow: widened.low,
			confidenceHigh: widened.high,
			isNovel: true,
			usedTempStrategy,
			clusterId: null,
			timestamp: Date.now(),
			actualOutcome: null,
			predictionError: null,
			resolvedAt: null,
			fusion: null
		});
		return {
			predictionId,
			advice,
			rawProbability: raw,
			calibratedProbability: shrunk,
			confidenceLow: widened.low,
			confidenceHigh: widened.high,
			isNovel: true,
			oodSignal,
			topHitCount: 0,
			usedTempStrategy,
			clusterId: null,
			successReference,
			taxonomyContext
		};
	}
	/** Familiar branch: five-layer calibration over the top-K samples. */
	async predictKnown(input, samples, topChannels, sessionId, signal, oodSignal, _top1, successReference, taxonomyContext, adviceSuffix, refineNote) {
		const positive = samples.filter((exp) => outcomePolarity(exp.sar.outcomeUtility) === "positive").length;
		const negative = samples.filter((exp) => outcomePolarity(exp.sar.outcomeUtility) === "negative").length;
		const k = samples.length;
		const calibration = await calibrate(this.ctx, this.route, {
			situation: input.situation,
			action: input.action,
			context: input.context,
			positiveCount: positive,
			negativeCount: negative,
			samples: samples.slice(0, Math.min(samples.length, 10)).map((exp) => ({
				expId: exp.expId,
				actionKeywords: exp.sar.actionKeywords.join(","),
				utility: `${exp.sar.outcomeUtility.materialGain}/${exp.sar.outcomeUtility.emotionalValence}/${exp.sar.outcomeUtility.energyCost}`,
				...exp.meta === true ? { meta: true } : {}
			}))
		}, {
			sessionId,
			signal
		});
		const raw = clamp01(calibration.finalCalibratedProbability);
		const shrunk = this.shrink(raw, k);
		const widened = widenInterval(clamp01(calibration.finalConfidenceIntervalLow), clamp01(calibration.finalConfidenceIntervalHigh), this.config.minConfidenceIntervalWidth);
		const empirical = this.store.empiricalAccuracyFor(shrunk);
		const finalProbability = empirical === null ? shrunk : clamp01(.7 * shrunk + .3 * empirical);
		const nearest = samples[0];
		const clusterId = nearest === void 0 ? null : nearest.clusterId;
		const clusterLabel = nearest === void 0 || nearest.strategyLabel === null ? null : nearest.strategyLabel;
		let advice = calibration.advicePreview;
		if (calibration.riskFactors.length > 0) advice += ` | 风险因素：${calibration.riskFactors.slice(0, 3).join("；")}`;
		if (clusterLabel !== null) advice = `[簇:${clusterLabel}] ${advice}`;
		if (successReference !== null) advice += ` | 参照成功策略（簇「${successReference.clusterName}」）：${successReference.decisionRule}`;
		if (refineNote !== null) advice += refineNote;
		advice += adviceSuffix;
		const predictionId = this.store.nextPredictionId();
		this.store.addPrediction({
			predictionId,
			expId: nearest === void 0 ? null : nearest.expId,
			situation: input.situation,
			action: input.action,
			predictedOutcome: advice,
			rawProbability: raw,
			calibratedProbability: finalProbability,
			confidenceLow: widened.low,
			confidenceHigh: widened.high,
			isNovel: false,
			usedTempStrategy: false,
			clusterId,
			timestamp: Date.now(),
			actualOutcome: null,
			predictionError: null,
			resolvedAt: null,
			fusion: nearest === void 0 || topChannels === null ? null : { scores: [...topChannels] }
		});
		return {
			predictionId,
			advice,
			rawProbability: raw,
			calibratedProbability: finalProbability,
			confidenceLow: widened.low,
			confidenceHigh: widened.high,
			isNovel: false,
			oodSignal,
			topHitCount: k,
			usedTempStrategy: false,
			clusterId,
			successReference,
			taxonomyContext
		};
	}
	/** Layer-2 shrinkage: P_cal = (k/(k+α))·P_raw + (α/(k+α))·0.5. */
	shrink(raw, k) {
		const alpha = this.config.shrinkageAlpha;
		return clamp01(k / (k + alpha) * raw + alpha / (k + alpha) * .5);
	}
	/** Find an active scratchpad strategy loosely matching one action.
	* @param action - the action text to match.
	* @returns the matching active strategy, or undefined.
	*/
	findMatchingTempStrategy(action) {
		const hash = String(signatureHash(action));
		this.store.expireTempStrategies();
		return this.store.tempStrategiesSnapshot().find((strategy) => strategy.status === "active" && (strategy.signatureHash === hash || cosine(actionVector(action, []), actionVector(strategy.trialAction, [])) >= this.config.tempStrategyMatchThreshold));
	}
};
/**
* Index a probability into its decile bucket.
* @param probability - the probability in [0, 1].
* @returns the decile index 0–9.
*/
function bucketIndex(probability) {
	return Math.min(9, Math.max(0, Math.floor(probability * 10)));
}
/** One JSONL line reader that tolerates blank/trailing lines. */
function parseLines(source) {
	const records = [];
	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			records.push(JSON.parse(trimmed));
		} catch {
			continue;
		}
	}
	return records;
}
/** Awaitable serial write queue so flushes never interleave. */
var WriteQueue = class {
	tail = Promise.resolve();
	/** Chain one write behind the previous; returns the chained promise. */
	push(write) {
		const next = this.tail.then(write, write);
		this.tail = next.catch(() => {});
		return next;
	}
	/** Settle only after every enqueued write finished. */
	async drain() {
		await this.tail;
	}
};
/** Create a fresh decile bucket table. */
function emptyBuckets() {
	return Array.from({ length: 10 }, (_, index) => ({
		bucketIndex: index,
		totalCount: 0,
		hitCount: 0,
		empiricalAccuracy: null
	}));
}
/** Clamp a persisted channel weight into the learnable band [0.2, 3]. */
function clampWeight(value) {
	return Math.min(3, Math.max(.2, typeof value === "number" && Number.isFinite(value) ? value : 1));
}
/** The complete persisted state of one pipeline store. */
var CognitiveStore = class {
	root;
	queue = new WriteQueue();
	experiences = /* @__PURE__ */ new Map();
	predictions = /* @__PURE__ */ new Map();
	tempStrategies = /* @__PURE__ */ new Map();
	clusterList = [];
	calibration = emptyBuckets();
	channelWeights = {
		semantic: 1,
		situational: 1,
		symptom: 1,
		outcome: 1
	};
	taxonomyState = null;
	nextExpSeq = 1;
	nextPredictionSeq = 1;
	nextClusterSeq = 1;
	/**
	* @param root - directory that will hold the JSONL/JSON state files.
	*/
	constructor(root) {
		this.root = root;
	}
	file(name) {
		return join(this.root, name);
	}
	/** Create the root and load every table. Missing files start empty. */
	async load() {
		await mkdir(this.root, { recursive: true });
		const [experiences, predictions, tempStrategies, clusters, calibration, channelWeights, taxonomy] = await Promise.all([
			readFile(this.file("experiences.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("predictions.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("temp_strategies.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("clusters.json"), "utf8").catch(() => ""),
			readFile(this.file("calibration.json"), "utf8").catch(() => ""),
			readFile(this.file("channel_weights.json"), "utf8").catch(() => ""),
			readFile(this.file("taxonomy.json"), "utf8").catch(() => "")
		]);
		for (const record of parseLines(experiences)) {
			if (typeof record !== "object" || record === null) continue;
			const exp = record;
			if (typeof exp.expId !== "string") continue;
			this.experiences.set(exp.expId, exp);
			this.nextExpSeq = Math.max(this.nextExpSeq, expSeqOf(exp.expId) + 1);
		}
		for (const record of parseLines(predictions)) {
			if (typeof record !== "object" || record === null) continue;
			const prediction = record;
			if (typeof prediction.predictionId !== "string") continue;
			this.predictions.set(prediction.predictionId, {
				...prediction,
				fusion: prediction.fusion ?? null
			});
			this.nextPredictionSeq = Math.max(this.nextPredictionSeq, predictionSeqOf(prediction.predictionId) + 1);
		}
		for (const record of parseLines(tempStrategies)) {
			if (typeof record !== "object" || record === null) continue;
			const strategy = record;
			if (typeof strategy.signatureHash !== "string") continue;
			this.tempStrategies.set(strategy.signatureHash, strategy);
		}
		if (clusters !== "") {
			const parsed = JSON.parse(clusters);
			if (Array.isArray(parsed)) {
				this.clusterList = parsed.filter((cluster) => {
					if (typeof cluster !== "object" || cluster === null) return false;
					return typeof cluster.clusterId === "number";
				}).map((cluster) => this.normalizeCluster(cluster));
				for (const cluster of this.clusterList) this.nextClusterSeq = Math.max(this.nextClusterSeq, cluster.clusterId + 1);
			}
		}
		const parsedCalibration = calibration === "" ? null : JSON.parse(calibration);
		if (Array.isArray(parsedCalibration) && parsedCalibration.length === 10) this.calibration = parsedCalibration;
		if (channelWeights !== "") {
			const parsed = JSON.parse(channelWeights);
			if (typeof parsed === "object" && parsed !== null) this.channelWeights = {
				semantic: clampWeight(parsed.semantic),
				situational: clampWeight(parsed.situational),
				symptom: clampWeight(parsed.symptom),
				outcome: clampWeight(parsed.outcome)
			};
		}
		if (taxonomy !== "") {
			const parsed = JSON.parse(taxonomy);
			if (typeof parsed === "object" && parsed !== null && typeof parsed.version === "number") {
				const rawRules = Array.isArray(parsed.rules) ? parsed.rules : [];
				this.taxonomyState = {
					...parsed,
					rules: rawRules.filter((rule) => typeof rule === "object" && rule !== null).map((rule) => {
						const polarityRaw = rule.polarity;
						const hasPolarity = polarityRaw === "success" || polarityRaw === "risk";
						const rangeLow = typeof rule.utilityRange === "object" && rule.utilityRange !== null ? Number(rule.utilityRange.low) : 0;
						return {
							condition: typeof rule.condition === "string" ? rule.condition : "",
							action: typeof rule.action === "string" ? rule.action : "",
							utilityRange: {
								low: Number.isFinite(rangeLow) ? rangeLow : 0,
								high: typeof rule.utilityRange === "object" && rule.utilityRange !== null ? Number(rule.utilityRange.high) : 10
							},
							polarity: hasPolarity ? polarityRaw : Number.isFinite(rangeLow) && rangeLow >= 5 ? "success" : "risk"
						};
					})
				};
			}
		}
	}
	/** Await every pending persistence write. */
	async flush() {
		await this.queue.drain();
	}
	enqueue(name, payload) {
		const file = this.file(name);
		const data = typeof payload === "string" ? payload : `${JSON.stringify(payload)}\n`;
		this.queue.push(async () => {
			const tmp = `${file}.tmp`;
			await writeFile(tmp, data, "utf8");
			await rename(tmp, file);
		});
	}
	enqueueLines(name, records) {
		const lines = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
		this.enqueue(name, lines);
	}
	/**
	* Store one experience and enqueue its persistence.
	* @param exp - the experience to add.
	*/
	addExperience(exp) {
		this.experiences.set(exp.expId, exp);
		this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
	}
	/**
	* Read one experience by id.
	* @param expId - the experience id.
	* @returns the experience, or undefined.
	*/
	getExperience(expId) {
		return this.experiences.get(expId);
	}
	/** Snapshot of every stored experience.
	* @returns experiences in insertion order.
	*/
	experiencesSnapshot() {
		return [...this.experiences.values()];
	}
	/**
	* Apply a partial patch to one experience and enqueue its persistence.
	* @param expId - the experience id.
	* @param patch - the fields to replace.
	* @returns the updated experience.
	*/
	updateExperience(expId, patch) {
		const current = this.experiences.get(expId);
		if (current === void 0) throw new Error(`cognitive-pipeline: experience "${expId}" not found`);
		const next = {
			...current,
			...patch
		};
		this.experiences.set(expId, next);
		this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
		return next;
	}
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
	applyFeedbackEvidence(expId, weight, contradictory, fastTrackThreshold, permanentThreshold) {
		const current = this.getExperience(expId);
		if (current === void 0) throw new Error(`cognitive-pipeline: experience "${expId}" not found`);
		if (!current.simulated || current.verification === "verified") return current;
		if (contradictory && current.verification === "provisional") {
			const rolled = {
				...current,
				verification: "unverified",
				evidenceScore: 0
			};
			this.experiences.set(expId, rolled);
			this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
			return rolled;
		}
		const nextScore = current.evidenceScore + weight;
		const verification = nextScore >= permanentThreshold ? "verified" : weight >= fastTrackThreshold || current.verification === "provisional" ? "provisional" : "unverified";
		const next = {
			...current,
			evidenceScore: nextScore,
			verification
		};
		this.experiences.set(expId, next);
		this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
		return next;
	}
	/**
	* Expire simulated experiences that never earned real feedback within the
	* fallback TTL. This is the backstop of the evidence-replacement model:
	* verification and density are primary, the timeout guards the
	* never-verified corner.
	* @param now - the reference timestamp.
	* @param ttlMs - the fallback TTL for unverified simulated experiences.
	* @returns the expIds removed.
	*/
	expireUnverifiedSimulated(now, ttlMs) {
		const expired = [];
		for (const exp of this.experiences.values()) if (exp.simulated && exp.verification === "unverified" && now - exp.timestamp >= ttlMs) {
			this.experiences.delete(exp.expId);
			expired.push(exp.expId);
		}
		if (expired.length > 0) this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
		return expired;
	}
	/** Store one prediction and enqueue its persistence.
	* @param prediction - the prediction to add.
	*/
	addPrediction(prediction) {
		this.predictions.set(prediction.predictionId, prediction);
		this.enqueueLines("predictions.jsonl", [...this.predictions.values()]);
	}
	/** Read one prediction by id.
	* @param predictionId - the prediction id.
	* @returns the prediction, or undefined.
	*/
	getPrediction(predictionId) {
		return this.predictions.get(predictionId);
	}
	/** Snapshot of every stored prediction.
	* @returns predictions in insertion order.
	*/
	predictionsSnapshot() {
		return [...this.predictions.values()];
	}
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
	resolvePrediction(predictionId, actualOutcome, predictionError, outcomeQuality) {
		const current = this.predictions.get(predictionId);
		if (current === void 0) throw new Error(`cognitive-pipeline: prediction "${predictionId}" not found`);
		const now = Date.now();
		const resolved = {
			...current,
			actualOutcome,
			predictionError,
			resolvedAt: now
		};
		this.predictions.set(predictionId, resolved);
		this.enqueueLines("predictions.jsonl", [...this.predictions.values()]);
		if (current.expId !== null) {
			const exp = this.experiences.get(current.expId);
			if (exp !== void 0) {
				const utility = outcomeQuality === void 0 ? exp.sar.outcomeUtility : {
					...exp.sar.outcomeUtility,
					materialGain: clampLabel(5 + (outcomeQuality - 5) * .8)
				};
				const next = {
					...exp,
					predictionError,
					cumulativeError: exp.cumulativeError + predictionError,
					sar: {
						...exp.sar,
						outcomeUtility: utility
					}
				};
				this.experiences.set(exp.expId, next);
				this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
			}
		}
		return resolved;
	}
	/** Read one scratchpad strategy by signature hash.
	* @param signatureHash - the strategy key.
	* @returns the strategy, or undefined.
	*/
	getTempStrategy(signatureHash) {
		return this.tempStrategies.get(signatureHash);
	}
	/** Store one scratchpad strategy and enqueue its persistence.
	* @param strategy - the strategy to add.
	*/
	addTempStrategy(strategy) {
		this.tempStrategies.set(strategy.signatureHash, strategy);
		this.enqueueLines("temp_strategies.jsonl", [...this.tempStrategies.values()]);
	}
	/** Apply a partial patch to one scratchpad strategy.
	* @param signatureHash - the strategy key.
	* @param patch - the fields to replace.
	* @returns the updated strategy.
	*/
	updateTempStrategy(signatureHash, patch) {
		const current = this.tempStrategies.get(signatureHash);
		if (current === void 0) throw new Error(`cognitive-pipeline: temp strategy "${signatureHash}" not found`);
		const next = {
			...current,
			...patch
		};
		this.tempStrategies.set(signatureHash, next);
		this.enqueueLines("temp_strategies.jsonl", [...this.tempStrategies.values()]);
		return next;
	}
	/** Snapshot of every scratchpad strategy.
	* @returns strategies in insertion order.
	*/
	tempStrategiesSnapshot() {
		return [...this.tempStrategies.values()];
	}
	/**
	* Expire active strategies past their TTL.
	* @param now - the reference timestamp; defaults to the current time.
	* @returns the hashes that were expired.
	*/
	expireTempStrategies(now = Date.now()) {
		const expired = [];
		for (const [hash, strategy] of this.tempStrategies) if (strategy.status === "active" && strategy.expiresAt < now) {
			this.tempStrategies.set(hash, {
				...strategy,
				status: "expired"
			});
			expired.push(hash);
		}
		if (expired.length > 0) this.enqueueLines("temp_strategies.jsonl", [...this.tempStrategies.values()]);
		return expired;
	}
	/** Record one resolved prediction in its confidence decile.
	* @param probability - the calibrated probability.
	* @param hit - whether the outcome was positive.
	*/
	recordCalibration(probability, hit) {
		const index = bucketIndex(probability);
		const bucket = this.calibration[index];
		if (bucket === void 0) throw new Error("cognitive-pipeline: calibration bucket out of range");
		const totalCount = bucket.totalCount + 1;
		const hitCount = bucket.hitCount + (hit ? 1 : 0);
		this.calibration[index] = {
			bucketIndex: index,
			totalCount,
			hitCount,
			empiricalAccuracy: hitCount / totalCount
		};
		this.enqueue("calibration.json", this.calibration);
	}
	/** Snapshot of every calibration bucket.
	* @returns a detached decile table.
	*/
	calibrationBucketsSnapshot() {
		return this.calibration.map((bucket) => ({ ...bucket }));
	}
	/**
	* Lifetime empirical accuracy for one probability's decile bucket.
	* @param probability - the calibrated probability.
	* @returns the bucket accuracy, or null when the bucket has no count.
	*/
	empiricalAccuracyFor(probability) {
		const bucket = this.calibration[bucketIndex(probability)];
		return bucket === void 0 ? null : bucket.empiricalAccuracy;
	}
	/** Snapshot of the learned retrieval channel weights.
	* @returns a detached weight record.
	*/
	channelWeightsSnapshot() {
		return { ...this.channelWeights };
	}
	/** Apply one EWMA step to the learned retrieval channel weights.
	* @param weights - the new weights; each must already be clamped.
	*/
	updateChannelWeights(weights) {
		this.channelWeights = { ...weights };
		this.enqueue("channel_weights.json", this.channelWeights);
	}
	/** Snapshot of the cluster table.
	* @returns clusters with detached fields.
	*/
	clustersSnapshot() {
		return this.clusterList.map((cluster) => ({ ...cluster }));
	}
	/** Snapshot of the current taxonomy.
	* @returns the taxonomy, or null before the first rebuild.
	*/
	taxonomySnapshot() {
		return this.taxonomyState === null ? null : {
			...this.taxonomyState,
			rules: [...this.taxonomyState.rules]
		};
	}
	/** Allocate the next cluster id.
	* @returns a fresh monotonically increasing id.
	*/
	nextClusterId() {
		const id = this.nextClusterSeq;
		this.nextClusterSeq += 1;
		return id;
	}
	/**
	* Atomically replace the cluster table and taxonomy, and reassign member
	* experiences to their new clusters. One enqueued flush per table keeps the
	* files consistent with each other.
	* @param clusters - the new cluster table.
	* @param taxonomy - the new taxonomy snapshot.
	* @param assignments - per-experience cluster membership to write back.
	*/
	applyTaxonomy(clusters, taxonomy, assignments) {
		this.clusterList = clusters.map((cluster) => ({ ...cluster }));
		this.taxonomyState = {
			...taxonomy,
			rules: [...taxonomy.rules]
		};
		this.enqueue("clusters.json", this.clusterList);
		this.enqueue("taxonomy.json", this.taxonomyState);
		for (const [expId, assignment] of assignments) {
			const exp = this.experiences.get(expId);
			if (exp !== void 0) this.experiences.set(expId, {
				...exp,
				clusterId: assignment.clusterId,
				strategyLabel: assignment.strategyLabel
			});
		}
		this.enqueueLines("experiences.jsonl", [...this.experiences.values()]);
	}
	/** Simple in-memory + disk counts for inspection.
	* @returns experience, prediction, and resolved counts.
	*/
	stats() {
		let resolved = 0;
		for (const prediction of this.predictions.values()) if (prediction.resolvedAt !== null) resolved += 1;
		return {
			experienceCount: this.experiences.size,
			predictionCount: this.predictions.size,
			resolvedPredictionCount: resolved
		};
	}
	/** Allocate the next experience id.
	* @returns `exp_<n>`.
	*/
	nextExpId() {
		const id = `exp_${this.nextExpSeq}`;
		this.nextExpSeq += 1;
		return id;
	}
	/** Allocate the next prediction id.
	* @returns `pred_<n>`.
	*/
	nextPredictionId() {
		const id = `pred_${this.nextPredictionSeq}`;
		this.nextPredictionSeq += 1;
		return id;
	}
	/** Derive a normalized cluster view when the on-disk row predates the new
	* polarity / situationCentroid fields: polarity from the expected utility
	* range, centroid from the supporting experiences' situations.
	* @param raw - the loaded, still-untrusted cluster row.
	* @returns the cluster with both new fields present.
	*/
	normalizeCluster(raw) {
		const polarityRaw = raw.polarity;
		const hasPolarity = polarityRaw === "success" || polarityRaw === "risk";
		const centroidRaw = raw.situationCentroid;
		const hasCentroid = Array.isArray(centroidRaw) && centroidRaw.length > 0;
		if (hasPolarity && hasCentroid) return raw;
		const members = (Array.isArray(raw.supportingEvidenceIds) ? raw.supportingEvidenceIds.filter((id) => typeof id === "string") : []).map((id) => this.experiences.get(id)).filter((exp) => exp !== void 0);
		const rangeLow = typeof raw.expectedUtilityRange === "object" && raw.expectedUtilityRange !== null ? Number(raw.expectedUtilityRange.low) : 0;
		const polarity = hasPolarity ? polarityRaw : Number.isFinite(rangeLow) && rangeLow >= 5 ? "success" : "risk";
		return {
			...raw,
			polarity,
			situationCentroid: members.length === 0 ? new Array(384).fill(0) : centroidOf(members.map((member) => actionVector(member.sar.situation, [])))
		};
	}
};
/** Extract the numeric sequence from an `exp_<n>` id. */
function expSeqOf(expId) {
	const match = /^exp_(\d+)$/.exec(expId);
	return match === null ? 0 : Number(match[1]);
}
/** Extract the numeric sequence from a `pred_<n>` id. */
function predictionSeqOf(predictionId) {
	const match = /^pred_(\d+)$/.exec(predictionId);
	return match === null ? 0 : Number(match[1]);
}
/** Mean of L2-normalized vectors (centroid), re-normalized; zero input stays zero. */
function centroidOf(vectors) {
	const dim = vectors[0]?.length ?? 0;
	if (dim === 0) return [];
	const sum = new Array(dim).fill(0);
	for (const vector of vectors) for (let index = 0; index < dim; index += 1) sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0);
	const mean = sum.map((value) => value / vectors.length);
	let norm = 0;
	for (const value of mean) norm += value * value;
	norm = Math.sqrt(norm);
	return norm < 1e-9 ? mean : mean.map((value) => value / norm);
}
/** Clamp a feedback-derived utility axis into [0, 10] rounded to one decimal. */
function clampLabel(value) {
	return Math.min(10, Math.max(0, Math.round(value * 10) / 10));
}
//#endregion
//#region lib/types/service.js
/**
* CognitivePipelineService: the pipeline's public service. It owns the store
* and both engines, and exposes the online (`remember`/`predict`/`report`),
* offline (`rebuild`), and observational (`inspect`) entry points the tools
* and other plugins call. Extends Cordis `Service`, so loading the plugin
* provides `ctx.cognitivePipeline`.
* @module @deepseek-ai/dsh-cognitive-pipeline/service
*/
/** Meta-experience deduplication: skip recording a routing-failure when an
* action-vector-identical meta experience already exists (default 0.8). */
const META_DEDUP_COSINE = .8;
/** Pure-chat pre-filter: a turn with no tool calls, no failure, and short
* output never reaches the accumulation gate (the per-turn LLM cost guard). */
const ACCUMULATE_MIN_ACTION_CHARS = 160;
/** Config schema for Loader validation and defaulting. */
const Config = z.object({
	root: z.string(),
	provider: z.string(),
	model: z.string(),
	enabled: z.boolean().default(true),
	topK: z.number().step(1).min(1).max(50).default(10),
	oodSimThreshold: z.number().min(0).max(1).default(.65),
	oodFlatThreshold: z.number().min(0).max(1).default(.1),
	oodSiThreshold: z.number().min(0).default(1.5),
	tempStrategyTtlMs: z.number().step(1).min(6e4).default(1440 * 60 * 1e3),
	tempStrategyHitThreshold: z.number().step(1).min(1).default(3),
	tempStrategyPositiveRatio: z.number().min(0).max(1).default(.667),
	tempStrategyMatchThreshold: z.number().min(0).max(1).default(.5),
	shrinkageAlpha: z.number().min(0).default(50),
	minConfidenceIntervalWidth: z.number().min(0).max(1).default(.2),
	successReferenceThreshold: z.number().min(0).max(1).default(.4),
	coverageThreshold: z.number().min(0).max(1).default(.3),
	retrievalFailureMargin: z.number().min(0).max(1).default(.1),
	channelLearningRate: z.number().min(0).max(1).default(.2),
	channelErrorThreshold: z.number().min(0).max(1).default(.3),
	refineMaxDrops: z.number().step(1).min(0).max(5).default(2),
	decayLambda: z.number().min(0).default(.01),
	minDecayWeight: z.number().min(0).max(1).default(.1),
	predictionErrorThreshold: z.number().min(0).max(1).default(.3),
	successUtilityThreshold: z.number().min(0).max(15).default(3),
	minValidationCount: z.number().step(1).min(1).default(3),
	simulationFastTrackThreshold: z.number().min(0).max(1).default(.8),
	simulationPermanentThreshold: z.number().min(0).default(2),
	simulationTtlMs: z.number().step(1).min(6e4).default(720 * 60 * 60 * 1e3),
	autoAccumulate: z.boolean().default(false),
	maxSampleRatio: z.number().min(.01).max(1).default(.15),
	evidenceMinCount: z.number().step(1).min(1).default(3),
	evidenceMaxDistance: z.number().min(0).max(1).default(.85),
	sandboxImprovement: z.number().min(0).max(1).default(.15),
	validationRatio: z.number().min(.01).max(.5).default(.2),
	reconstructRetries: z.number().step(1).min(0).max(5).default(2),
	clusterMergeCosine: z.number().min(0).max(1).default(.4),
	clusterMatchCosine: z.number().min(0).max(1).default(.3),
	emergencyErrorThreshold: z.number().min(0).max(1).default(.8)
});
/** Validate an untrusted config object without Loader normalization.
* @param config - untrusted plugin configuration.
* @returns the resolved immutable configuration.
*/
function resolveConfig(config) {
	const route = resolveRoute({
		provider: config.provider,
		model: config.model
	});
	const root = config.root ?? dshHomePath("cognitive-pipeline");
	return Object.freeze({
		root,
		enabled: config.enabled ?? true,
		route,
		hot: Object.freeze({
			topK: config.topK ?? 10,
			oodSimThreshold: config.oodSimThreshold ?? .65,
			oodFlatThreshold: config.oodFlatThreshold ?? .1,
			oodSiThreshold: config.oodSiThreshold ?? 1.5,
			shrinkageAlpha: config.shrinkageAlpha ?? 50,
			minConfidenceIntervalWidth: config.minConfidenceIntervalWidth ?? .2,
			successReferenceThreshold: config.successReferenceThreshold ?? .4,
			coverageThreshold: config.coverageThreshold ?? .3,
			retrievalFailureMargin: config.retrievalFailureMargin ?? .1,
			channelLearningRate: config.channelLearningRate ?? .2,
			channelErrorThreshold: config.channelErrorThreshold ?? .3,
			refineMaxDrops: config.refineMaxDrops ?? 2,
			tempStrategyTtlMs: config.tempStrategyTtlMs ?? 1440 * 60 * 1e3,
			tempStrategyMatchThreshold: config.tempStrategyMatchThreshold ?? .5
		}),
		cold: Object.freeze({
			decayLambda: config.decayLambda ?? .01,
			minDecayWeight: config.minDecayWeight ?? .1,
			predictionErrorThreshold: config.predictionErrorThreshold ?? .3,
			successUtilityThreshold: config.successUtilityThreshold ?? 3,
			minValidationCount: config.minValidationCount ?? 3,
			maxSampleRatio: config.maxSampleRatio ?? .15,
			evidenceMinCount: config.evidenceMinCount ?? 3,
			evidenceMaxDistance: config.evidenceMaxDistance ?? .85,
			sandboxImprovement: config.sandboxImprovement ?? .15,
			validationRatio: config.validationRatio ?? .2,
			reconstructRetries: config.reconstructRetries ?? 2,
			clusterMergeCosine: config.clusterMergeCosine ?? .4,
			clusterMatchCosine: config.clusterMatchCosine ?? .3
		}),
		tempStrategyHitThreshold: config.tempStrategyHitThreshold ?? 3,
		tempStrategyPositiveRatio: config.tempStrategyPositiveRatio ?? .667,
		emergencyErrorThreshold: config.emergencyErrorThreshold ?? .8,
		simulationFastTrackThreshold: config.simulationFastTrackThreshold ?? .8,
		simulationPermanentThreshold: config.simulationPermanentThreshold ?? 2,
		simulationTtlMs: config.simulationTtlMs ?? 720 * 60 * 60 * 1e3,
		autoAccumulate: config.autoAccumulate ?? false
	});
}
/** The pipeline service. */
var CognitivePipelineService = class extends Service {
	static Config = Config;
	/** Resolved configuration. */
	resolved;
	/** The file-backed store (public for inspection). */
	store;
	/** Hot-loop engine. */
	hot;
	/** Cold-loop engine. */
	cold;
	readinessPromise;
	constructor(ctx, config = {}) {
		super(ctx, "cognitivePipeline");
		this.resolved = resolveConfig(config);
		this.store = new CognitiveStore(this.resolved.root);
		this.hot = new HotEngine(ctx, this.store, this.resolved.hot, this.resolved.route);
		this.cold = new ColdEngine(ctx, this.store, this.resolved.cold, this.resolved.route);
		this.readinessPromise = this.store.load().catch((error) => {
			this.ctx.logger.warn(`cognitive-pipeline: store load failed, continuing in-memory: ${String(error)}`);
		});
	}
	/** Resolve after the store finished loading (never rejects). */
	async ready() {
		await this.readinessPromise;
	}
	/** Flush all pending persistence writes. */
	async flush() {
		await this.store.flush();
	}
	/** Encode one raw experience into SAR, vectorize, and store it.
	* @param input - the raw experience text.
	* @param call - optional session/signal context.
	* @returns the new experience id and its SAR triplet.
	*/
	async remember(input, call) {
		if (input.rawText.trim().length === 0) throw new CognitivePipelineError("cognitive-pipeline: rawText must not be empty", "EMPTY_RAW_TEXT");
		const sar = await extractSar(this.ctx, this.resolved.route, input.rawText, {
			sessionId: call?.sessionId,
			signal: call?.signal
		});
		const expId = this.store.nextExpId();
		const exp = {
			expId,
			sar,
			actionVector: actionVector(sar.action, sar.actionKeywords),
			outcomeVector: outcomeVector(sar.outcomeUtility, sar.outcome),
			clusterId: null,
			strategyLabel: null,
			timestamp: Date.now(),
			predictionError: null,
			cumulativeError: 0,
			hitCount: 0,
			positiveCount: 0,
			simulated: false,
			verification: "verified",
			evidenceScore: 0
		};
		this.store.addExperience(exp);
		await this.store.flush();
		return {
			expId,
			sar
		};
	}
	/**
	* Generate a simulated experience via the LLM route: a retrieval-only,
	* unverified candidate for "if I take this action in this situation, what
	* would happen". It shapes no cluster until real feedback verifies it.
	* @param input - the hypothetical situation and proposed action.
	* @param call - optional session/signal context.
	* @returns the new simulated experience id and its SAR triplet.
	*/
	async simulate(input, call) {
		if (input.situation.trim().length === 0 || input.action.trim().length === 0) throw new CognitivePipelineError("cognitive-pipeline: situation and action must not be empty", "EMPTY_SIMULATE_INPUT");
		const rawText = `假设情境：${input.situation}。拟采取行动：${input.action}。推演可能的短期与长期结果。`;
		const sar = await extractSar(this.ctx, this.resolved.route, rawText, {
			sessionId: call?.sessionId,
			signal: call?.signal
		});
		const expId = this.store.nextExpId();
		const exp = {
			expId,
			sar,
			actionVector: actionVector(sar.action, sar.actionKeywords),
			outcomeVector: outcomeVector(sar.outcomeUtility, sar.outcome),
			clusterId: null,
			strategyLabel: null,
			timestamp: Date.now(),
			predictionError: null,
			cumulativeError: 0,
			hitCount: 0,
			positiveCount: 0,
			simulated: true,
			verification: "unverified",
			evidenceScore: 0
		};
		this.store.addExperience(exp);
		await this.store.flush();
		return {
			expId,
			sar
		};
	}
	/** How many similar history hits anchor one reference derivation. */
	referenceTopK = 5;
	/** Minimum dual-axis similarity for a history hit to anchor a reference. */
	referenceMinSimilarity = .3;
	/**
	* Derive a reference experience from the commonalities of similar history
	* (cold-start online generalization). Retrieves the top similar experiences
	* for the query, asks the LLM route to extract their shared pattern, and
	* writes the result as a retrieval-only simulated candidate that the
	* evidence-replacement lifecycle verifies against real feedback — the same
	* lifecycle as {@link simulate}.
	* @param input - the current situation/action to anchor the derivation.
	* @param call - optional session/signal context.
	* @returns the reference experience id and SAR when derived, or null.
	*/
	async deriveReference(input, call) {
		if (input.situation.trim().length === 0 || input.action.trim().length === 0) throw new CognitivePipelineError("cognitive-pipeline: situation and action must not be empty", "EMPTY_DERIVE_REFERENCE_INPUT");
		const queryVector = actionVector(input.action, []);
		const similar = this.store.experiencesSnapshot().filter((exp) => !exp.simulated).map((exp) => ({
			expId: exp.expId,
			text: `${exp.sar.situation}。${exp.sar.action}。${exp.sar.outcome}`,
			similarity: Math.max(cosine(queryVector, exp.actionVector), cosine(queryVector, actionVector(exp.sar.situation, [])))
		})).filter((hit) => hit.similarity >= this.referenceMinSimilarity).sort((a, b) => b.similarity - a.similarity).slice(0, this.referenceTopK);
		if (similar.length === 0) return null;
		const decision = await deriveReference(this.ctx, this.resolved.route, input, similar, {
			sessionId: call?.sessionId,
			signal: call?.signal
		});
		if (!decision.shouldDerive || decision.sar === null) return null;
		const sar = {
			situation: decision.sar.situation,
			action: decision.sar.action,
			outcome: decision.sar.outcome,
			actionKeywords: [...new Set(tokenize(decision.sar.action))].slice(0, 8),
			outcomeUtility: { ...decision.sar.utility }
		};
		const expId = this.store.nextExpId();
		this.store.addExperience({
			expId,
			sar,
			actionVector: actionVector(sar.action, sar.actionKeywords),
			outcomeVector: outcomeVector(sar.outcomeUtility, sar.outcome),
			clusterId: null,
			strategyLabel: null,
			timestamp: Date.now(),
			predictionError: null,
			cumulativeError: 0,
			hitCount: 0,
			positiveCount: 0,
			simulated: true,
			verification: "unverified",
			evidenceScore: 0
		});
		await this.store.flush();
		return {
			expId,
			sar
		};
	}
	/** Hot-loop prediction.
	* @param input - the situation/action to predict.
	* @param call - optional session/signal context.
	* @returns the calibrated prediction result.
	*/
	async predict(input, call) {
		if (input.situation.trim().length === 0 || input.action.trim().length === 0) throw new CognitivePipelineError("cognitive-pipeline: situation and action must not be empty", "EMPTY_PREDICT_INPUT");
		this.store.expireUnverifiedSimulated(Date.now(), this.resolved.simulationTtlMs);
		const result = await this.hot.predict(input, call?.sessionId, call?.signal);
		this.maybeSynthesizeRetrievalFailure(input, result);
		await this.store.flush();
		return result;
	}
	/**
	* Directly record a pipeline-own (meta) observation without LLM extraction —
	* the structured path for automatic retrieval-failure SAR-ization. Meta
	* experiences with a non-neutral utility join the cold-loop sample, so the
	* pipeline can cluster and learn from its own failure modes.
	* @param input - the structured SAR fields for the observation.
	* @returns the new experience id.
	*/
	rememberMeta(input) {
		const sar = {
			situation: input.situation,
			action: input.action,
			outcome: input.outcome,
			actionKeywords: [...new Set(tokenize(input.action))].slice(0, 8),
			outcomeUtility: { ...input.utility }
		};
		const expId = this.store.nextExpId();
		this.store.addExperience({
			expId,
			sar,
			actionVector: actionVector(sar.action, sar.actionKeywords),
			outcomeVector: outcomeVector(sar.outcomeUtility, sar.outcome),
			clusterId: null,
			strategyLabel: null,
			timestamp: Date.now(),
			predictionError: null,
			cumulativeError: 0,
			hitCount: 0,
			positiveCount: 0,
			simulated: false,
			verification: "verified",
			evidenceScore: 0,
			meta: true
		});
		return expId;
	}
	/**
	* SAR-ize one detected retrieval-routing failure: when the taxonomy routed a
	* known-path query to a cluster with a thin margin (best-minus-second-best
	* cosine below `retrievalFailureMargin`), record a meta experience so the
	* calibration layer can reference "this action had an unreliable routing"
	* and the cold loop can cluster the failure pattern. Deduplicated by action
	* similarity so repeated queries do not spam the store.
	* @param input - the query that produced the prediction.
	* @param result - the prediction result carrying the taxonomy context.
	*/
	maybeSynthesizeRetrievalFailure(input, result) {
		const ctx = result.taxonomyContext;
		if (result.isNovel || ctx.coverage !== "covered" || ctx.cluster === null) return;
		if (ctx.margin >= this.resolved.hot.retrievalFailureMargin) return;
		const queryVector = actionVector(input.action, []);
		if (this.store.experiencesSnapshot().some((exp) => exp.meta === true && cosine(queryVector, exp.actionVector) >= META_DEDUP_COSINE)) return;
		this.rememberMeta({
			situation: `检索路由歧义：情境「${input.situation}」与簇「${ctx.cluster.name}」的余弦余量仅 ${ctx.margin.toFixed(3)}，确定性路由置信低`,
			action: input.action,
			outcome: `同样行动的路由余量低于 ${this.resolved.hot.retrievalFailureMargin}，确定性路由不可靠，应改用 LLM 路由或强化前提判别词`,
			utility: {
				materialGain: 3,
				emotionalValence: 4,
				energyCost: 5
			}
		});
	}
	/**
	* Automatic accumulation: judge one completed turn through the LLM gate and
	* write it as an experience when the route deems it worth it. A deterministic
	* pre-filter (pure chat: no tool calls, no failure, short output) never
	* reaches the per-turn LLM call. Without an explicit route the gate rejects.
	* @param episode - the reconstructed turn material.
	* @param call - optional session/signal context.
	* @returns the new experience id when accumulated, or null.
	*/
	async accumulateTurn(episode, call) {
		const actionText = episode.action.trim();
		const outcomeText = episode.outcome.trim();
		if (!(episode.toolCallCount > 0 || episode.failed || actionText.length >= ACCUMULATE_MIN_ACTION_CHARS || outcomeText.length >= ACCUMULATE_MIN_ACTION_CHARS)) return null;
		const queryVector = actionVector(episode.action, []);
		const similar = this.store.experiencesSnapshot().map((exp) => ({
			expId: exp.expId,
			text: `${exp.sar.situation}。${exp.sar.action}。${exp.sar.outcome}`,
			similarity: Math.max(cosine(queryVector, exp.actionVector), cosine(queryVector, actionVector(exp.sar.situation, [])))
		})).sort((a, b) => b.similarity - a.similarity).slice(0, 3).filter((hit) => hit.similarity >= .3);
		const decision = await evaluateAccumulation(this.ctx, this.resolved.route, {
			situation: episode.situation,
			action: episode.action,
			outcome: episode.outcome
		}, similar, {
			sessionId: call?.sessionId,
			signal: call?.signal
		});
		if (!decision.shouldAccumulate || decision.sar === null) return null;
		const expId = this.store.nextExpId();
		const sar = {
			situation: decision.sar.situation,
			action: decision.sar.action,
			outcome: decision.sar.outcome,
			actionKeywords: [...new Set(tokenize(decision.sar.action))].slice(0, 8),
			outcomeUtility: { ...decision.sar.utility }
		};
		this.store.addExperience({
			expId,
			sar,
			actionVector: actionVector(sar.action, sar.actionKeywords),
			outcomeVector: outcomeVector(sar.outcomeUtility, sar.outcome),
			clusterId: null,
			strategyLabel: null,
			timestamp: Date.now(),
			predictionError: null,
			cumulativeError: 0,
			hitCount: 0,
			positiveCount: 0,
			simulated: false,
			verification: "verified",
			evidenceScore: 0
		});
		return expId;
	}
	/** Feedback loop: resolve a prediction, update calibration and scratchpad.
	* @param input - the prediction id and actual outcome.
	* @param call - optional session/signal context.
	* @returns the logged feedback result.
	*/
	async report(input, call) {
		const prediction = this.store.getPrediction(input.predictionId);
		if (prediction === void 0) throw new CognitivePipelineError(`cognitive-pipeline: prediction "${input.predictionId}" not found`, "PREDICTION_NOT_FOUND");
		if (prediction.resolvedAt !== null) throw new CognitivePipelineError(`cognitive-pipeline: prediction "${input.predictionId}" is already resolved`, "PREDICTION_ALREADY_RESOLVED");
		const observed = this.observedOutcome(input);
		const error = Math.abs(prediction.calibratedProbability - observed);
		this.hot.learnFromFeedback(prediction, error);
		this.store.resolvePrediction(input.predictionId, input.actualOutcome, error, input.outcomeQuality);
		this.store.recordCalibration(prediction.calibratedProbability, observed >= .5);
		if (prediction.expId !== null) {
			const bound = this.store.getExperience(prediction.expId);
			if (bound !== void 0 && bound.simulated) {
				const decisiveness = Math.abs(input.outcomeQuality - 5) / 5;
				const contradictory = bound.verification === "provisional" && observed >= .5 !== bound.sar.outcomeUtility.materialGain > 5;
				this.store.applyFeedbackEvidence(prediction.expId, decisiveness, contradictory, this.resolved.simulationFastTrackThreshold, this.resolved.simulationPermanentThreshold);
			}
		}
		let rebuildReason = null;
		if (prediction.usedTempStrategy) this.feedbackTempStrategy(prediction.action, observed);
		let triggerRebuild = false;
		if (error >= this.resolved.emergencyErrorThreshold) {
			triggerRebuild = true;
			rebuildReason = `预测误差 ${error.toFixed(3)} 超过紧急阈值 ${this.resolved.emergencyErrorThreshold}，触发局部修补`;
			await this.cold.runRebuild("local", call?.sessionId, call?.signal);
		}
		await this.store.flush();
		return {
			status: "logged",
			predictionError: error,
			triggerRebuild,
			rebuildReason
		};
	}
	/** Cold-loop rebuild.
	* @param scope - local or global.
	* @param call - optional session/signal context.
	* @returns the backtested rebuild outcome.
	*/
	async rebuild(scope, call) {
		const result = await this.cold.runRebuild(scope, call?.sessionId, call?.signal);
		await this.store.flush();
		return result;
	}
	/** Observational snapshot for the inspect tool.
	* @returns counts, clusters, calibration, taxonomy, and recent resolved predictions.
	*/
	inspect() {
		const stats = this.store.stats();
		const recentResolved = this.store.predictionsSnapshot().filter((prediction) => prediction.resolvedAt !== null).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 10);
		return {
			experienceCount: stats.experienceCount,
			predictionCount: stats.predictionCount,
			resolvedPredictionCount: stats.resolvedPredictionCount,
			clusterCount: this.store.clustersSnapshot().length,
			activeTempStrategyCount: this.store.tempStrategiesSnapshot().filter((strategy) => strategy.status === "active").length,
			calibrationBuckets: this.store.calibrationBucketsSnapshot(),
			channelWeights: this.store.channelWeightsSnapshot(),
			taxonomy: this.store.taxonomySnapshot() ?? {
				version: 0,
				summaryShort: "（尚未完成首次重构）",
				rules: [],
				updatedAt: 0
			},
			recentResolved
		};
	}
	/** The dynamic cognition prefix for the system-prompt section.
	* @returns the 附录B prefix text.
	*/
	taxonomyPrefix() {
		return cognitionPrefix(this.store.taxonomySnapshot());
	}
	/** All clusters (public for inspection).
	* @returns a detached cluster list.
	*/
	clusters() {
		return this.store.clustersSnapshot();
	}
	/** All calibration buckets (public for inspection).
	* @returns a detached bucket table.
	*/
	calibrationBuckets() {
		return this.store.calibrationBucketsSnapshot();
	}
	/** Current taxonomy (public for inspection).
	* @returns the taxonomy, or null before the first rebuild.
	*/
	taxonomy() {
		return this.store.taxonomySnapshot();
	}
	/** Active + graduated scratchpad strategies (public for inspection).
	* @returns a detached strategy list.
	*/
	tempStrategies() {
		return this.store.tempStrategiesSnapshot();
	}
	/** Map an actual outcome to a 0–1 observed value. */
	observedOutcome(input) {
		if (!Number.isFinite(input.outcomeQuality)) throw new CognitivePipelineError("cognitive-pipeline: outcomeQuality must be a finite number", "INVALID_OUTCOME_QUALITY");
		return Math.min(1, Math.max(0, input.outcomeQuality / 10));
	}
	/** Record scratchpad feedback and graduate qualifying strategies. */
	feedbackTempStrategy(action, observed) {
		const strategies = this.store.tempStrategiesSnapshot().filter((strategy) => strategy.status === "active" && strategy.trialAction === action);
		for (const strategy of strategies) {
			const positiveCount = strategy.positiveCount + (observed >= .5 ? 1 : 0);
			const hitCount = strategy.hitCount;
			const ratio = hitCount === 0 ? 0 : positiveCount / hitCount;
			const graduated = hitCount >= this.resolved.tempStrategyHitThreshold && ratio >= this.resolved.tempStrategyPositiveRatio;
			this.store.updateTempStrategy(strategy.signatureHash, {
				positiveCount,
				pendingResult: observed >= .5 ? "positive" : "negative",
				...graduated ? { status: "graduated" } : {}
			});
			if (graduated) this.ctx.logger.info(`cognitive-pipeline: 临时策略 ${strategy.signatureHash} 晋升为主库种子（命中${hitCount}次，正反馈率${(ratio * 100).toFixed(0)}%）`);
		}
	}
};
//#endregion
//#region lib/types/tools.js
/**
* Model-facing tools over the cognitive pipeline: `remember_experience`,
* `simulate_experience`, `predict_outcome`, `report_outcome`,
* `rebuild_taxonomy`, and `inspect_memory`. Every tool returns one canonical
* JSON value; `output.render` mirrors it into model-facing text.
* @module @deepseek-ai/dsh-cognitive-pipeline/tools
*/
/** Build the model-call context from the executing agent's session. */
function callContext(exec) {
	return exec.agent === void 0 ? {} : { sessionId: exec.agent.session.id };
}
/** One canonical text renderer shared by all tools. */
function renderJson(_args, value) {
	return [{
		type: "text",
		text: JSON.stringify(value)
	}];
}
/** Register the six pipeline tools.
* @param ctx - context with the tool registry.
* @param service - the pipeline service backing the tools.
*/
function registerPipelineTools(ctx, service) {
	ctx.tools.register(defineTool({
		name: "remember_experience",
		description: "Encode one raw experience (a past situation, the action taken, and its outcome) into the cognitive pipeline SAR memory. The pipeline extracts situation/action/outcome, scores the outcome utility (material gain, emotional valence, energy cost 0-10), and vectorizes both the action and the outcome for later retrieval and utility-space clustering. Call this when the user shares a completed experience that should inform future predictions.",
		parameters: { raw_text: {
			type: "string",
			required: true,
			description: "The raw experience text describing situation, action, and result."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					exp_id: {
						type: "string",
						required: true
					},
					situation: {
						type: "string",
						required: true
					},
					action: {
						type: "string",
						required: true
					},
					outcome: {
						type: "string",
						required: true
					},
					outcome_utility: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							material_gain: {
								type: "number",
								required: true
							},
							emotional_valence: {
								type: "number",
								required: true
							},
							energy_cost: {
								type: "number",
								required: true
							}
						}
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const { expId, sar } = await service.remember({ rawText: args.raw_text }, {
				...callContext(exec),
				signal: exec.signal
			});
			return {
				exp_id: expId,
				situation: sar.situation,
				action: sar.action,
				outcome: sar.outcome,
				outcome_utility: {
					material_gain: sar.outcomeUtility.materialGain,
					emotional_valence: sar.outcomeUtility.emotionalValence,
					energy_cost: sar.outcomeUtility.energyCost
				}
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Remember experience",
			kind: "other",
			rawInput: args.raw_text
		})
	}));
	ctx.tools.register(defineTool({
		name: "simulate_experience",
		description: "Generate a simulated experience via the LLM route: given a hypothetical situation and a proposed action, produce a predicted outcome as a retrieval-only candidate. The simulation shapes no cluster until real feedback through report_outcome verifies it (a decisive single feedback fast-tracks, cumulative evidence upgrades, contradiction rolls back, and unverified simulations expire after the fallback TTL). Use this when real testing is costly or impossible and a reasoned projection would help prediction.",
		parameters: {
			situation: {
				type: "string",
				required: true,
				description: "The hypothetical situation to reason about."
			},
			action: {
				type: "string",
				required: true,
				description: "The proposed action whose outcome is to be simulated."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					exp_id: {
						type: "string",
						required: true
					},
					situation: {
						type: "string",
						required: true
					},
					action: {
						type: "string",
						required: true
					},
					outcome: {
						type: "string",
						required: true
					},
					simulated: {
						type: "boolean",
						required: true
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const { expId, sar } = await service.simulate({
				situation: args.situation,
				action: args.action
			}, {
				...callContext(exec),
				signal: exec.signal
			});
			return {
				exp_id: expId,
				situation: sar.situation,
				action: sar.action,
				outcome: sar.outcome,
				simulated: true
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Simulate experience",
			kind: "other",
			rawInput: args.action
		})
	}));
	ctx.tools.register(defineTool({
		name: "reference_experience",
		description: "Derive a reference experience from the commonalities of similar history (cold-start online generalization): given the current situation and proposed action, retrieve the most similar past experiences, ask the LLM route to extract their shared pattern, and write it as a retrieval-only simulated candidate. It shapes no cluster until real feedback through report_outcome verifies it (the same evidence-replacement lifecycle as simulate_experience). Use this when the store has only a few similar experiences and a generalized \"how these situations usually resolve\" reference would help prediction.",
		parameters: {
			situation: {
				type: "string",
				required: true,
				description: "The current situation to anchor the reference derivation."
			},
			action: {
				type: "string",
				required: true,
				description: "The proposed action whose similar-history pattern to generalize."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					exp_id: {
						type: "string",
						required: true
					},
					situation: {
						type: "string",
						required: true
					},
					action: {
						type: "string",
						required: true
					},
					outcome: {
						type: "string",
						required: true
					},
					simulated: {
						type: "boolean",
						required: true
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const result = await service.deriveReference({
				situation: args.situation,
				action: args.action
			}, {
				...callContext(exec),
				signal: exec.signal
			});
			if (result === null) throw new Error("reference_experience: no common pattern derivable from similar history");
			return {
				exp_id: result.expId,
				situation: result.sar.situation,
				action: result.sar.action,
				outcome: result.sar.outcome,
				simulated: true
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Derive reference experience",
			kind: "other",
			rawInput: args.action
		})
	}));
	ctx.tools.register(defineTool({
		name: "predict_outcome",
		description: "Hot-loop prediction: given a situation and a proposed action, retrieve similar past actions, detect distribution shift (OOD), and produce a calibrated success probability with an 80% confidence interval. Novel actions trigger a scratchpad trial strategy instead of reusing old categories. When the situation matches a proven success cluster, success_reference returns that strategy to reuse. The returned prediction_id must be reported back through report_outcome once the actual result is known so the pipeline can learn from the error.",
		parameters: {
			situation: {
				type: "string",
				required: true,
				description: "The current situation context."
			},
			action: {
				type: "string",
				required: true,
				description: "The proposed action to predict the outcome of."
			},
			context: {
				type: "string",
				description: "Optional extra context folded into the calibration prompt."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					prediction_id: {
						type: "string",
						required: true
					},
					advice: {
						type: "string",
						required: true
					},
					raw_probability: {
						type: "number",
						required: true
					},
					calibrated_probability: {
						type: "number",
						required: true
					},
					confidence_interval_low: {
						type: "number",
						required: true
					},
					confidence_interval_high: {
						type: "number",
						required: true
					},
					is_novel: {
						type: "boolean",
						required: true
					},
					ood_signal: {
						type: "string",
						required: true,
						enum: [
							"none",
							"low-similarity",
							"flat-top",
							"high-strangeness"
						]
					},
					top_hit_count: {
						type: "number",
						required: true
					},
					used_temp_strategy: {
						type: "boolean",
						required: true
					},
					cluster_id: {
						required: true,
						oneOf: [{ type: "number" }, { type: "null" }]
					},
					success_reference: {
						required: true,
						oneOf: [{
							type: "object",
							additionalProperties: false,
							properties: {
								cluster_id: {
									type: "number",
									required: true
								},
								cluster_name: {
									type: "string",
									required: true
								},
								decision_rule: {
									type: "string",
									required: true
								},
								utility_range: {
									type: "object",
									additionalProperties: false,
									required: true,
									properties: {
										low: {
											type: "number",
											required: true
										},
										high: {
											type: "number",
											required: true
										}
									}
								}
							}
						}, { type: "null" }]
					},
					taxonomy_context: {
						required: true,
						type: "object",
						additionalProperties: false,
						properties: {
							coverage: {
								type: "string",
								required: true,
								enum: [
									"covered",
									"gap",
									"no-taxonomy"
								]
							},
							similarity: {
								type: "number",
								required: true
							},
							margin: {
								type: "number",
								required: true
							},
							cluster: {
								required: true,
								oneOf: [{
									type: "object",
									additionalProperties: false,
									properties: {
										cluster_id: {
											type: "number",
											required: true
										},
										name: {
											type: "string",
											required: true
										},
										decision_rule: {
											type: "string",
											required: true
										},
										polarity: {
											type: "string",
											required: true,
											enum: ["success", "risk"]
										}
									}
								}, { type: "null" }]
							}
						}
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const input = {
				situation: args.situation,
				action: args.action,
				...args.context === void 0 || args.context.length === 0 ? {} : { context: args.context }
			};
			const result = await service.predict(input, {
				...callContext(exec),
				signal: exec.signal
			});
			return {
				prediction_id: result.predictionId,
				advice: result.advice,
				raw_probability: result.rawProbability,
				calibrated_probability: result.calibratedProbability,
				confidence_interval_low: result.confidenceLow,
				confidence_interval_high: result.confidenceHigh,
				is_novel: result.isNovel,
				ood_signal: result.oodSignal,
				top_hit_count: result.topHitCount,
				used_temp_strategy: result.usedTempStrategy,
				cluster_id: result.clusterId,
				success_reference: result.successReference === null ? null : {
					cluster_id: result.successReference.clusterId,
					cluster_name: result.successReference.clusterName,
					decision_rule: result.successReference.decisionRule,
					utility_range: { ...result.successReference.utilityRange }
				},
				taxonomy_context: {
					coverage: result.taxonomyContext.coverage,
					similarity: result.taxonomyContext.similarity,
					margin: result.taxonomyContext.margin,
					cluster: result.taxonomyContext.cluster === null ? null : {
						cluster_id: result.taxonomyContext.cluster.clusterId,
						name: result.taxonomyContext.cluster.name,
						decision_rule: result.taxonomyContext.cluster.decisionRule,
						polarity: result.taxonomyContext.cluster.polarity
					}
				}
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Predict outcome",
			kind: "other",
			rawInput: args.action
		})
	}));
	ctx.tools.register(defineTool({
		name: "report_outcome",
		description: "Feedback callback: report the actual outcome of a previous predict_outcome call. The pipeline computes the prediction error, updates lifetime calibration statistics, feeds the scratchpad when a trial strategy was used, and triggers an emergency local taxonomy repair when the error is extreme. outcome_quality (0-10) is required so every resolved prediction carries a real utility signal; a neutral baseline is never inferred from the outcome text.",
		parameters: {
			prediction_id: {
				type: "string",
				required: true,
				description: "The prediction_id returned by predict_outcome."
			},
			actual_outcome: {
				type: "string",
				required: true,
				description: "The observed result text."
			},
			outcome_quality: {
				type: "number",
				required: true,
				description: "Actual outcome quality 0-10 (5 = neutral). Required for a real utility signal."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						required: true,
						enum: ["logged"]
					},
					prediction_error: {
						type: "number",
						required: true
					},
					trigger_rebuild: {
						type: "boolean",
						required: true
					},
					rebuild_reason: {
						required: true,
						oneOf: [{ type: "string" }, { type: "null" }]
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const result = await service.report({
				predictionId: args.prediction_id,
				actualOutcome: args.actual_outcome,
				outcomeQuality: args.outcome_quality
			}, {
				...callContext(exec),
				signal: exec.signal
			});
			return {
				status: result.status,
				prediction_error: result.predictionError,
				trigger_rebuild: result.triggerRebuild,
				rebuild_reason: result.rebuildReason
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Report outcome",
			kind: "other",
			rawInput: args.prediction_id
		})
	}));
	ctx.tools.register(defineTool({
		name: "rebuild_taxonomy",
		description: "Cold-loop taxonomy rebuild: sample decay-weighted high-error experiences, re-cluster them in utility space, anchor new clusters with evidence (≥3 distinct experience ids, backend-verified), backtest the proposal on the newest slice, and write it back only when it cuts validation error by at least 15%. Use scope \"global\" for a full rebuild or \"local\" to repair only the worst cluster. The resulting taxonomy summary is injected into the session system prompt.",
		parameters: { scope: {
			type: "string",
			enum: ["local", "global"],
			description: "Rebuild scope; default global."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					scope: {
						type: "string",
						required: true,
						enum: ["local", "global"]
					},
					accepted: {
						type: "boolean",
						required: true
					},
					deferred: {
						type: "boolean",
						required: true
					},
					old_error: {
						required: true,
						oneOf: [{ type: "number" }, { type: "null" }]
					},
					new_error: {
						required: true,
						oneOf: [{ type: "number" }, { type: "null" }]
					},
					delta_error: {
						required: true,
						oneOf: [{ type: "number" }, { type: "null" }]
					},
					cluster_count: {
						type: "number",
						required: true
					},
					rejected_clusters: {
						type: "number",
						required: true
					},
					sample_count: {
						type: "number",
						required: true
					},
					reason: {
						type: "string",
						required: true
					},
					taxonomy_version: {
						type: "number",
						required: true
					}
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const result = await service.rebuild(args.scope ?? "global", {
				...callContext(exec),
				signal: exec.signal
			});
			return {
				scope: result.scope,
				accepted: result.accepted,
				deferred: result.deferred,
				old_error: result.oldError,
				new_error: result.newError,
				delta_error: result.deltaError,
				cluster_count: result.clusterCount,
				rejected_clusters: result.rejectedClusters,
				sample_count: result.sampleCount,
				reason: result.reason,
				taxonomy_version: result.taxonomyVersion
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Rebuild taxonomy (${args.scope ?? "global"})`,
			kind: "other"
		})
	}));
	ctx.tools.register(defineTool({
		name: "inspect_memory",
		description: "Read the cognitive pipeline state: stored experience and prediction counts, clusters, calibration buckets, active scratchpad strategies, the current taxonomy summary, and the most recent resolved predictions. Use it to understand what the pipeline has learned and how calibrated it is.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					experience_count: {
						type: "number",
						required: true
					},
					prediction_count: {
						type: "number",
						required: true
					},
					resolved_prediction_count: {
						type: "number",
						required: true
					},
					cluster_count: {
						type: "number",
						required: true
					},
					active_temp_strategy_count: {
						type: "number",
						required: true
					},
					channel_weights: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							semantic: {
								type: "number",
								required: true
							},
							situational: {
								type: "number",
								required: true
							},
							symptom: {
								type: "number",
								required: true
							},
							outcome: {
								type: "number",
								required: true
							}
						}
					},
					taxonomy: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							version: {
								type: "number",
								required: true
							},
							summary_short: {
								type: "string",
								required: true
							},
							updated_at: {
								type: "number",
								required: true
							}
						}
					}
				}
			},
			render: renderJson
		},
		execute(_args, _exec) {
			const result = service.inspect();
			return Promise.resolve({
				experience_count: result.experienceCount,
				prediction_count: result.predictionCount,
				resolved_prediction_count: result.resolvedPredictionCount,
				cluster_count: result.clusterCount,
				active_temp_strategy_count: result.activeTempStrategyCount,
				channel_weights: {
					semantic: result.channelWeights.semantic,
					situational: result.channelWeights.situational,
					symptom: result.channelWeights.symptom,
					outcome: result.channelWeights.outcome
				},
				taxonomy: {
					version: result.taxonomy.version,
					summary_short: result.taxonomy.summaryShort,
					updated_at: result.taxonomy.updatedAt
				}
			});
		},
		presentCall: () => ({
			card: "generic",
			title: "Inspect cognitive memory",
			kind: "read"
		})
	}));
}
//#endregion
//#region lib/types/index.js
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
/** Stable Cordis plugin name. */
const name = "cognitive-pipeline";
/** Services required before the pipeline can mount. */
const inject = [
	"llm",
	"tools",
	"systemPrompt"
];
/** Reconstruct one completed turn into candidate accumulation material.
* Reads the turn's events back from the session ledger: the genuine user
* request (source kind 'user') becomes the situation, tool calls become the
* action, the final assistant text and the end reason become the outcome.
* @param session - the session whose ledger holds the turn's events.
* @param endEvent - the turn/end event that closes the turn.
* @returns the reconstructed episode.
*/
function reconstructTurn(session, endEvent) {
	const turn = endEvent.data.turn;
	const events = session.events;
	const texts = [];
	const actions = [];
	const outcomes = [];
	let toolCallCount = 0;
	let failed = false;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "turn/start" && event.data.turn === turn) break;
		const data = event.data;
		switch (event.type) {
			case "user/message": {
				if (data.source?.kind !== "user") break;
				const text = data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ");
				if (text !== void 0 && text.trim().length > 0) texts.push(text);
				break;
			}
			case "assistant/message": {
				const text = data.message?.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ");
				if (text !== void 0 && text.trim().length > 0) outcomes.push(text);
				break;
			}
			case "tool/call": {
				toolCallCount += 1;
				const name = typeof data.name === "string" ? data.name : "?";
				actions.push(`调用 ${name}`);
				break;
			}
			case "tool/result":
				if (data.message?.content?.some((block) => block.isError === true) === true || data.error !== void 0) failed = true;
				break;
			default: break;
		}
	}
	const reason = endEvent.data.reason?.kind ?? "unknown";
	const outcome = [...outcomes, `轮次结束（${reason}）`].join(" ").trim();
	return {
		situation: texts.reverse().join(" ").slice(0, 800),
		action: actions.reverse().join("；").slice(0, 800) || outcome.slice(0, 300),
		outcome: outcome.slice(0, 800),
		toolCallCount,
		failed,
		turnId: turn
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
async function apply(ctx, config = {}) {
	const service = new CognitivePipelineService(ctx, config);
	await service.ready();
	ctx.systemPrompt.section({
		name: "cognition:taxonomy",
		order: 300,
		text: () => service.taxonomyPrefix()
	});
	if (service.resolved.enabled) registerPipelineTools(ctx, service);
	if (service.resolved.autoAccumulate) ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		const reason = event.data.reason?.kind;
		if (reason !== "completed" && reason !== "error") return;
		const episode = reconstructTurn(session, event);
		if (episode.situation.trim().length === 0) return;
		service.accumulateTurn(episode).catch((error) => {
			ctx.logger.warn(`cognitive-pipeline: automatic accumulation failed: ${String(error)}`);
		});
	});
}
//#endregion
export { ACTION_VECTOR_DIM, CognitivePipelineService, Config, OUTCOME_VECTOR_DIM, SYMPTOM_MARKERS, UTILITY_SLOTS, actionVector, apply, cosine, hashToken, inject, isPositiveOutcome, name, normalize, outcomePolarity, outcomeVector, reconstructTurn, signatureHash, symptomOverlap, tokenize, utilityScore };
