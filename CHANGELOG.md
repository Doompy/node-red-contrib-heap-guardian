# Changelog

## 0.2.1

- Add stable `analysis.alerts[].id` values for deduplication and downstream automation.
- Add configurable alert thresholds for growth samples, growth bytes, and runtime expansion bytes.
- Add profiler overhead summary with record count, history entry count, and estimated JSON bytes.
- Add optional `heap-dashboard` auto-refresh plus client-side table search, severity filter, and sorting.
- Add opt-in `auto-snapshot-guard` node for alert-driven heap snapshot capture.
- Add opt-in async snapshot diff queue and expose diff job status/results in metrics JSON.
- Add opt-in adaptive runtime profiler sampling for alerts or high heap pressure.
- Include Korean README and changelog files in the npm package.

## 0.2.0

- Add profiler history ring buffers, trend analysis, and leak alerts.
- Add dashboard-ready JSON summaries to profiler and metrics reports.
- Add `heap-dashboard` HTML renderer node.
- Add Prometheus alert, suspect, and trend summary metrics.
- Add snapshot metadata indexing and latest/previous/baseline comparison.
- Add experimental constructor/type heap snapshot diff support.
- Add opt-in JSONL persistent profiler history.
- Add opt-in `auto-gc-guard` node for guarded GC on qualifying alerts.
- Expand the leak lab and Docker smoke test for the leak investigation workflow.
- Add upgrade notes and optional editor validation for new numeric settings.

## 0.1.2

- Add `analysis.topContextGrowers` for context-specific growth ranking.
- Add `summary` and `severity` to suspect analysis entries.
- Suppress unreliable `topExpanders` ratios when receive payloads are below the ratio threshold.
- Filter small runtime expanders by default to reduce report noise.
- Add profiler-report editor filters for kind, flow, node, property, size, and delta.
- Add `npm run smoke:docker` for Docker leak lab smoke testing.

## 0.1.1

- Add profiler growth tracking fields.
- Add `analysis.topGrowers` to profiler and metrics JSON reports.
- Add payload top-level key records and `analysis.topPayloadKeys`.
- Add `analysis.topExpanders` to compare runtime receive and send payload sizes.
- Add scored `analysis.suspects` for likely retained or amplified data.
- Add report filters for `kind`, `flowId`, `nodeId`, `nodeType`, `property`, `minBytes`, and `minDeltaBytes`.
- Update the leak lab runtime profiler to sample both send and receive directions.
- Keep Prometheus output unchanged to avoid high-cardinality analysis metrics.

## 0.1.0

- Add heap memory monitoring.
- Add guarded manual GC trigger.
- Add payload and context profilers.
- Add profiler aggregation reports.
- Add Node-RED runtime hook sampling.
- Add heap snapshot capture.
- Add JSON and Prometheus metrics reports.
- Add Docker development environment and leak lab flow.
