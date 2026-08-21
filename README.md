# @deepseek-ai/dsh-cognitive-pipeline

Prediction-error-driven dynamic cognition (DCA-PED) as a DeepSeek Harness plugin. It gives the agent an evolving experience memory: experiences are encoded as **Situation–Action–Result (SAR)** triplets, retrieved by action similarity, predicted with a **five-layer calibrated confidence interval**, corrected by **real feedback**, and periodically **re-clustered in utility space** — a rebuild only wins when a sandbox backtest proves a ≥15% error cut.

This package is a self-contained, npm-publishable form of the plugin, shipped together with the original design documents under [`docs/`](docs/README.md).

## What it does

- **Hot loop** — `predict_outcome`: **multi-channel fused retrieval** (semantic action cosine + situational situation cosine + symptom-signature overlap + outcome-polarity priority for failure-flagged queries) with **feedback-learned channel weights** (`channel_weights.json`, EWMA from `|calibrated − observed|`), OOD detection (`Top1 相似度 < 0.65`, `Top1-Top3 方差 < 0.1` (ambiguous), `Strangeness Index > 1.5`), an **LLM refine pass** on low-confidence routing (template 7 drops inapplicable top hits, bounded by `refineMaxDrops`), and routing to the familiar path (five-layer calibration) or the novel path (episodic scratchpad with a `⚠️ 全新现象` marker).
- **Five-layer calibration** — frequency-prior prompt injection, sample-size shrinkage `P_cal = (k/(k+50))·P_raw + (50/(k+50))·0.5`, minimum-width 80% confidence interval, adversarial risk-factor listing, lifetime bucket correction.
- **Cold loop** — `rebuild_taxonomy`: decay-weighted sampling `W = e^(−λ·Δt)`, agglomerative clustering on **outcome utility vectors**, LLM causal anchoring with a hard ≥3-evidence constraint (backend-verified), sandbox backtest requiring `Δerr ≤ −0.15` before atomic write-back.
- **Feedback loop** — `report_outcome`: prediction error, calibration stats, scratchpad graduation, emergency local repair.
- Every model-assisted step degrades to deterministic math when no LLM route is configured.

## Install

### As a DeepSeek Harness plugin (npm)

Once published, install and enable it in any dsh profile:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-cognitive-pipeline
```

This adds the package to the profile manifest and runs its pnpm install; the profile's patch layer then references it:

```yaml
# <dshHome>/profiles/web/cordis.patch.yml
- insert:
    - id: cognitive-pipeline
      name: '@deepseek-ai/dsh-cognitive-pipeline'
      config:
        root: !!js dshHomePath('cognitive-pipeline')
        # Reuses the harness's own LLM route and credentials — no separate API
        # key. Omit provider/model (or leave the route unreachable) for
        # deterministic mode. See examples/cordis.patch.yml.
        provider: deepseek-official
        model: deepseek-v4-flash
