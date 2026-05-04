# node-red-contrib-heap-guardian

Memory pressure monitor, leak profiler, dashboard renderer, and guarded GC nodes for Node-RED.

This package does not replace V8 garbage collection. It observes memory pressure and helps investigate Node-RED memory growth through a `trend -> alert -> suspect -> snapshot -> dashboard/prometheus` workflow.

Repository:

```text
https://github.com/Doompy/node-red-contrib-heap-guardian
```

## Nodes

### heap-monitor

Emits a memory snapshot to `msg.payload`.

The snapshot includes:

- `process.memoryUsage()` values
- V8 heap statistics
- Optional V8 heap space statistics
- Heap pressure ratios

### gc-trigger

Runs `globalThis.gc()` only when it is available and the configured guard conditions pass.

Manual GC requires Node-RED to be started with `--expose-gc`.

```powershell
$env:NODE_OPTIONS="--expose-gc --max-old-space-size=1024"
node-red
```

Without `--expose-gc`, the node returns a structured skipped result instead of failing the flow.

### heap-snapshot

Writes a V8 heap snapshot to disk when guard conditions pass.

The Docker example writes snapshots to:

```text
/data/heap-snapshots
```

Heap snapshot creation can pause Node-RED and may need substantial temporary memory. In production, use a high threshold and a long cooldown.

When a snapshot is written, Heap Guardian stores metadata in Node-RED global context under `heapGuardianSnapshots`. Metrics JSON reports include the latest, previous, baseline, and size/memory deltas.

### payload-profiler

Estimates the size of `msg.payload` or another message property.

By default it passes the message through unchanged and adds:

```text
msg.heapGuardian.payloadProfile
```

It also records an aggregate sample in global context, keyed by flow id, profiler node id, and message property.
For object-like payloads it can also record the largest immediate child keys, such as `payload.items` or `payload.cache`.

### context-profiler

Estimates flow/global context key sizes and emits the largest keys.

This is useful for catching patterns such as:

```text
flow.set("items", growingArray)
global.set("cache", growingObject)
```

The profiler excludes its own `heapGuardianProfiler` aggregation key by default.

### profiler-report

Outputs aggregate records collected by `payload-profiler`, `context-profiler`, and `runtime-profiler`.

The report also includes:

- `analysis.topGrowers`: records whose latest sample grew the most
- `analysis.topTrends`: records with the largest recent history growth
- `analysis.topContextGrowers`: flow/global context records growing fastest
- `analysis.topContextTrends`: alias-compatible context trend output for dashboards
- `analysis.topPayloadKeys`: payload child properties carrying or growing the most data
- `analysis.topExpanders`: runtime nodes whose send payload is larger than their receive payload
- `analysis.suspects`: scored records and runtime expansions most likely to explain retained or amplified data
- `analysis.alerts`: warning/critical growth and expansion alerts with evidence
- `dashboard`: dashboard-ready status, cards, and alert/suspect/context trend tables

`analysis.topExpanders` suppresses expansion ratios when the receive baseline is too small, so tiny inbound payloads do not produce misleading ratios. In that case the report still shows `deltaBytes` and a `ratioStatus`.
Suspect and alert entries include `summary`, `severity`, and evidence fields for quick triage.
Alert entries also include a stable `id` for deduplication. Growth and runtime expansion thresholds can be overridden from node settings or HTTP query parameters when the defaults do not match your environment.

Each profiler record keeps a small in-memory history ring buffer. The default limit is 10 samples. History entries contain:

```json
{
  "timestamp": "2026-05-04T00:00:00.000Z",
  "bytes": 1048576,
  "deltaBytes": 262144
}
```

Sort options include:

- last observed size
- max observed size
- total observed bytes
- sample count

HTTP flows can filter report output with query parameters:

```text
/heap-guardian/profile/report?kind=runtime-payload&minDeltaBytes=1048576
/heap-guardian/profile/report?property=payload.items
/heap-guardian/metrics?nodeType=function&limit=5
```

The `profiler-report` node can also apply the same filters from its editor settings or from `msg.profilerFilter`.

### runtime-profiler

Registers Node-RED runtime hooks and automatically samples message property sizes as messages move through flows.

It records samples by:

- flow name/id
- node name/type/id
- direction, such as send or receive
- property, such as `payload` or `payload.data`
- largest immediate child properties, such as `payload.items`

Use a low sample rate in busy production systems. The leak lab example uses 100% sampling only so the behavior is easy to see locally.

Adaptive sampling is available as an opt-in mode. When enabled, `runtime-profiler` can temporarily raise its sample rate during warning/critical alerts or high heap pressure. It is disabled by default, so existing flows keep their configured fixed sample rate.

### metrics-report

Outputs current memory and profiler state as JSON or Prometheus text.

Place it behind an HTTP In node to expose endpoints such as:

```text
/heap-guardian/metrics
/heap-guardian/metrics/prometheus
```

