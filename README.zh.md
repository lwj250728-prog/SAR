# @deepseek-ai/dsh-cognitive-pipeline

预测误差驱动的动态认知架构（DCA-PED）的 DeepSeek Harness 插件。它赋予智能体一套不断演化的经验记忆：经历被编码为**情境-行动-结果（SAR）**三元组，按行动相似度检索，以**五层校准的置信区间**预测，由**真实反馈**修正，并定期在**效用空间**中重新聚类——只有当沙盒回测证明误差下降 ≥15% 时，重建才会胜出并被回写。

本包是插件的自包含、可发布 npm 形态，并随附原始设计文档（见 [`docs/`](docs/README.md)）。

## 功能

- **热环路** — `predict_outcome`：**多通道融合检索**（语义行动余弦 + 情境结构余弦 + 症状签名重叠 + 失败标记查询下的结果极性优先），通道权重**由反馈误差驱动学习**（`channel_weights.json`，按 `|calibrated − observed|` EWMA），OOD 检测（`Top1 相似度 < 0.65`、`Top1-Top3 方差 < 0.1`（模糊）、`Strangeness Index > 1.5`），低置信路由触发 **LLM 精排**（模板7 剔除不适用 top 命中，有界 `refineMaxDrops` 条），路由到熟路（五层校准）或陌路（临时工作区，带 `⚠️ 全新现象` 标记）。
- **五层校准** — 频次先验注入、样本量收缩 `P_cal = (k/(k+50))·P_raw + (50/(k+50))·0.5`、最小宽度 80% 置信区间、对抗性风险因素列举、终身校准桶修正。
- **冷环路** — `rebuild_taxonomy`：时间衰减采样 `W = e^(−λ·Δt)`、在**结果效用向量**上做层次凝聚聚类、LLM 因果锚定（≥3 证据硬约束 + 后端核验）、沙盒回测要求 `Δerr ≤ −0.15` 才原子回写。
- **反馈闭环** — `report_outcome`：预测误差、校准统计、临时策略晋升、紧急局部修补。
- 未配置 LLM 路由时，每一步模型辅助都会降级为确定性数学。

## 安装

### 作为 DeepSeek Harness 插件（npm）

发布后，在任何 dsh profile 中安装并启用：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-cognitive-pipeline
```

该命令会把包加入 profile 清单并运行其 pnpm 安装；随后在 profile 的 patch 层引用它：

```yaml
# <dshHome>/profiles/web/cordis.patch.yml
- insert:
    - id: cognitive-pipeline
      name: '@deepseek-ai/dsh-cognitive-pipeline'
      config:
        root: !!js dshHomePath('cognitive-pipeline')
        # 复用 DSH 自身的 LLM 路由与凭据——无需单独配置 API key。
        # 省略 provider/model（或路由不可达）时为确定性模式。见 examples/cordis.patch.yml。
        provider: deepseek-official
        model: deepseek-v4-flash
