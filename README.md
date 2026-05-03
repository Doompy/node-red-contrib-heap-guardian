# node-red-contrib-heap-guardian

Memory pressure monitor and guarded GC trigger nodes for Node-RED.

This package does not replace V8 garbage collection. It observes memory pressure and provides conservative diagnostics/actions for Node-RED flows.

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
- `analysis.topContextGrowers`: flow/global context records growing fastest
- `analysis.topPayloadKeys`: payload child properties carrying or growing the most data
- `analysis.topExpanders`: runtime nodes whose send payload is larger than their receive payload
- `analysis.suspects`: scored records and runtime expansions most likely to explain retained or amplified data

`analysis.topExpanders` suppresses expansion ratios when the receive baseline is too small, so tiny inbound payloads do not produce misleading ratios. In that case the report still shows `deltaBytes` and a `ratioStatus`.
Suspect entries include `summary` and `severity` fields for quick triage.

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

### metrics-report

Outputs current memory and profiler state as JSON or Prometheus text.

Place it behind an HTTP In node to expose endpoints such as:

```text
/heap-guardian/metrics
/heap-guardian/metrics/prometheus
```

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
Invoke-RestMethod http://localhost:1880/heap-guardian/gc
Invoke-RestMethod http://localhost:1880/heap-guardian/snapshot
Invoke-RestMethod http://localhost:1880/heap-guardian/clear
```

`/heap-guardian/payload` generates a large transient payload and runs it through `payload-profiler`.

`/heap-guardian/leak` retains generated number arrays in Node-RED global context under `heapGuardianLeak`. This is intentionally wasteful and should only be used in a local test environment.

`/heap-guardian/profile/context` shows which context keys are retaining memory. `/heap-guardian/profile/report` shows aggregate profiler records by flow/profiler node/key.

The leak lab also includes a `runtime-profiler` node that automatically records large payloads sent and received by regular flow nodes. It excludes Heap Guardian's own nodes by default so the report focuses on application flow behavior. Call `/heap-guardian/profile/report` after multiple `/heap-guardian/payload` or `/heap-guardian/leak` requests to inspect `analysis.topGrowers`, `analysis.topPayloadKeys`, `analysis.topExpanders`, and `analysis.suspects`.

`/heap-guardian/snapshot` writes a forced heap snapshot to `/data/heap-snapshots` in the Docker container.

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
