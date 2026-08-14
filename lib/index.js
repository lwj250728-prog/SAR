import { a as cosine, c as normalize, d as tokenize, f as utilityScore, i as actionVector, l as outcomeVector, n as OUTCOME_VECTOR_DIM, o as hashToken, r as UTILITY_SLOTS, s as isPositiveOutcome, t as ACTION_VECTOR_DIM, u as signatureHash } from "./vectorizer-3rXi9865.js";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { BlockAssembler, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
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
	"1. 情境（S）：客观约束，不含主观情绪（如\"老板深夜发来修改意见\"）。",
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
	"1. 放弃旧标签，完全基于这些样本的结果效用评分（outcome_utility_score）的相似性，重新聚类。",
	"2. 每个新簇必须拥有鲜明的策略导向。标签命名格式必须为：\"当【触发条件】出现，应【采用行动姿态】，预期获得【效用区间】\"。",
	"【硬性约束（防幻觉锁）】：",
	"- 每创建一个新簇，必须从提供的样本中引用至少3个不同的exp_id作为支撑证据。",
	"- 禁止将仅出现1次的孤立事件设为一个新簇；若无法找到3个支撑证据，请将该样本归类至\"噪声/偶发池\"并忽略。",
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
` + samples.map((sample) => `- ${sample.expId}: 关键词[${sample.actionKeywords}] 效用(${sample.utility})`).join("\n");
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
	const ruleLines = taxonomy.rules.map((rule, index) => `   - 规则${String.fromCharCode(65 + index)}：若 ${rule.condition} → 推荐 ${rule.action}，预期效用 ${rule.utilityRange.low}~${rule.utilityRange.high}`);
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
/** Deterministic template-1 fallback: split sentences, neutral utility. */
function sarFallback(rawText) {
	const sentences = rawText.split(/(?<=[。！？!?.])\s*/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
	const situation = sentences[0] ?? rawText.slice(0, 80);
	const action = sentences[1] ?? rawText.slice(0, 80);
	return {
		situation,
		action,
		outcome: sentences.slice(2).join(" ") || rawText.slice(0, 120),
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
		return {
			situation: parsed.situation,
			action: parsed.action,
			outcome: parsed.outcome,
			actionKeywords: keywords.length > 0 ? keywords : [...new Set(tokenize(parsed.action))].slice(0, 8),
			outcomeUtility: {
				materialGain: clampUtility(Number(utility?.material_gain)),
				emotionalValence: clampUtility(Number(utility?.emotional_valence)),
				energyCost: clampUtility(Number(utility?.energy_cost))
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
function centroidOf(vectors) {
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
			centroid: centroidOf(mergedMembers.map((index) => vectors[index]).filter((vector) => vector !== void 0)),
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
		const validationSize = Math.max(1, Math.floor(sampled.length * this.config.validationRatio));
		const validation = sampled.slice(sampled.length - validationSize);
		const train = sampled.slice(0, sampled.length - validationSize);
		const groups = agglomerate(train.map((exp) => exp.outcomeVector), this.config.clusterMergeCosine).filter((group) => group.memberIndices.length >= this.config.evidenceMinCount);
		const groupsWithUtility = groups.map((group) => {
			const members = group.memberIndices.map((index) => train[index]).filter((exp) => exp !== void 0);
			return {
				evidenceIds: members.map((exp) => exp.expId),
				meanUtility: meanUtility(members)
			};
		});
		const summaryShort = this.composeGroupSummary(groups.length, groupsWithUtility);
		const reconstruct = await reconstructTaxonomy(this.ctx, this.route, train, groupsWithUtility, summaryShort, {
			sessionId,
			signal
		});
		const byId = new Map(all.map((exp) => [exp.expId, exp]));
		const candidates = reconstruct.newClusters.map((cluster) => {
			const evidence = cluster.supportingEvidenceIds.map((id) => byId.get(id)).filter((exp) => exp !== void 0);
			return {
				name: cluster.clusterName,
				decisionRule: cluster.decisionRule,
				expectedUtilityRange: cluster.expectedUtilityRange,
				evidenceIds: cluster.supportingEvidenceIds,
				fallbackAction: cluster.fallbackAction,
				centroid: centroidOf(evidence.map((exp) => exp.outcomeVector)),
				meanUtility: meanUtility(evidence)
			};
		});
		let rejectedClusters = 0;
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
		if (reconstruct.newClusters.length === 0 && groupsWithUtility.length > 0) this.ctx.logger.warn("cognitive-pipeline: 重构返回0个簇，将本轮样本标记为极端异常以提升下轮采样权重");
		const finalCandidates = verified.length > 0 ? verified : this.fallbackCandidates(groupsWithUtility, byId);
		const oldViews = this.clusterViews(all, this.store.clustersSnapshot());
		const newViews = finalCandidates.map((candidate) => ({
			centroid: candidate.centroid,
			meanUtility: candidate.meanUtility
		}));
		const oldError = this.evaluateViews(all, train, validation, oldViews);
		const newError = this.evaluateViews(all, train, validation, newViews);
		const deltaError = oldError === null || oldError <= 1e-9 || newError === null ? null : (newError - oldError) / oldError;
		const accepted = newError !== null && (oldError === null ? newError <= 1e-9 : deltaError !== null && deltaError <= -this.config.sandboxImprovement);
		const taxonomyVersion = (this.store.taxonomySnapshot()?.version ?? 0) + (accepted ? 1 : 0);
		const reason = accepted ? `沙盒验证通过：新误差 ${newError.toFixed(3)} ≤ 旧误差 ${oldError?.toFixed(3) ?? "—"} × ${(1 - this.config.sandboxImprovement).toFixed(2)}` : deltaError === null ? oldError !== null && oldError <= 1e-9 ? "旧分类已接近完美（验证误差≈0），无需进一步重构" : "无旧分类基线，跳过回写" : `沙盒验证未达标：新误差 ${newError?.toFixed(3) ?? "—"} vs 旧误差 ${oldError?.toFixed(3) ?? "—"}（需降低≥${Math.round(this.config.sandboxImprovement * 100)}%）`;
		if (accepted) {
			this.writeBack(finalCandidates, taxonomyVersion, all, reconstruct.taxonomySummaryShort);
			return {
				scope,
				accepted: true,
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
				const actual = isPositiveOutcome(exp.sar.outcomeUtility) ? 1 : 0;
				const error = Math.abs((predicted[index] ?? .5) - actual);
				if (error >= this.config.predictionErrorThreshold) this.store.updateExperience(exp.expId, { cumulativeError: exp.cumulativeError + error });
			});
		}
		return {
			scope,
			accepted: false,
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
	/** Decay-weighted, error-preferring sample selection (≤ maxSampleRatio). */
	sample(all, scope) {
		const now = Date.now();
		const day = 1440 * 60 * 1e3;
		const candidates = all.filter((exp) => {
			const days = Math.max(0, (now - exp.timestamp) / day);
			if (Math.exp(-this.config.decayLambda * days) < this.config.minDecayWeight) return false;
			return (exp.predictionError ?? 0) >= this.config.predictionErrorThreshold || exp.cumulativeError > 0;
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
		return [...candidates].sort((a, b) => b.cumulativeError + (b.predictionError ?? 0) - (a.cumulativeError + (a.predictionError ?? 0))).slice(0, budget);
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
				centroid: centroidOf(evidence.map((exp) => exp.outcomeVector)),
				meanUtility: mean
			};
		});
	}
	/** ≤30-char summary of the rebuild's logical change from group statistics. */
	composeGroupSummary(groupCount, groups) {
		const tones = groups.map((group) => meanUtilityScore(group.meanUtility) > 0 ? "正效" : "负效");
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
				centroid: centroidOf(evidence.map((exp) => exp.outcomeVector)),
				meanUtility: meanUtility(evidence)
			});
		}
		return views;
	}
	/** Predict 0/1 positivity for each validation experience under a taxonomy. */
	predictionsFor(train, taxonomy, validation) {
		const baseRate = train.length === 0 ? .5 : train.filter((exp) => isPositiveOutcome(exp.sar.outcomeUtility)).length / train.length;
		return validation.map((exp) => {
			let best = -1;
			let bestScore = this.config.clusterMatchCosine;
			for (const view of taxonomy) {
				const score = cosine(exp.outcomeVector, view.centroid);
				if (score >= bestScore) {
					bestScore = score;
					best = meanUtilityScore(view.meanUtility) > 0 ? 1 : 0;
				}
			}
			return best < 0 ? baseRate : best;
		});
	}
	/** Mean absolute error of a taxonomy over the validation slice. */
	evaluateViews(all, train, validation, taxonomy) {
		if (validation.length === 0) return null;
		const predicted = this.predictionsFor(train, taxonomy, validation);
		let error = 0;
		for (let index = 0; index < validation.length; index += 1) {
			const exp = validation[index];
			const actual = isPositiveOutcome(exp.sar.outcomeUtility) ? 1 : 0;
			error += Math.abs((predicted[index] ?? .5) - actual);
		}
		return error / validation.length;
	}
	/** Apply the accepted taxonomy: new clusters, assignments, summary, rules. */
	writeBack(candidates, taxonomyVersion, all, modelSummaryShort) {
		const now = Date.now();
		const assignments = /* @__PURE__ */ new Map();
		const clusters = [];
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
				cumPredictionError: cumError
			});
		}
		const byId = new Map(all.map((exp) => [exp.expId, exp]));
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
			utilityRange: { ...cluster.expectedUtilityRange }
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
			const score = cosine(strategyVector, centroidOf(evidence.map((exp) => exp.outcomeVector)));
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
	constructor(ctx, store, config, route) {
		this.ctx = ctx;
		this.store = store;
		this.config = config;
		this.route = route;
	}
	/** Retrieve the top-K experiences by action-vector cosine similarity.
	* @param action - the proposed action text.
	* @param k - how many hits to return.
	* @returns ranked hits, best first.
	*/
	retrieveTopK(action, k) {
		const vector = actionVector(action, []);
		return this.store.experiencesSnapshot().map((exp) => ({
			exp,
			similarity: cosine(vector, exp.actionVector)
		})).sort((a, b) => b.similarity - a.similarity).slice(0, k);
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
		const ranked = this.retrieveTopK(input.action, this.config.topK);
		const { signal: oodSignal, top1 } = this.detectOod(ranked);
		const samples = ranked.map((hit) => hit.exp);
		let isNovel = oodSignal !== "none";
		if (oodSignal !== "none" && ranked.length > 0) isNovel = !(await reviewOod(this.ctx, this.route, input.action, ranked.slice(0, 3).map((hit) => ({
			expId: hit.exp.expId,
			action: hit.exp.sar.action,
			similarity: hit.similarity
		})), !isNovel, {
			sessionId,
			signal
		})).isKnown;
		if (isNovel) return this.predictNovel(input, sessionId, signal, oodSignal, top1);
		return this.predictKnown(input, samples, sessionId, signal, oodSignal, top1);
	}
	/** Novel branch: scratchpad lookup or creation, conservative calibration. */
	async predictNovel(input, sessionId, signal, oodSignal, top1) {
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
			resolvedAt: null
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
			clusterId: null
		};
	}
	/** Familiar branch: five-layer calibration over the top-K samples. */
	async predictKnown(input, samples, sessionId, signal, oodSignal, _top1) {
		const positive = samples.filter((exp) => isPositiveOutcome(exp.sar.outcomeUtility)).length;
		const negative = samples.length - positive;
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
				utility: `${exp.sar.outcomeUtility.materialGain}/${exp.sar.outcomeUtility.emotionalValence}/${exp.sar.outcomeUtility.energyCost}`
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
			resolvedAt: null
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
			clusterId
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
/** The complete persisted state of one pipeline store. */
var CognitiveStore = class {
	root;
	queue = new WriteQueue();
	experiences = /* @__PURE__ */ new Map();
	predictions = /* @__PURE__ */ new Map();
	tempStrategies = /* @__PURE__ */ new Map();
	clusterList = [];
	calibration = emptyBuckets();
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
		const [experiences, predictions, tempStrategies, clusters, calibration, taxonomy] = await Promise.all([
			readFile(this.file("experiences.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("predictions.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("temp_strategies.jsonl"), "utf8").catch(() => ""),
			readFile(this.file("clusters.json"), "utf8").catch(() => ""),
			readFile(this.file("calibration.json"), "utf8").catch(() => ""),
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
			this.predictions.set(prediction.predictionId, prediction);
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
				});
				for (const cluster of this.clusterList) this.nextClusterSeq = Math.max(this.nextClusterSeq, cluster.clusterId + 1);
			}
		}
		const parsedCalibration = calibration === "" ? null : JSON.parse(calibration);
		if (Array.isArray(parsedCalibration) && parsedCalibration.length === 10) this.calibration = parsedCalibration;
		if (taxonomy !== "") {
			const parsed = JSON.parse(taxonomy);
			if (typeof parsed.version === "number") this.taxonomyState = parsed;
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
	* prediction error to the bound experience's cumulative error.
	* @param predictionId - the prediction to resolve.
	* @param actualOutcome - the observed outcome text.
	* @param predictionError - absolute error in [0, 1].
	* @returns the resolved prediction.
	*/
	resolvePrediction(predictionId, actualOutcome, predictionError) {
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
				const next = {
					...exp,
					predictionError,
					cumulativeError: exp.cumulativeError + predictionError
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
	decayLambda: z.number().min(0).default(.01),
	minDecayWeight: z.number().min(0).max(1).default(.1),
	predictionErrorThreshold: z.number().min(0).max(1).default(.3),
	maxSampleRatio: z.number().min(.01).max(1).default(.15),
	evidenceMinCount: z.number().step(1).min(1).default(3),
	evidenceMaxDistance: z.number().min(0).max(1).default(.85),
	sandboxImprovement: z.number().min(0).max(1).default(.15),
	validationRatio: z.number().min(.01).max(.5).default(.2),
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
			tempStrategyTtlMs: config.tempStrategyTtlMs ?? 1440 * 60 * 1e3,
			tempStrategyMatchThreshold: config.tempStrategyMatchThreshold ?? .5
		}),
		cold: Object.freeze({
			decayLambda: config.decayLambda ?? .01,
			minDecayWeight: config.minDecayWeight ?? .1,
			predictionErrorThreshold: config.predictionErrorThreshold ?? .3,
			maxSampleRatio: config.maxSampleRatio ?? .15,
			evidenceMinCount: config.evidenceMinCount ?? 3,
			evidenceMaxDistance: config.evidenceMaxDistance ?? .85,
			sandboxImprovement: config.sandboxImprovement ?? .15,
			validationRatio: config.validationRatio ?? .2,
			clusterMergeCosine: config.clusterMergeCosine ?? .4,
			clusterMatchCosine: config.clusterMatchCosine ?? .3
		}),
		tempStrategyHitThreshold: config.tempStrategyHitThreshold ?? 3,
		tempStrategyPositiveRatio: config.tempStrategyPositiveRatio ?? .667,
		emergencyErrorThreshold: config.emergencyErrorThreshold ?? .8
	});
}
/** Neutral utility marker used to detect "no information" extraction. */
function isNeutralUtility(utility) {
	return utility.materialGain === 5 && utility.emotionalValence === 5 && utility.energyCost === 5;
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
			positiveCount: 0
		};
		this.store.addExperience(exp);
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
		const result = await this.hot.predict(input, call?.sessionId, call?.signal);
		await this.store.flush();
		return result;
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
		const observed = await this.observedOutcome(input, call);
		const error = Math.abs(prediction.calibratedProbability - observed);
		this.store.resolvePrediction(input.predictionId, input.actualOutcome, error);
		this.store.recordCalibration(prediction.calibratedProbability, observed >= .5);
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
	async observedOutcome(input, call) {
		if (input.outcomeQuality !== void 0) {
			if (!Number.isFinite(input.outcomeQuality)) throw new CognitivePipelineError("cognitive-pipeline: outcomeQuality must be a finite number", "INVALID_OUTCOME_QUALITY");
			return Math.min(1, Math.max(0, input.outcomeQuality / 10));
		}
		const sar = await extractSar(this.ctx, this.resolved.route, input.actualOutcome, {
			sessionId: call?.sessionId,
			signal: call?.signal
		});
		if (isNeutralUtility(sar.outcomeUtility)) return .5;
		return isPositiveOutcome(sar.outcomeUtility) ? 1 : 0;
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
* `predict_outcome`, `report_outcome`, `rebuild_taxonomy`, and
* `inspect_memory`. Every tool returns one canonical JSON value; `output.render`
* mirrors it into model-facing text.
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
/** Register the five pipeline tools.
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
		name: "predict_outcome",
		description: "Hot-loop prediction: given a situation and a proposed action, retrieve similar past actions, detect distribution shift (OOD), and produce a calibrated success probability with an 80% confidence interval. Novel actions trigger a scratchpad trial strategy instead of reusing old categories. The returned prediction_id must be reported back through report_outcome once the actual result is known so the pipeline can learn from the error.",
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
				cluster_id: result.clusterId
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
		description: "Feedback callback: report the actual outcome of a previous predict_outcome call. The pipeline computes the prediction error, updates lifetime calibration statistics, feeds the scratchpad when a trial strategy was used, and triggers an emergency local taxonomy repair when the error is extreme. Pass outcome_quality (0-10) when the actual outcome quality is known; otherwise the pipeline extracts it from the outcome text.",
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
				description: "Optional actual outcome quality 0-10 (5 = neutral)."
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
				...args.outcome_quality === void 0 ? {} : { outcomeQuality: args.outcome_quality }
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
* five-layer confidence calibration, a temp-strategy scratchpad, and a
* cold-loop taxonomy rebuild gated by sandbox backtesting. The plugin exposes
* five model-facing tools, the `ctx.cognitivePipeline` service, and a dynamic
* `cognition:taxonomy` system-prompt section.
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
/**
* Mount the pipeline: construct the service (its `Service` base registers
* `ctx.cognitivePipeline` on this fiber's context), wait for the store, then
* register the dynamic taxonomy prompt section and (unless disabled) the
* model tools.
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
}
//#endregion
export { ACTION_VECTOR_DIM, CognitivePipelineService, Config, OUTCOME_VECTOR_DIM, UTILITY_SLOTS, actionVector, apply, cosine, hashToken, inject, isPositiveOutcome, name, normalize, outcomeVector, signatureHash, tokenize, utilityScore };
