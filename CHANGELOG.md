# Changelog

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