JSON output includes:

- `memory`: current process and V8 memory state
- `profiler`: profiler records and analysis
- `dashboard`: status, cards, and dashboard tables
- `snapshots`: latest, previous, baseline, comparison, and optional experimental object diff

Metrics JSON also includes profiler overhead estimates and async snapshot diff queue status when those features are enabled.

Prometheus output includes memory gauges, heap pressure ratios, profiler record metrics, and low-cardinality analysis summary metrics:

```text
heap_guardian_profiler_alerts{severity="warning"}
heap_guardian_profiler_alerts{severity="critical"}
heap_guardian_profiler_suspects
heap_guardian_profiler_trends
```

The older high-cardinality profiler record metric remains enabled by default for compatibility. Disable it on busy systems with the `includeProfilerRecordMetrics` node option or query parameter:

```text
/heap-guardian/metrics/prometheus?includeProfilerRecordMetrics=false
```

Use `maxPrometheusRecords` to cap how many profiler records are emitted when record metrics are enabled.

### heap-dashboard

Renders a `profiler-report` or `metrics-report` JSON payload into an HTML string.

This node does not depend on Node-RED Dashboard. Connect it to an HTTP Response node, Dashboard template node, or ui-template node.

The generated HTML includes client-side search, severity filtering, and table sorting. Auto-refresh is optional and disabled by default.

Typical HTTP flow:

```text
HTTP In -> metrics-report -> heap-dashboard -> HTTP Response
```

### auto-gc-guard

Runs guarded GC only when an incoming report shows qualifying leak alerts and current heap pressure is above the configured threshold.

It is disabled by default and never runs on a background timer. It only evaluates when a message enters the node.

Default guard conditions:

- `enabled`: false
- `requiredSeverity`: critical
- heap threshold: 85%
- cooldown: 300 seconds
- max runs per hour: 3

Manual GC still requires Node-RED to be started with `--expose-gc`. Without it, the node writes a structured skipped result to `msg.heapGuardian.autoGc`.

### auto-snapshot-guard

Writes a heap snapshot only when an incoming report contains qualifying alerts and current heap pressure is above the configured threshold.

It is disabled by default and never runs on a background timer. It only evaluates when a message enters the node.

Default guard conditions:

- `enabled`: false
- `requiredSeverity`: critical
- heap threshold: 85%
- cooldown: 300 seconds
- max snapshots per hour: 3
- async diff after snapshot: false

The result is written to `msg.heapGuardian.autoSnapshot`. Optional async diff can be queued after a snapshot, but it is also disabled by default.

## Experimental Snapshot Diff

`metrics-report` can compare the latest and previous V8 heap snapshot by constructor/type. This is opt-in because parsing heap snapshots can be expensive.

Enable with:

```text
/heap-guardian/metrics?snapshotDiffEnabled=true
```

Defaults:

- `snapshotDiffEnabled`: false
- `maxSnapshotDiffBytes`: 134217728
- `snapshotDiffTimeoutMs`: 30000

The diff returns `topAdded`, `topGrowing`, and `topRemoved` by constructor/type using `countDelta` and `selfSizeDelta`. Retainer paths and full dominator retained-size analysis are intentionally out of scope for this release.

For safer HTTP endpoints, use async diff instead of blocking the metrics request:

```text
/heap-guardian/metrics?snapshotDiffAsyncEnabled=true
```

Async diff stores job status and latest results in Node-RED global context and exposes them under `snapshots.diffStatus`, `snapshots.diffQueue`, and `snapshots.latestDiffResult`.

## Persistent History

Recent profiler history is kept in memory by default. JSONL persistent history is opt-in through environment variables:

```powershell
$env:HEAP_GUARDIAN_HISTORY_FILE="C:\dev\heap-guardian-history.jsonl"
$env:HEAP_GUARDIAN_HISTORY_MAX_BYTES="52428800"
```

When the file reaches the max size, it is rotated to `.1` and a new file is started. External databases are not used.

## Upgrade Notes

When upgrading from `0.1.x` to `0.2.0`, reinstall the package and restart Node-RED so the editor loads the new node definitions.

For a local Node-RED user directory:

```powershell
cd C:\Users\<you>\.node-red
npm install C:\dev\node-red-heap-guardian
```

For Docker development, remember that a persistent `/data` volume can keep an older installed module. Use a clean volume when testing a local package build:

```powershell
docker compose down -v
docker compose up --build
```

Existing `metrics-report` nodes from `0.1.x` continue to run with default values for the new `0.2.0` fields. If the editor still shows stale validation warnings after reinstalling, refresh the browser and restart Node-RED to clear cached node definitions.

## Local Development

Install this project into a local Node-RED user directory:

```powershell
cd C:\Users\<you>\.node-red
npm install C:\dev\node-red-heap-guardian
```

Restart Node-RED after changing node files.

Run checks:

```powershell
cd C:\dev\node-red-heap-guardian
npm run verify
```

