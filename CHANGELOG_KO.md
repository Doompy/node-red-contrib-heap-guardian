# 변경 내역

## 0.2.0

- profiler history ring buffer, trend analysis, leak alert를 추가했습니다.
- profiler report와 metrics report에 dashboard-ready JSON summary를 추가했습니다.
- `heap-dashboard` HTML renderer node를 추가했습니다.
- Prometheus alert, suspect, trend summary metric을 추가했습니다.
- snapshot metadata indexing과 latest/previous/baseline 비교를 추가했습니다.
- experimental constructor/type heap snapshot diff 지원을 추가했습니다.
- opt-in JSONL persistent profiler history를 추가했습니다.
- qualifying alert가 있을 때 guarded GC를 실행하는 opt-in `auto-gc-guard` node를 추가했습니다.
- leak investigation workflow 검증을 위해 leak lab과 Docker smoke test를 확장했습니다.
- 새 numeric 설정에 대한 upgrade note와 optional editor validation을 추가했습니다.

## 0.1.2

- context-specific growth ranking을 위한 `analysis.topContextGrowers`를 추가했습니다.
- suspect analysis 항목에 `summary`와 `severity`를 추가했습니다.
- receive payload가 ratio threshold보다 작을 때 신뢰하기 어려운 `topExpanders` ratio를 표시하지 않도록 했습니다.
- report noise를 줄이기 위해 작은 runtime expander를 기본적으로 필터링하도록 했습니다.
- profiler-report editor filter를 추가했습니다.
  - kind
  - flow
  - node
  - property
  - size
  - delta
- Docker leak lab smoke test를 위한 `npm run smoke:docker`를 추가했습니다.

## 0.1.1

- profiler growth tracking field를 추가했습니다.
- profiler와 metrics JSON report에 `analysis.topGrowers`를 추가했습니다.
- payload top-level key record와 `analysis.topPayloadKeys`를 추가했습니다.
- runtime receive/send payload size를 비교하는 `analysis.topExpanders`를 추가했습니다.
- retained 또는 amplified data 가능성이 있는 항목을 점수화하는 `analysis.suspects`를 추가했습니다.
- report filter를 추가했습니다.
  - `kind`
  - `flowId`
  - `nodeId`
  - `nodeType`
  - `property`
  - `minBytes`
  - `minDeltaBytes`
- leak lab runtime profiler가 send와 receive direction을 모두 샘플링하도록 업데이트했습니다.
- high-cardinality analysis metric을 피하기 위해 Prometheus output은 변경하지 않았습니다.

## 0.1.0

- heap memory monitoring을 추가했습니다.
- guarded manual GC trigger를 추가했습니다.
- payload profiler와 context profiler를 추가했습니다.
- profiler aggregation report를 추가했습니다.
- Node-RED runtime hook sampling을 추가했습니다.
- heap snapshot capture를 추가했습니다.
- JSON과 Prometheus metrics report를 추가했습니다.
- Docker development environment와 leak lab flow를 추가했습니다.
