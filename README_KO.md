# node-red-contrib-heap-guardian

Node-RED용 메모리 압박 모니터, 누수 프로파일러, 대시보드 렌더러, guarded GC 노드 모음입니다.

이 패키지는 V8 GC를 대체하지 않습니다. 대신 Node-RED에서 메모리가 커지는 원인을 `trend -> alert -> suspect -> snapshot -> dashboard/prometheus` 흐름으로 추적할 수 있게 돕습니다.

영문 README:

```text
README.md
```

저장소:

```text
https://github.com/Doompy/node-red-contrib-heap-guardian
```

## 핵심 흐름

Heap Guardian은 다음 질문에 답하는 데 초점을 둡니다.

- 현재 Node-RED 프로세스의 heap/rss 상태가 어떤가
- 어떤 flow/node/property가 payload를 키우는가
- 어떤 context key가 계속 커지는가
- receive 대비 send payload가 크게 증폭되는 노드는 어디인가
- 누수 의심 항목과 alert evidence를 dashboard/Prometheus로 볼 수 있는가
- 필요할 때 heap snapshot을 남기고 이전 snapshot과 비교할 수 있는가

## 노드

### heap-monitor

현재 메모리 스냅샷을 `msg.payload`로 출력합니다.

포함되는 정보:

- `process.memoryUsage()` 값
- V8 heap statistics
- 선택적 V8 heap space statistics
- heap pressure ratio

### gc-trigger

`globalThis.gc()`가 사용 가능하고 guard 조건을 통과할 때만 수동 GC를 실행합니다.

수동 GC를 사용하려면 Node-RED를 `--expose-gc`로 시작해야 합니다.

```powershell
$env:NODE_OPTIONS="--expose-gc --max-old-space-size=1024"
node-red
```

`--expose-gc`가 없으면 flow를 실패시키지 않고 structured skipped result를 반환합니다.

### heap-snapshot

guard 조건을 통과하면 V8 heap snapshot을 파일로 저장합니다.

Docker 예제의 기본 snapshot 경로:

```text
/data/heap-snapshots
```

heap snapshot 생성은 Node-RED를 잠시 멈추게 할 수 있고 임시 메모리도 많이 필요할 수 있습니다. 운영 환경에서는 높은 threshold와 긴 cooldown을 사용해야 합니다.

snapshot이 저장되면 Heap Guardian은 Node-RED global context의 `heapGuardianSnapshots`에 metadata index를 저장합니다. `metrics-report` JSON에는 latest/previous/baseline snapshot과 size/memory delta가 포함됩니다.

### payload-profiler

`msg.payload` 또는 다른 message property의 크기를 추정합니다.

기본적으로 메시지는 변경하지 않고 다음 경로에 profile 결과를 추가합니다.

```text
msg.heapGuardian.payloadProfile
```

또한 flow id, profiler node id, message property 기준으로 global context에 aggregate sample을 기록합니다. object 계열 payload는 `payload.items`, `payload.cache` 같은 immediate child key도 기록할 수 있습니다.

### context-profiler

flow/global context key 크기를 추정하고 가장 큰 key를 출력합니다.

다음과 같은 패턴을 찾는 데 유용합니다.

```text
flow.set("items", growingArray)
global.set("cache", growingObject)
```

기본적으로 Heap Guardian 자체 aggregation key인 `heapGuardianProfiler`는 제외합니다.

### runtime-profiler

Node-RED runtime hook을 등록해서 메시지가 flow를 지나갈 때 property 크기를 자동 샘플링합니다.

기록 기준:

- flow name/id
- node name/type/id
- direction: receive/send
- property: `payload`, `payload.data` 등
- immediate child property: `payload.items` 등

바쁜 운영 환경에서는 sample rate를 낮게 두는 것이 좋습니다. leak lab 예제는 동작을 쉽게 확인하기 위해 100% sampling을 사용합니다.

### profiler-report

`payload-profiler`, `context-profiler`, `runtime-profiler`가 수집한 aggregate record를 출력합니다.

주요 출력:

- `records`: 기존 profiler record 목록
- `analysis.topGrowers`: 최근 샘플 대비 가장 크게 증가한 record
- `analysis.topTrends`: 최근 history 기준 성장 trend
- `analysis.topContextGrowers`: context 성장 항목
- `analysis.topContextTrends`: dashboard용 context trend
- `analysis.topPayloadKeys`: payload child key 중 크거나 커지는 항목
- `analysis.topExpanders`: receive 대비 send payload가 커진 runtime node
- `analysis.suspects`: 점수화된 누수/증폭 의심 항목
- `analysis.alerts`: warning/critical alert와 evidence
- `dashboard`: dashboard-ready status/cards/tables

`analysis.topExpanders`는 receive baseline이 너무 작으면 ratio를 계산하지 않습니다. 작은 inbound payload 때문에 misleading ratio가 생기는 것을 피하기 위함입니다. 이 경우에도 `deltaBytes`와 `ratioStatus`는 표시됩니다.