Run the Docker smoke test:

```powershell
cd C:\dev\node-red-heap-guardian
npm run smoke:docker
```

The smoke test builds the image, installs the current package tarball into the running Node-RED `/data` directory, deploys the leak lab, and verifies profiler analysis endpoints.

## Heap Leak Lab

The repo includes a synthetic leak flow for local testing:

[examples/heap-leak-lab-flow.json](examples/heap-leak-lab-flow.json)

Deploy it to a running local Node-RED instance:

```powershell
cd C:\dev\node-red-heap-guardian
npm run deploy:leak-lab
```

Then call the test endpoints:

```powershell
Invoke-RestMethod http://localhost:1880/heap-guardian/status
Invoke-RestMethod 'http://localhost:1880/heap-guardian/payload?count=256&bytes=16384'
Invoke-RestMethod 'http://localhost:1880/heap-guardian/leak?count=128&bytes=16384'
Invoke-RestMethod http://localhost:1880/heap-guardian/profile/context
Invoke-RestMethod http://localhost:1880/heap-guardian/profile/report
Invoke-RestMethod http://localhost:1880/heap-guardian/metrics
Invoke-RestMethod http://localhost:1880/heap-guardian/metrics/prometheus
Invoke-WebRequest http://localhost:1880/heap-guardian/dashboard
Invoke-RestMethod http://localhost:1880/heap-guardian/gc
Invoke-RestMethod http://localhost:1880/heap-guardian/snapshot
Invoke-RestMethod http://localhost:1880/heap-guardian/clear
```

`/heap-guardian/payload` generates a large transient payload and runs it through `payload-profiler`.

`/heap-guardian/leak` retains generated number arrays in Node-RED global context under `heapGuardianLeak`. This is intentionally wasteful and should only be used in a local test environment.

`/heap-guardian/profile/context` shows which context keys are retaining memory. Call `/heap-guardian/leak` and `/heap-guardian/profile/context` repeatedly to make `analysis.topContextTrends` and `analysis.alerts` visible.

The leak lab also includes a `runtime-profiler` node that automatically records large payloads sent and received by regular flow nodes. It excludes Heap Guardian's own nodes by default so the report focuses on application flow behavior. Call `/heap-guardian/profile/report` after multiple `/heap-guardian/payload` or `/heap-guardian/leak` requests to inspect `analysis.topGrowers`, `analysis.topTrends`, `analysis.topPayloadKeys`, `analysis.topExpanders`, `analysis.suspects`, and `analysis.alerts`.

`/heap-guardian/dashboard` returns a simple HTML dashboard generated from the metrics JSON.

`/heap-guardian/snapshot` writes a forced heap snapshot to `/data/heap-snapshots` in the Docker container and updates snapshot metadata for `/heap-guardian/metrics`.

`/heap-guardian/metrics` returns JSON. `/heap-guardian/metrics/prometheus` returns Prometheus text exposition format.

## Docker

Build and run a Node-RED image with this node preinstalled:

```powershell
cd C:\dev\node-red-heap-guardian
docker compose up --build
```

Open Node-RED at:

```text
http://localhost:1880
```

The included `docker-compose.yml` sets:

```yaml
NODE_OPTIONS: "--expose-gc --max-old-space-size=1024"
```

`--expose-gc` is required for the `gc-trigger` node to call `globalThis.gc()`. `--max-old-space-size` sets the V8 old-space heap limit in MiB.

The Docker image installs this package into Node-RED's `/data` user directory during the image build. The compose file also mounts a named volume at `/data` so flows and installed modules persist.

If you rebuild the image after changing this package but keep an existing named volume, Docker may keep the older installed module from the volume. For local development, reset the volume when you want a clean install:

```powershell
docker compose down -v
docker compose up --build
```

For a production setup, prefer one of these patterns:

- Build a versioned image and start it with a fresh or migrated `/data` volume.
- Publish this package to npm and install that exact version inside your Node-RED project/package image.
- Keep `/data` as a persistent volume, but run a controlled `npm install node-red-contrib-heap-guardian@<version>` migration when upgrading the node.

## Production Notes

- Do not expose the leak lab endpoints on a public or shared production Node-RED instance.
- Protect any HTTP endpoints built from `metrics-report`, `heap-snapshot`, `gc-trigger`, or `profiler-report` with your normal Node-RED authentication and network controls.
- Use a low `runtime-profiler` sample rate on busy systems.
- Use heap snapshots sparingly because snapshot creation can pause Node-RED and temporarily increase memory pressure.
- Treat `--expose-gc` as an optional diagnostic switch, not a fix for retained references.
- Keep `auto-gc-guard` disabled until you have alert thresholds and heap pressure behavior that match your environment.
- Keep `auto-snapshot-guard` and adaptive sampling disabled until you have tested their thresholds locally.
- Disable high-cardinality Prometheus profiler record metrics if the label set is too large for your monitoring system.