```

或者加入任意 Cordis 组合：

```sh
pnpm add @deepseek-ai/dsh-cognitive-pipeline
```

可直接使用的 patch 片段见 [`examples/cordis.patch.yml`](examples/cordis.patch.yml)。LLM 路由复用 DSH 自身的凭据（如 `DEEPSEEK_API_KEY`），插件侧无需额外配置。

### 源码方式（开发）

把本包复制进 DeepSeek Harness 检出并注册：

```sh
cp -r src <dsh>/packages/cognition/cognitive-pipeline/src
# 然后在检出内：pnpm install && pnpm run build:lib:host
```

## 使用

模型获得七个工具：

- `remember_experience` — 把原始经历编码进 SAR 记忆。
- `predict_outcome` — 带 80% 区间的校准预测；返回 `prediction_id`。
- `report_outcome` — 回填实际结果（可选 `outcome_quality` 0–10）。
- `rebuild_taxonomy` — 运行冷环路（`scope: local | global`）。
- `inspect_memory` — 查看经验、簇、校准桶与分类法摘要。
- `simulate_experience` — 在真实测试成本高或不可行时生成仅检索的模拟候选。
- `reference_experience` — 把最相似历史经验的共同模式泛化为仅检索的参考候选（冷启动在线泛化）；无相似锚点时拒绝派生。

插件还提供 `ctx.cognitivePipeline` 服务与动态 `cognition:taxonomy` System Prompt 小节。确切的服务 API 见 [`src/service.ts`](src/service.ts)。

## 配置

全部字段可选；引擎默认值遵循设计文档。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `root` | `<dshHome>/cognitive-pipeline` | 存储目录（JSONL + JSON 状态文件） |
| `provider` / `model` | 未设置 | 显式 LLM 路由（须成对设置） |
| `enabled` | `true` | 为 false 时保留服务但不注册工具 |
| `topK` | `10` | 热环路检索深度 |
| `oodSimThreshold` | `0.65` | OOD 低相似度阈值 |
| `oodFlatThreshold` | `0.1` | OOD 平坦度（Top1-Top3）阈值 |
| `oodSiThreshold` | `1.5` | OOD 陌生指数阈值 |
| `tempStrategyTtlMs` | `86_400_000` | 临时策略 TTL |
| `tempStrategyHitThreshold` | `3` | 晋升所需命中次数 |
| `tempStrategyPositiveRatio` | `0.667` | 晋升所需正反馈率 |
| `tempStrategyMatchThreshold` | `0.5` | 临时策略模糊匹配余弦 |
| `shrinkageAlpha` | `50` | 第二层无知先验强度 |
| `minConfidenceIntervalWidth` | `0.2` | 80% 区间最小宽度 |
| `decayLambda` | `0.01` | 冷环路时间衰减（每天） |
| `minDecayWeight` | `0.1` | 参与采样的最小衰减权重 |
| `predictionErrorThreshold` | `0.3` | 进入重建样本所需的预测误差 |
| `maxSampleRatio` | `0.15` | 冷环路采样上限（32 条下限） |
| `evidenceMinCount` | `3` | 证据硬约束最小条数 |
| `evidenceMaxDistance` | `0.85` | 证据两两距离上限 |
| `sandboxImprovement` | `0.15` | 要求的验证误差降幅 |
| `validationRatio` | `0.2` | 采样集中的验证切片比例 |
| `clusterMergeCosine` | `0.4` | 凝聚聚类合并余弦 |
| `clusterMatchCosine` | `0.3` | 簇归属余弦 |
| `emergencyErrorThreshold` | `0.8` | 触发局部修补的反馈误差 |
| `successReferenceThreshold` | `0.4` | 返回成功簇参照所需的情境余弦阈值 |
| `coverageThreshold` | `0.3` | 情境质心余弦低于此值视为分类覆盖缺口 |
| `retrievalFailureMargin` | `0.1` | 路由余量低于此值即把预测 sar 化为检索失败 |
| `minValidationCount` | `3` | 验收重建所需的最小带标签验证样本数 |
| `reconstructRetries` | `2` | 单次随机 LLM 重构抽样无验证簇时的额外抽样次数 |
| `autoAccumulate` | `false` | 自动沉淀 LLM 路由判断值得的已完成轮次 |
| `referenceTopK` | `5` | 一次参考派生锚定的相似历史命中数 |
| `referenceMinSimilarity` | `0.3` | 历史命中作为参考派生锚点所需的最小双轴相似度；低于此值（或仅有模拟命中）时派生不调用 LLM 直接拒绝 |
| `channelLearningRate` | `0.2` | 反馈驱动的多通道检索权重 EWMA 步长 |
| `channelErrorThreshold` | `0.3` | 反馈误差低于此值奖励主通道、高于则惩罚 |
| `refineMaxDrops` | `2` | 单次低置信预测中 LLM 精排的有界剔除上限 |

## 兼容性

随附的 `lib/` 针对 DeepSeek Harness `0.1.0-rc.5`（本源码所基于的 peer API）预构建。从 npm 安装时，peer 会解析到已发布的 `@deepseek-ai/dsh-*` 版本；若某个已发布 peer 的 API 与该基线出现漂移，请改用匹配检出重新构建：

```sh
npm run build   # 通过独立 tsconfig 输出到 ./build
```

## 测试

测试套件（`tests/`）用脚本化 LLM 适配器与真实 Cordis Loader 冒烟驱动完整闭环。它在 DeepSeek Harness 检出内最可靠（能提供精确的 peer API）；在本包内，`npm install` 后 `npm test` 在已安装 peer API 匹配时同样可用。

## 文档

- [`docs/README.md`](docs/README.md) — DCA-PED 设计文档索引（V2.0 原始版 + V3.0 当前版）
- [`docs/v3/`](docs/v3/) — V3.0 设计文档（当前；真实部署验证后：前提分化自动涌现、检索咨询分类体系、经验自动积累）
- [`docs/v2/`](docs/v2/) — V2.0 设计文档（原始版；2026-08-11）

## 许可证

MIT — 见 [LICENSE](LICENSE)。