각 profiler record는 최근 sample history ring buffer를 갖습니다. 기본 limit은 10입니다.

```json
{
  "timestamp": "2026-05-04T00:00:00.000Z",
  "bytes": 1048576,
  "deltaBytes": 262144
}
```

HTTP endpoint에서 query parameter로 필터링할 수 있습니다.

```text
/heap-guardian/profile/report?kind=runtime-payload&minDeltaBytes=1048576
/heap-guardian/profile/report?property=payload.items
/heap-guardian/metrics?nodeType=function&limit=5
```

`profiler-report` 노드 설정 또는 `msg.profilerFilter`로도 같은 필터를 적용할 수 있습니다.

### metrics-report

현재 memory/profiler/snapshot 상태를 JSON 또는 Prometheus text로 출력합니다.

HTTP In 뒤에 연결하면 다음 endpoint를 만들 수 있습니다.

```text
/heap-guardian/metrics
/heap-guardian/metrics/prometheus
```

JSON 출력:

- `memory`: process/V8 memory state
- `profiler`: profiler records와 analysis
- `dashboard`: status/cards/tables
- `snapshots`: latest/previous/baseline/comparison, 선택적 experimental object diff

Prometheus 출력에는 memory gauge, heap pressure ratio, profiler record metric, low-cardinality summary metric이 포함됩니다.

```text
heap_guardian_profiler_alerts{severity="warning"}
heap_guardian_profiler_alerts{severity="critical"}
heap_guardian_profiler_suspects
heap_guardian_profiler_trends
```

호환성을 위해 high-cardinality profiler record metric은 기본 활성화입니다. busy system에서는 node option 또는 query parameter로 끌 수 있습니다.

```text
/heap-guardian/metrics/prometheus?includeProfilerRecordMetrics=false
```

`maxPrometheusRecords`로 record metric 개수를 제한할 수 있습니다.

### heap-dashboard

`profiler-report` 또는 `metrics-report` JSON payload를 standalone HTML string으로 렌더링합니다.

Node-RED Dashboard 패키지에 의존하지 않습니다. HTTP Response, Dashboard template, ui-template 등에 연결해서 사용할 수 있습니다.

일반적인 HTTP flow:

```text
HTTP In -> metrics-report -> heap-dashboard -> HTTP Response
```

### auto-gc-guard

입력 report에 qualifying alert가 있고 현재 heap pressure가 threshold 이상일 때만 guarded GC를 실행합니다.

기본값은 disabled이며 background timer를 만들지 않습니다. 반드시 message가 들어올 때만 평가합니다.

기본 guard 조건:

- `enabled`: false
- `requiredSeverity`: critical
- heap threshold: 85%
- cooldown: 300 seconds
- max runs per hour: 3

수동 GC는 여전히 `--expose-gc`가 필요합니다. 없으면 `msg.heapGuardian.autoGc`에 structured skipped result를 기록합니다.

## Experimental Snapshot Diff

`metrics-report`는 latest/previous V8 heap snapshot을 constructor/type 기준으로 비교할 수 있습니다. heap snapshot parsing은 비쌀 수 있으므로 기본 비활성화입니다.

활성화 예:

```text
/heap-guardian/metrics?snapshotDiffEnabled=true
```

기본값:

- `snapshotDiffEnabled`: false
- `maxSnapshotDiffBytes`: 134217728
- `snapshotDiffTimeoutMs`: 30000

diff 결과는 constructor/type별 `topAdded`, `topGrowing`, `topRemoved`를 반환하며 `countDelta`, `selfSizeDelta` 중심입니다. retainer path 분석과 full dominator retained-size diff는 이번 범위에 포함하지 않습니다.

## Persistent History

최근 profiler history는 기본적으로 메모리/global context에 유지됩니다. JSONL persistent history는 환경 변수로 opt-in입니다.

```powershell
$env:HEAP_GUARDIAN_HISTORY_FILE="C:\dev\heap-guardian-history.jsonl"
$env:HEAP_GUARDIAN_HISTORY_MAX_BYTES="52428800"
```

파일이 max bytes를 넘으면 `.1`로 rotate하고 새 파일을 시작합니다. 외부 DB나 SQLite는 사용하지 않습니다.

## 업그레이드 노트

`0.1.x`에서 `0.2.0`으로 올릴 때는 패키지를 다시 설치하고 Node-RED를 재시작해야 editor가 새 node definition을 로드합니다.

로컬 Node-RED user directory에 설치:

```powershell
cd C:\Users\<you>\.node-red
npm install C:\dev\node-red-heap-guardian
```

Docker 개발 환경에서는 persistent `/data` volume에 이전 설치 module이 남을 수 있습니다. local package build를 깨끗하게 테스트하려면 volume을 초기화합니다.

```powershell
docker compose down -v
docker compose up --build
```

기존 `metrics-report` 노드는 새 `0.2.0` 필드가 없어도 기본값으로 동작합니다. 재설치 후에도 editor validation warning이 남아 있으면 브라우저 새로고침과 Node-RED 재시작으로 cached node definition을 정리합니다.