```

Alternatively add it to any Cordis composition:

```sh
pnpm add @deepseek-ai/dsh-cognitive-pipeline
```

A ready-to-use patch snippet is in [`examples/cordis.patch.yml`](examples/cordis.patch.yml). The LLM route reuses the harness's own credentials (e.g. `DEEPSEEK_API_KEY`); nothing extra is configured on the plugin side.

### From source (development)

Copy this package into a DeepSeek Harness checkout and register it:

```sh
cp -r src <dsh>/packages/cognition/cognitive-pipeline/src
# then in the checkout: pnpm install && pnpm run build:lib:host
```

## Usage

The model gets seven tools:

- `remember_experience` — encode a raw experience into SAR memory.
- `predict_outcome` — calibrated prediction with an 80% interval; returns a `prediction_id`.
- `report_outcome` — feed the actual outcome back (optional `outcome_quality` 0–10).
- `rebuild_taxonomy` — run the cold loop (`scope: local | global`).
- `inspect_memory` — read experiences, clusters, calibration buckets, taxonomy summary.
- `simulate_experience` — generate a retrieval-only candidate when real testing is costly or impossible.
- `reference_experience` — generalize the common pattern of the most similar history into a retrieval-only reference candidate (cold-start online generalization); rejected when no similar anchor exists.

The plugin also provides the `ctx.cognitivePipeline` service and the dynamic `cognition:taxonomy` system-prompt section. See [`src/service.ts`](src/service.ts) for the exact service API.

## Configuration

All fields optional; engine defaults follow the design documents.

| Field | Default | Meaning |
| --- | --- | --- |
| `root` | `<dshHome>/cognitive-pipeline` | Store directory (JSONL + JSON state files) |
| `provider` / `model` | unset | Explicit LLM route (both or neither) |
| `enabled` | `true` | False keeps the service but skips tool registration |
| `topK` | `10` | Hot-loop retrieval depth |
| `oodSimThreshold` | `0.65` | OOD low-similarity threshold |
| `oodFlatThreshold` | `0.1` | OOD flat-top spread threshold |
| `oodSiThreshold` | `1.5` | OOD strangeness-index threshold |
| `tempStrategyTtlMs` | `86_400_000` | Scratchpad TTL |
| `tempStrategyHitThreshold` | `3` | Graduation hit count |
| `tempStrategyPositiveRatio` | `0.667` | Graduation positive ratio |
| `tempStrategyMatchThreshold` | `0.5` | Scratchpad fuzzy-match cosine |
| `shrinkageAlpha` | `50` | Layer-2 ignorance-prior strength |
| `minConfidenceIntervalWidth` | `0.2` | Minimum 80%-interval width |
| `decayLambda` | `0.01` | Cold-loop time decay per day |
| `minDecayWeight` | `0.1` | Minimum decay weight to sample |
| `predictionErrorThreshold` | `0.3` | PE needed to join the rebuild sample |
| `maxSampleRatio` | `0.15` | Cold-loop sample cap (32-sample floor) |
| `evidenceMinCount` | `3` | Evidence hard-constraint minimum |
| `evidenceMaxDistance` | `0.85` | Evidence pairwise distance cap |
| `sandboxImprovement` | `0.15` | Required validation error reduction |
| `validationRatio` | `0.2` | Validation slice of the sampled set |
| `clusterMergeCosine` | `0.4` | Agglomerative merge cosine |
| `clusterMatchCosine` | `0.3` | Cluster-membership cosine |
| `emergencyErrorThreshold` | `0.8` | Feedback error triggering a local repair |
| `successReferenceThreshold` | `0.4` | Situation-cosine threshold for a success-cluster reference |
| `coverageThreshold` | `0.3` | Situation-centroid cosine below which the taxonomy is uncovered |
| `retrievalFailureMargin` | `0.1` | Routing margin below which a prediction is SAR-ized as a retrieval failure |
| `minValidationCount` | `3` | Minimum labeled validation samples before a rebuild may be accepted |
| `reconstructRetries` | `2` | Extra reconstruct draws when one stochastic LLM sample yields nothing verified |
| `autoAccumulate` | `false` | Automatically accumulate completed turns judged worth it by the LLM route |
| `referenceTopK` | `5` | How many similar history hits anchor one reference derivation |
| `referenceMinSimilarity` | `0.3` | Minimum dual-axis similarity for a history hit to anchor a reference derivation (below it, or with only simulated hits, the derivation rejects without an LLM call) |
| `channelLearningRate` | `0.2` | EWMA step for the feedback-driven multi-channel retrieval weights |
| `channelErrorThreshold` | `0.3` | Feedback error below which the dominant retrieval channel is rewarded, at/above which it is penalized |
| `refineMaxDrops` | `2` | Bounded LLM-refine drops in one low-confidence prediction |

## Compatibility

The shipped `lib/` is pre-built against DeepSeek Harness `0.1.0-rc.5` (the peer APIs this source is written against). When installed from npm, peers resolve to the published `@deepseek-ai/dsh-*` versions; if a peer's published API has drifted from that baseline, rebuild from a matching checkout instead:

```sh
npm run build   # emits ./build via the standalone tsconfig
```

## Tests

The test suite (`tests/`) drives the full loop with scripted LLM adapters and a real Cordis Loader smoke. It is most reliable inside a DeepSeek Harness checkout (which provides the exact peer APIs); in this package, `npm install` then `npm test` works when the installed peer APIs match.

## Documentation

- [`docs/README.md`](docs/README.md) — index of the DCA-PED design documents (V2.0 original + V3.0 current)
- [`docs/v3/`](docs/v3/) — V3.0 design documents (current; post-deployment validation: premise-differentiation emergence, taxonomy-aware retrieval, auto-accumulation)
- [`docs/v2/`](docs/v2/) — V2.0 design documents (original; 2026-08-11)

## License

MIT — see [LICENSE](LICENSE).