## 로컬 개발

로컬 Node-RED user directory에 이 프로젝트를 설치합니다.

```powershell
cd C:\Users\<you>\.node-red
npm install C:\dev\node-red-heap-guardian
```

node 파일을 바꾼 뒤에는 Node-RED를 재시작해야 합니다.

검증:

```powershell
cd C:\dev\node-red-heap-guardian
npm run verify
```

Docker smoke test:

```powershell
cd C:\dev\node-red-heap-guardian
npm run smoke:docker
```

smoke test는 이미지를 빌드하고, 현재 package tarball을 실행 중인 Node-RED `/data`에 설치하고, leak lab을 deploy한 뒤 profiler analysis endpoint를 검증합니다.

## Heap Leak Lab

저장소에는 로컬 테스트용 synthetic leak flow가 포함되어 있습니다.

[examples/heap-leak-lab-flow.json](examples/heap-leak-lab-flow.json)

실행 중인 로컬 Node-RED에 deploy:

```powershell
cd C:\dev\node-red-heap-guardian
npm run deploy:leak-lab
```

테스트 endpoint:

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

`/heap-guardian/payload`는 큰 transient payload를 만들고 `payload-profiler`를 통과시킵니다.

`/heap-guardian/leak`는 생성된 number array를 Node-RED global context의 `heapGuardianLeak` 아래에 의도적으로 보관합니다. 로컬 테스트 전용입니다.

`/heap-guardian/profile/context`는 어떤 context key가 메모리를 잡고 있는지 보여줍니다. `/heap-guardian/leak`와 `/heap-guardian/profile/context`를 반복 호출하면 `analysis.topContextTrends`와 `analysis.alerts`가 나타납니다.

leak lab에는 `runtime-profiler`도 포함되어 있어 일반 flow node의 receive/send payload를 자동 기록합니다. `/heap-guardian/profile/report`에서 `analysis.topGrowers`, `analysis.topTrends`, `analysis.topPayloadKeys`, `analysis.topExpanders`, `analysis.suspects`, `analysis.alerts`를 확인할 수 있습니다.

`/heap-guardian/dashboard`는 metrics JSON으로 만든 간단한 HTML dashboard를 반환합니다.

`/heap-guardian/snapshot`은 Docker container의 `/data/heap-snapshots`에 forced heap snapshot을 저장하고 `/heap-guardian/metrics`에서 볼 수 있는 snapshot metadata를 갱신합니다.

`/heap-guardian/metrics`는 JSON, `/heap-guardian/metrics/prometheus`는 Prometheus text exposition format을 반환합니다.

## Docker

이 노드가 미리 설치된 Node-RED 이미지를 빌드하고 실행합니다.

```powershell
cd C:\dev\node-red-heap-guardian
docker compose up --build
```

Node-RED 접속:

```text
http://localhost:1880
```

포함된 `docker-compose.yml`은 다음 옵션을 설정합니다.

```yaml
NODE_OPTIONS: "--expose-gc --max-old-space-size=1024"
```

`--expose-gc`는 `gc-trigger`가 `globalThis.gc()`를 호출하기 위해 필요합니다. `--max-old-space-size`는 V8 old-space heap limit을 MiB 단위로 설정합니다.

Docker image는 build 중 이 package를 Node-RED `/data` user directory에 설치합니다. compose file은 `/data`에 named volume도 mount하므로 flows와 installed modules가 유지됩니다.

패키지를 수정한 뒤 이미지를 rebuild해도 기존 named volume을 유지하면 Docker가 volume 안의 오래된 module을 계속 사용할 수 있습니다. 로컬 개발에서는 clean install이 필요할 때 volume을 초기화합니다.

```powershell
docker compose down -v
docker compose up --build
```

운영 환경에서는 다음 방식 중 하나를 권장합니다.

- versioned image를 빌드하고 fresh/migrated `/data` volume으로 시작
- npm에 publish한 정확한 version을 Node-RED project/package image에 설치
- `/data`를 persistent volume으로 유지하되, upgrade 시 `npm install node-red-contrib-heap-guardian@<version>` migration을 명시적으로 실행

## 운영 주의사항

- leak lab endpoint를 public/shared production Node-RED에 노출하지 마십시오.
- `metrics-report`, `heap-snapshot`, `gc-trigger`, `profiler-report`로 만든 HTTP endpoint는 Node-RED 인증과 네트워크 정책으로 보호하십시오.
- busy system에서는 `runtime-profiler` sample rate를 낮게 사용하십시오.
- heap snapshot 생성은 Node-RED를 멈추고 temporary memory pressure를 키울 수 있으므로 신중히 사용하십시오.
- `--expose-gc`는 retained reference 문제를 해결하는 기능이 아니라 진단용 선택지로 봐야 합니다.
- `auto-gc-guard`는 환경에 맞는 alert threshold와 heap pressure behavior를 확인하기 전까지 disabled 상태로 두십시오.
- Prometheus label set이 커지는 환경에서는 high-cardinality profiler record metric을 비활성화하십시오.
