# SubTrans AI 개발명세서 v2.0

작성·공식 자료 확인 기준: 2026-09-26

대상 환경: LG 그램 2026, Intel Core Ultra X7, Intel Arc Graphics, RAM 32GB, SSD 1TB. 정확한 CPU SKU, Arc 세부 모델, 드라이버와 전력 제한은 미확인이다. 아래 속도·메모리·품질 수치는 별도 표시가 없는 한 **설계 목표 또는 추정 예산**이며 이 노트북에서 측정한 결과가 아니다.

## 1. 최종 개발 방향

**영어·중국어·일본어 웹 동영상을 한국어 자막으로 보여주는 Chrome 확장프로그램과 Windows 로컬 동반 앱을 개발한다.**

주력 사용 방식은 세 가지로 나눈다.

1. **로컬 무료 모드:** 로컬 STT + 로컬 번역. 모델을 내려받은 뒤 외부 AI API를 호출하지 않는다. API 요금은 0원이며 전력·저장 공간·기기 자원은 사용한다.
2. **가성비 모드 — 이 PC의 우선 추천:** 로컬 STT + 저가 텍스트 번역 API. 음성은 PC에서 처리하고 전사된 문장과 필요한 문맥만 외부에 전송한다.
3. **품질 우선 모드:** 클라우드 스트리밍 STT + 품질 중심 번역. 난해한 구간만 상위 모델로 다시 번역하는 선택 기능을 둔다.

설치 직후에는 로컬 모드로 시작한다. 사용자가 공급자·전송 데이터·예산을 설정한 경우에만 가성비 또는 품질 모드를 활성화한다. 로컬 오류를 이유로 유료 API로 조용히 전환하지 않는다.

## 2. 기존 명세서에서 수정할 핵심 전제

- **서비스 워커는 제어 담당이다.** 오디오 스트림·AudioContext·AudioWorklet·WebSocket의 실제 실행 주체는 Offscreen Document로 분리한다. Chrome은 116부터 서비스 워커에서 얻은 탭 스트림 ID를 Offscreen Document에서 사용할 수 있게 했다. [Chrome 캡처 가이드](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- **tabCapture는 선택한 영상 한 개가 아니라 탭의 오디오를 수집한다.** 광고·다른 플레이어·알림 소리가 섞일 수 있다. 선택한 `<video>`는 자막 위치와 재생 시각의 기준으로 사용한다. [tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- **2~3초 청크를 완전히 모은 뒤 처리하면서 전체 지연 2초 미만을 보장할 수는 없다.** 전송 프레임, STT 분석 창, 번역할 의미 단위를 서로 분리한다.
- **Faster-Whisper는 모델명이 아니라 추론 구현이다.** Whisper large-v3/turbo 등 실제 모델과 런타임을 따로 지정한다. NVIDIA GPU용 구성을 Intel Arc의 기본값으로 사용하지 않는다. [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)
- **모든 사이트 완벽 호환을 약속하지 않는다.** 캡처 가능 여부와 오버레이 표시 가능 여부를 별도로 판정한다. iframe·DRM·특수 전체화면·Picture-in-Picture는 각각 테스트하고 지원 범위를 공개한다.
- **STT 정확도, 한국어 번역 품질, 자막 표시 지연은 서로 다른 지표다.** 원문 자막이 빨리 나왔다는 이유로 한국어 번역 지연 목표를 달성했다고 처리하지 않는다.
- **최신 모델 또는 고가 모델이라는 사실은 한국어 자막 품질 1위를 입증하지 않는다.** 실제 영·중·일 평가 영상으로 최종 모델을 선정한다.

## 3. LG 그램에 맞춘 모델 추천

### 3.1 완전 무료 구성

**실용 기본안: Whisper small 다국어 + Qwen3.5-4B 양자화 모델**

- STT: `openai/whisper-small`, OpenVINO GenAI의 Intel GPU 실행을 우선 검증한다. 영어 전용 `.en` 모델을 사용하지 않는다.
- MT: `Qwen/Qwen3.5-4B`의 검증된 4비트 변환본. llama.cpp의 Vulkan 또는 SYCL 중 해당 Arc·드라이버·모델 조합에서 통과한 빌드를 사용한다.
- 번역 입력은 텍스트만 사용하고, 실제 채팅 템플릿 설정으로 thinking을 끈다. 단순히 프롬프트에 “생각하지 마”를 적는 것과 구분한다.
- 장점: 비교적 작은 모델로 음성 인식과 문맥·용어집 기반 번역을 모두 로컬에서 구현할 수 있다.
- 한계: 빠른 대화·BGM·고유명사에서 small STT의 오류가 전체 번역 품질을 제한할 수 있다.

OpenVINO는 Whisper small과 large-v3-turbo의 검증 조합을 공개한다. llama.cpp SYCL은 Intel 내장 Arc와 Windows를 지원하지만, 개별 모델·빌드의 호환성까지 자동 보장하지 않는다. [OpenVINO 지원 모델](https://docs.openvino.ai/2026/documentation/compatibility-and-support/supported-models.html), [llama.cpp SYCL](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md), [Qwen3.5-4B 모델 카드](https://huggingface.co/Qwen/Qwen3.5-4B)

**음성 인식 품질 상향안: Whisper large-v3-turbo**

OpenVINO의 지원 변환 형식으로 시험한다. 30분 연속 영상 재생에서 처리 대기열이 증가하지 않고 번역까지 포함한 지연 기준을 통과할 때 small 대신 기본값으로 승격한다. 모델 파일이 메모리에 들어간다는 이유만으로 채택하지 않는다. Whisper는 누적 창을 반복 처리하는 준실시간 방식으로 구현하며, 원래부터 스트리밍 모델인 것처럼 설명하지 않는다. [OpenVINO Whisper 추론](https://docs.openvino.ai/2026/openvino-workflow-generative/inference-with-genai.html)

**로컬 번역 비교 후보**

- `google/translategemma-4b-it`: 번역 전용 대안. 언어 코드와 전용 템플릿을 적용해 영·중·일→한을 평가한다. 일반 대화형 LLM과 동일한 문맥·용어집 인터페이스를 가정하지 않는다.
- `Qwen/Qwen3.5-9B` INT4: 4B보다 큰 품질 비교 후보. OpenVINO GPU 검증 조합이 공개되어 있으나, 이 그램에서의 자막 처리 속도는 별도 확인한다.
- TranslateGemma 12B, Qwen3.8-27B: 충분한 메모리와 처리 여유를 갖춘 다른 PC 또는 오프라인 재번역용 후보. 현재 그램의 실시간 기본값으로 추천하지 않는다.

TranslateGemma는 4B·12B·27B 제품군이며 자체 사용 조건을 따른다. Qwen3.8-27B는 더 최신이지만, 이 용도에서는 4B/9B급의 지연과 자원 사용량이 더 실용적일 수 있다. [TranslateGemma](https://huggingface.co/google/translategemma-12b-it), [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)

### 3.2 최신 로컬 STT를 어떻게 반영할 것인가

**Qwen3-ASR-0.6B/1.7B**는 최신 비교 대상이다. 영·중·일을 지원하며 공식 프로젝트의 스트리밍 경로는 vLLM 기반이고 스트리밍 타임스탬프 반환에는 제약이 있다. Intel 노트북에 그 구성을 그대로 적용하지 않는다. OpenVINO 2026.3 릴리스에는 Qwen3-ASR의 CPU/GPU early release 지원도 기재되어 있으므로, 변환·언어별 품질·실시간 스트리밍 동작을 검증하는 실험 어댑터로 추가한다. Intel에서 지원 불가라고 단정하지도, 곧바로 제품 기본값으로 삼지도 않는다. [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR), [OpenVINO 릴리스 노트](https://docs.openvino.ai/2026/about-openvino/release-notes-openvino.html)

**Voxtral Mini 4B Realtime 2602**는 실제 스트리밍 구조를 가진 공개 가중치 후보다. 영·중·일을 포함한 언어를 지원한다. 다만 공개 모델의 지연 설정과 벤치마크를 이 그램의 종단 간 한국어 자막 속도로 해석하지 않는다. Intel 실행 경로가 검증되면 비교한다. [Voxtral 공식 모델 카드](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)

### 3.3 가성비 구성 — 권장 출발점

**Whisper small 또는 large-v3-turbo / OpenVINO + GPT-6 Luna**

- STT는 위의 로컬 성능 시험으로 선택한다.
- 번역은 `gpt-6-luna`를 우선 시험한다. 공식 표준 단가는 텍스트 100만 토큰당 입력 $0.10, 출력 $0.50이다.
- 대안은 `gemini-3.5-flash-lite`. 공식 표준 단가는 입력 $0.30, 출력 $2.50이다. 더 저렴한 이전 세대 후보가 필요하면 `gemini-2.5-flash-lite`의 입력 $0.10, 출력 $0.40을 비교할 수 있지만 신규 기본 모델 결정 시 지원 수명을 함께 확인한다.
- 짧은 자막 번역에서는 문맥 토큰과 요청 횟수 관리가 중요하다. 저가 모델이 필요한 품질에 도달하면 상위 모델로 바꿀 이유가 없다.
- 브라우저 재생과 로컬 STT만 경쟁하므로, 두 모델을 동시에 로컬 실행하는 구성보다 기기 부하를 줄일 여지가 있다. 이는 설계상 기대이며 실측 결과는 아니다.

[GPT-6 Luna 모델·가격](https://developers.openai.com/api/docs/models/gpt-6-luna), [Gemini 공식 가격](https://ai.google.dev/gemini-api/docs/pricing)

### 3.4 클라우드 STT 추천

**일반적인 저비용 스트리밍 기본 후보: Deepgram Nova-3.** 언어를 수동 선택한 경우 `en`, `ja`, `zh` 등 해당 언어 코드를 사용한다. 공식 `language=multi` 언어 목록과 중국어 개별 지원은 다르므로 중국어 혼합 대화를 자동 지원한다고 가정하지 않는다. 현재 공개 스트리밍 단가는 단일 언어 $0.0048/분, 다국어 $0.0058/분이며 할인·부가 옵션 변경 가능성을 가격 설정에 반영한다. [언어 지원](https://developers.deepgram.com/docs/models-languages-overview), [Deepgram 가격](https://deepgram.com/pricing)

**실시간 대안: Voxtral Realtime API.** `voxtral-mini-transcribe-realtime-2602`, $0.006/분. 공개 가중치의 자체 호스팅과 유료 API를 구분한다. [Mistral 모델·가격](https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02)

**품질 평가 후보: GPT-Live-Transcribe, Gemini 3.5 Transcribe Live.** OpenAI의 최신 라이브 전사 권장 경로와 Google의 라이브 전사 경로를 별도 어댑터로 평가한다. Gemini는 현재 문서상 라이브 세션 최대 10분이며 라이브 단어 타임스탬프·화자 분리 제약이 있어 세션 교체와 자체 시간 기준이 필요하다. [OpenAI 라이브 전사](https://developers.openai.com/api/docs/guides/realtime-transcription), [Gemini Transcribe 기능 비교](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe)

`gpt-4o-mini-transcribe`는 $0.003/분 수준의 저가 전사 후보로 남긴다. 다만 파일/발화 청크 API와 연속 오디오 라이브 스트리밍의 동작을 구분하며, 단가만 보고 실시간 기본값으로 선택하지 않는다. [OpenAI 전사 가격](https://developers.openai.com/api/docs/pricing)

### 3.5 최고 품질을 원할 때

**실시간 실용 품질안:** 언어별 평가에서 이긴 스트리밍 STT + GPT-6 Sol 또는 Claude Sonnet 5. 높은 오류 위험이 있는 문장만 GPT-6 Astra 또는 Claude Opus 5.5로 재번역한다.

**비용보다 품질을 우선하는 비교안:** 같은 STT 원문을 GPT-6 Astra와 Claude Opus 5.5에 각각 번역시켜, 전문 용어·생략된 주어·존댓말·중의성·누락을 블라인드 평가한다. 확정 원문이 잘못됐다면 번역만 재실행하지 말고 필요할 때 STT부터 다시 평가한다.

이 모델들을 한국어 자막의 검증된 공동 1위로 선언하는 것은 아니다. 최신 상위 후보를 정하고 자체 데이터로 승자를 정한다. 긴 추론은 라이브 표시를 늦출 수 있으므로, 상위 모델 전면 적용은 지연을 허용하는 품질 모드 또는 저장 자막 교정에 적합하다. [OpenAI 모델 가이드](https://developers.openai.com/api/docs/guides/latest-model), [Claude 모델·가격](https://platform.claude.com/docs/en/about-claude/pricing)

**음성→번역 직접 처리 모델**인 GPT-Realtime-Translate, Gemini 3.5 Live Translate, Qwen3.8-LiveTranslate도 실험 대상으로 기록한다. 이 프로젝트는 자막만 필요하므로 텍스트만 받는 모드, 음성 출력 과금, 원문·번역 정렬, 용어집, 문장 수정 이벤트를 실제 API에서 확인한 뒤 채택한다. 기본 구조는 관측·교정·교체가 쉬운 STT+MT 분리 방식으로 유지한다. [OpenAI 실시간 번역](https://developers.openai.com/api/docs/guides/realtime-translation), [Gemini 가격·모델](https://ai.google.dev/gemini-api/docs/pricing), [Qwen LiveTranslate 발표](https://qwen.ai/blog?id=qwen3.8-livetranslate)

## 4. 비용 설계와 계산 예시

통화는 USD, 세금·환율·중계 서버·네트워크 비용 제외다. 아래는 **견적을 위한 계산 예시**이고 실제 청구액이 아니다.

영상 1시간에 번역 600회, 회당 평균 입력 500토큰, 시간당 총 출력 20,000토큰을 가정한다. 입력에는 지시문·이전 문장·용어집이 포함된다. 예시는 캐시 할인과 추가 추론 토큰이 없다고 가정한다.

`시간당 MT 비용 = 0.30 × 입력 단가 + 0.02 × 출력 단가`

- 로컬 STT + 로컬 MT: 외부 API $0.
- 로컬 STT + GPT-6 Luna: `0.30 × 0.10 + 0.02 × 0.50 = $0.04/시간`.
- 로컬 STT + Gemini 3.5 Flash-Lite: `0.30 × 0.30 + 0.02 × 2.50 = $0.14/시간`.
- Nova-3 단일 언어 + Luna: `60 × 0.0048 + 0.04 = $0.328/시간`.
- Voxtral Realtime API + Luna: `60 × 0.006 + 0.04 = $0.40/시간`.
- GPT-Live-Transcribe는 현재 $0.017/분, 즉 전사만 $1.02/시간이다. MT는 별도다.

월 100시간이라면 위 Luna 하이브리드 가정은 번역 API 약 $4, Nova-3+Luna 가정은 약 $32.80이다. 문맥이나 초안 재번역을 두 배로 전송하면 MT 비용도 그만큼 증가한다. 잘린 음성을 겹쳐 전사하는 방식은 STT 중복 과금도 일으킬 수 있다.

가격 근거: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Google](https://ai.google.dev/gemini-api/docs/pricing), [Deepgram](https://deepgram.com/pricing), [Mistral](https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02), [OpenAI 음성 가격](https://developers.openai.com/api/docs/pricing).

무료 API 할당량은 개발 시험용으로만 취급한다. 무제한 무료, 지속적인 처리량 또는 영구적인 가격을 전제하지 않는다. 요청 수 제한과 분당 토큰 제한을 비용과 함께 관리한다.

## 5. 제품 범위와 지원 정책

### MVP 포함

- Windows 11 + Chrome 안정 채널, 한 번에 한 탭·한 영상 선택.
- 영어·일본어·중국어 보통화→한국어. 간체/번체 출력 처리는 별도 옵션, 광둥어는 후속 지원.
- 자막이 없는 일반 HTML5 영상, 사용자가 읽을 수 있는 자막 트랙이 있는 영상.
- 로컬 무료 모드와 사용자가 활성화한 가성비 모드.
- 영상 영역 안의 Shadow DOM 자막, 실시간 스타일 설정, 재생·일시정지·탐색 처리.
- 사이트별 설정, 용어집, 선택적 원문 병기, 사용자가 요청한 SRT/VTT 저장.

### 조건부 지원

- YouTube SPA 전환, 교차 출처 iframe, OTT, 라이브 스트림은 각각 호환성 시험 결과를 표시한다.
- DRM 콘텐츠는 캡처·렌더링이 허용되고 실제로 작동하는 범위에서만 지원한다. 보호 장치를 우회하지 않는다.
- 기본 Video Picture-in-Picture에는 페이지 DOM 오버레이가 따라가지 않을 수 있다. 별도 자막 창 또는 Document Picture-in-Picture는 후속 기능이다.
- `<video>` 자체가 전체화면이 되는 경우 임의 DOM을 자식으로 넣어 해결된다고 가정하지 않는다. 플레이어 컨테이너 전체화면 또는 검증된 사이트 어댑터를 사용하고, 불가능하면 자막 별도 표시를 안내한다.
- 닫힌 Shadow Root 내부 영상과 접근 권한 없는 프레임은 영상 위치·시각을 얻지 못할 수 있다. 창 하단 고정 자막을 대안으로 제공하되 정확한 영상 동기화 지원과 구분한다.

## 6. 권장 기술 스택

- 확장프로그램: Manifest V3, TypeScript, WXT, React. 팝업은 시작·중지 위주, 지속적인 설정은 Side Panel과 Options 페이지에 배치한다.
- 스타일: Tailwind CSS는 패널에 적용 가능. 자막은 Shadow Root 내부의 작은 CSS와 CSS 변수를 사용해 갱신 비용을 줄인다.
- 캡처: `chrome.tabCapture`, Offscreen Document, Web Audio API, AudioWorklet.
- 영상 추적: MutationObserver, ResizeObserver, fullscreenchange, HTMLMediaElement 이벤트.
- 로컬 앱: Python 3.12 계열 호환 환경 + FastAPI/Uvicorn + OpenVINO GenAI. 추론은 별도 작업자 프로세스에서 실행해 WebSocket 이벤트 루프를 막지 않는다.
- 로컬 MT: llama.cpp 서버 또는 검증된 OpenVINO GenAI 모델. Ollama/LM Studio는 사용 편의 선택지이며 설치만으로 Arc 가속이 보장된다고 표시하지 않는다.
- VAD: Silero VAD를 CPU에서 우선 실행. 필요하면 검증된 ONNX Runtime 경로를 사용한다.
- 통신: 오디오·자막·제어 이벤트를 위한 WebSocket. 내부 HTTP는 상태 점검·설정·모델 관리에 사용한다. SSE는 상행 오디오 전송을 대체하지 못하므로 기본 스트림으로 사용하지 않는다.
- 저장: Chrome Storage Local은 UI 설정, 로컬 SQLite는 용어집·선택적 기록. API 키는 Windows 자격 증명 저장소 또는 보호된 로컬 설정에 보관한다.
- 검증: Vitest, pytest, Playwright의 확장 로드 테스트와 실제 Chrome 수동 검증을 조합한다.

런타임·SDK·드라이버·모델은 검증된 정확한 버전과 해시를 잠근다. 모든 패키지를 무조건 가장 최신 버전으로 섞지 않는다. [WXT 콘텐츠 스크립트](https://wxt.dev/guide/essentials/content-scripts), [Silero VAD](https://github.com/snakers4/silero-vad)

## 7. 시스템 아키텍처

```text
사용자: 현재 탭에서 번역 시작
    │
    ▼
Service Worker — 세션/권한/설정/상태 조정
    │ stream ID                 │ 텍스트 이벤트 전달
    ▼                           ▼
Offscreen Document          Content Script + Shadow DOM
 ├─ 탭 오디오 수집              ├─ 대상 영상/프레임 탐색
 ├─ 원래 소리를 다시 출력        ├─ 재생 시각/탐색/배속 감지
 ├─ AudioWorklet                ├─ 자막 배치/스타일 갱신
 ├─ 다운믹스/리샘플링            └─ 초안 → 확정 자막
 └─ WebSocket
    │ PCM + 시간/순서 정보
    ▼
로컬 동반 앱: 127.0.0.1
 ├─ 인증/기능 협상/상태 점검
 ├─ VAD + 오디오 시간축
 ├─ STT 어댑터: OpenVINO / 클라우드 / 실험 모델
 ├─ 원문 안정화·중복 제거
 ├─ 문맥·용어집·번역 스케줄러
 ├─ MT 어댑터: 로컬 / 저가 API / 상위 API
 └─ 타임라인·revision·사용량 관리
```

오디오 PCM은 서비스 워커나 콘텐츠 스크립트를 경유해 반복 복사하지 않는다. Offscreen Document에서 로컬 앱으로 직접 전송한다. 서비스 워커가 재시작해도 실제 캡처 상태를 조회해 재연결하고, 세션 소유권이 불명확하면 중복 캡처를 시작하지 않는다.

Chrome 탭 캡처 시 기본 재생 경로가 바뀌므로 캡처한 스트림을 AudioContext 출력으로 연결해 원래 소리가 계속 들리게 한다. 출력 연결은 정확히 한 번 만들고 중지 시 해제한다. Offscreen 생명주기는 사용한 reason과 API 제약에 맞춰 설계한다. [Chrome 캡처 구현](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

## 8. 오디오·VAD·STT 상세 요구사항

### F-1. 오디오 취득

- 사용자 동작 직후 현재 탭에 한정해 캡처를 시작한다. 새 페이지에서 몰래 자동 시작하지 않는다.
- 실제 입력 샘플레이트를 확인한다. 48kHz라고 가정한 샘플을 16kHz로 표기해서 보내지 않는다.
- 로컬 Whisper 입력은 mono 16kHz를 기본으로 한다. 공급자에 따라 24kHz 등 필요한 형식으로 어댑터에서 변환한다.
- 전송은 PCM16 little-endian 이진 프레임을 기본으로 하고, 초기값은 40~100ms다. Base64는 해당 API가 요구할 때만 사용한다.
- 프레임마다 순번·sample count·캡처 시각을 연결한다. 수신 시각만으로 자막 시간을 정하지 않는다.
- 한 탭에서 여러 영상이 소리를 내면 혼합 입력임을 표시한다. 영상 선택이 오디오 분리를 의미하지 않는다.

### F-2. VAD와 문장 경계

- VAD 초기값은 발화 시작 전 여유 200~300ms, 종료 무음 400~700ms로 시험한다. 언어·속도·잡음에 따라 조정한다.
- 의미 단위는 문장부호·안정된 원문·무음 길이를 함께 보고 확정한다. 끝없이 긴 발화는 제한된 길이로 잘라 초안을 제공한다.
- 짧은 무음을 모두 삭제하지 않는다. 발음 경계·끝소리 손실을 방지하고, 제거한 구간은 원래 sample 위치로 복원 가능한 매핑을 남긴다.
- 클라우드 스트리밍에서 무음 전송 중단이 endpointing·타임아웃을 깨지 않도록 공급자별 keepalive/종료 정책을 적용한다. VAD를 썼다는 이유만으로 연결 유지 과금이 줄어든다고 가정하지 않는다.
- 음성 분리·BGM 제거는 기본 경로에서 제외한다. 음성까지 손상하거나 지연이 늘 수 있어 품질 모드에서만 평가한다.

### F-3. 로컬 Whisper 준실시간 처리

- 최근 오디오를 유지하는 rolling buffer를 둔다. 초기 실험값은 분석 창 4~8초, 갱신 간격 0.8~1.5초다.
- 같은 앞부분이 연속 결과에서 유지되는지 확인해 원문을 안정화한다. 확정한 구간은 다시 번역하지 않고 미확정 꼬리 부분만 갱신한다.
- 겹친 창에서 같은 문장을 두 번 내보내지 않도록 sample 범위와 텍스트를 함께 비교한다.
- 무음·BGM 구간의 반복 문구 환각을 감지한다. 원문을 임의로 지어내는 보정은 하지 않는다.
- 언어를 알고 있으면 수동 고정을 우선한다. 자동 감지는 일정 분량을 모아 결정하고 매 청크마다 언어가 바뀌지 않게 한다.
- STT는 원어 전사 작업으로 실행한다. Whisper의 영어 번역 기능을 한국어 번역 기능으로 사용하지 않는다.

### F-4. 원문 정제

- 원문 raw와 정제된 normalized를 함께 보존한다.
- Unicode·공백·중복 문장부호 등 비파괴적 정제를 우선한다.
- 중국어 간체/번체는 사용자가 선택한 경우 표시·검색용 정규화에 적용한다. 이름·제품명은 원문도 유지한다.
- 일본어를 무조건 띄어쓰거나 번역 전 규칙으로 한국어 어순으로 재배열하지 않는다.
- 영어 약어·고유명사는 STT 용어 힌트와 MT 용어집으로 처리한다. 확실하지 않은 축약어를 임의로 풀어 쓰지 않는다.

## 9. 번역 파이프라인

### F-5. 문맥과 용어집

입력은 현재 원문, 직전 확정 원문/번역 최대 2~3쌍, 관련 용어, 말투 설정으로 제한한다. 과거 전체 기록과 무관한 용어집을 매번 보내지 않는다. 주제 메모는 짧게 제한하며 모델이 추측한 인물 관계를 사실처럼 누적하지 않는다.

용어 항목은 `source`, `target`, `sourceLanguage`, `domain`, `caseSensitive`, `version`을 갖는다. 문맥상 맞는 용어만 적용하며 단순 문자열 전역 치환은 보조 수단으로만 쓴다. STT 힌트와 MT 용어집은 분리한다. DeepL은 context를 지원하지만 언어쌍·모델별 glossary 지원을 별도로 확인해야 한다. [DeepL 번역 API](https://developers.deepl.com/api-reference/translate/request-translation)

### F-6. 생성 규칙

- 출력은 한국어 자막 텍스트와 필요한 식별자만 반환한다. 설명·감상·응답 행동을 생성하지 않는다.
- 자막 안의 “이전 지시를 무시하라” 같은 문장은 번역할 데이터로 취급한다.
- 숫자·단위·부정·조건·이름을 보존한다. 짧게 표시하려고 의미를 요약하는 기능은 기본값으로 끈다.
- 자막 줄바꿈은 렌더러가 글자 폭을 측정해 처리한다. 줄 길이를 맞추기 위해 LLM이 내용을 삭제하지 않게 한다.
- Qwen은 지원 런타임의 non-thinking 설정을 사용한다. 다른 모델도 지원되는 최소 추론 설정부터 평가한다.
- 제공자가 허용하는 출력 제한·timeout을 설정하고, 길이 초과·다른 언어·비정상 JSON·빈 결과를 검증한다.
- 공급자의 confidence가 없으면 “정확도 98%” 같은 숫자를 만들어 표시하지 않는다. 자체 품질 신호는 참고 신호로만 사용한다.

### F-7. 초안과 확정

- 원문 초안 → 한국어 초안 → 한국어 확정의 상태를 갖는다. 원문 병기는 사용자 옵션이다.
- 단어마다 번역하지 않는다. 안정된 구절을 기준으로 debounce하고, 기본적으로 cue당 초안 1회·확정 1회를 상한으로 시험한다.
- 같은 cue의 수정은 `revision`을 증가시키고 화면의 같은 영역을 교체한다.
- 현재 표시 중이거나 곧 표시할 cue만 재번역한다. 이미 지나간 자막의 늦은 교정은 라이브 화면에 다시 띄우지 않는다.
- 캐시 키는 원문·문맥 해시·언어·용어집 버전·모델·말투를 포함한다. 같은 문장이라도 문맥이 다른 번역을 오용하지 않는다.

## 10. 동기화와 재생 제어

오디오 캡처 시간, 영상 `currentTime`, 요청 완료 시간은 서로 다른 시계다.

- 세션 시작과 재생 상태 변경 시 `audioSampleIndex`, 단조 시계, `mediaTime`, `playbackRate`를 함께 기록한다.
- 시계를 구간별로 매핑한다. 재생 중 동일 구간에서는 경과 시간에 playbackRate를 반영한다.
- seek·광고/본문 전환·영상 교체 시 `generationId`를 증가시키고 이전 generation 결과를 폐기한다.
- 일시정지 시 신규 발화를 만들지 않는다. 재개 전에 불필요한 미확정 버퍼를 비우거나 경계 처리한다.
- 원본 자막 시간 기준과 ASR 시간 기준을 구분하고 출처를 cue에 기록한다.
- STT가 단어 타임스탬프를 제공하지 않으면 VAD/캡처 기반 구간 시간을 사용하고 정밀 단어 동기화라고 표시하지 않는다.

**실시간 번역에는 미래 문맥이 없다.** 현재 재생 중인 라이브 음성을 들은 뒤 만든 자막을 이미 지난 화면에 완벽히 맞출 수는 없다. 기본은 지연을 표시하는 라이브 모드다. 완성형 동기 자막은 접근 가능한 기존 자막·미리 처리된 허용 영상 등 선행 정보가 있는 경우에 제공한다. 단순한 Y축 위치 설정과 시간 동기화를 혼동하지 않는다.

## 11. 자막 렌더링과 커스터마이징

### F-8. 영상 선택·레이어 배치

- 화면에 보이고 재생 중인 영상 우선, 사용자 수동 선택 제공.
- SPA 이동·DOM 교체·영상 리사이즈에 대응한다.
- 플레이어 레터박스와 `object-fit`을 고려해 가능한 경우 실제 영상 영역을 계산한다.
- 전체화면 컨테이너 안으로 호스트를 옮기고 원래 위치 복원을 관리한다.
- 기본 `pointer-events: none`, 위치 조정 모드에서만 드래그를 받는다.
- 자막은 `textContent` 또는 안전한 텍스트 바인딩으로 넣고 HTML로 실행하지 않는다.

### F-9. 설정 기본값

- 폰트: Pretendard. Noto Sans KR, 나눔고딕, 맑은 고딕, 시스템 sans-serif 중 선택.
- 실제 폰트는 적법하게 번들하거나 설치 여부를 확인한다. 폰트 이름만 지정하고 로딩 완료로 처리하지 않는다.
- 글자 크기: 기본 24px, 14~48px. 반응형 크기 옵션 제공.
- 글자 색: `#FFFFFF`, 배경색: `#000000`.
- 배경 **불투명도**: 기본 70%, 0~100%. 기존 문서의 “투명도 70%”와 alpha 0.7 혼동을 바로잡는다.
- 위치: 영상 높이의 85%, 범위 10~95%. 자막 박스의 기준점을 명시하고 박스 전체가 화면 안에 있도록 보정한다.
- 상단/중앙/하단 프리셋과 자유 드래그, 좌/중앙/우 정렬.
- 효과: 없음 / 그림자 / 외곽선. 외곽선 두께 선택 가능.
- 최대 줄 수 기본 2줄, 줄 간격 1.35, 최대 폭 85%, 좌우·하단 안전 여백.
- 원문 병기, 원문 글자 크기 비율, 배경 패딩, 모서리 반경.
- 자막 시간 보정: -3~+3초. 아직 생성되지 않은 미래 번역을 앞당겨 생성하는 기능은 아니다.
- 전역/사이트별 설정, 미리보기, 초기화, 내보내기/가져오기.

저장 전 입력값을 검증하고 `chrome.storage.onChanged` 또는 런타임 메시지로 현재 자막에 즉시 반영한다. 목표는 설정 변경 후 100ms 이내 렌더 갱신이며 네트워크를 기다리지 않는다.

### F-10. 패널 구성

첫 화면에는 시작/중지, 입력 언어, 로컬/가성비/품질 모드, 연결 상태, 현재 지연, 음성 감지 상태를 둔다. 상세 설정은 스타일·모델·용어집·사용량으로 나눈다. 일반 사용자 화면에 샘플레이트·토큰 상한 같은 개발 설정을 기본 노출하지 않는다.

오류 문구는 “로컬 앱이 실행되지 않았습니다”, “현재 페이지에 자막을 표시할 권한이 필요합니다”, “처리가 영상보다 늦어지고 있습니다”처럼 다음 행동을 알 수 있게 쓴다.

## 12. 기존 자막 우선 활용

접근 가능한 `TextTrack` 또는 검증된 사이트 어댑터에서 원문 자막을 읽을 수 있으면 STT를 건너뛰는 경로를 둔다. 동기화와 비용에 유리할 수 있으나 자동 생성 자막의 품질이 낮을 수도 있으므로 사용자가 음성 재인식으로 전환할 수 있다.

모든 YouTube/OTT 자막을 표준 TextTrack으로 읽을 수 있다고 가정하지 않는다. 사이트 내부 API는 별도 어댑터와 변경 대응 대상이다. 기존 자막이 이미 한국어면 번역 없이 사용자 스타일로 표시하는 경로도 제공한다.

## 13. 내부 프로토콜과 상태 모델

프로토콜 버전은 `v1`으로 시작한다. 다음 이름은 제품 내부 설계이며 외부 공급자 API와 동일하다는 뜻이 아니다.

클라이언트→서버: `session.start`, `audio.frame`, `playback.update`, `settings.update`, `session.flush`, `session.stop`.

서버→클라이언트: `session.ready`, `stt.partial`, `stt.final`, `subtitle.upsert`, `subtitle.clear`, `usage.update`, `health.update`, `error`.

세션 상태: `idle → starting → capturing → stopping → idle`. 일시정지, 재연결, 처리 지연, 오류 상태를 별도로 갖는다.

자막 이벤트의 최소 필드:

```json
{
  "type": "subtitle.upsert",
  "protocolVersion": 1,
  "sessionId": "session-01",
  "generationId": 3,
  "cueId": "cue-0042",
  "revision": 2,
  "sourceLanguage": "ja",
  "sourceText": "明日の会議は午後三時です。",
  "translatedText": "내일 회의는 오후 3시입니다.",
  "audioStartSample": 160000,
  "audioEndSample": 192000,
  "sampleRate": 16000,
  "mediaStartMs": 10000,
  "mediaEndMs": 12000,
  "status": "final",
  "timingSource": "asr-segment",
  "provider": "local",
  "model": "configured-model-id"
}
```

위 시간은 1배속이고 샘플 0이 영상 0초에 대응하는 예시다. 실제 구현은 시간 앵커로 변환한다.

처리 규칙: 다른 세션/generation의 결과 폐기, 낮은 revision 무시, 같은 요청의 중복 처리 방지. 큐 길이와 최대 대기 시간을 제한하고 누락 구간을 명시한다. 통신 재연결 시 처리 완료 구간을 재과금하지 않도록 마지막 수신·확정 위치를 협상한다.

## 14. 성능 목표와 LG 그램 자원 관리

### 14.1 지연 정의

- 원문 초안 지연: 해당 인식 구절 끝의 실제 오디오 시각부터 원문 첫 표시까지.
- 한국어 초안 지연: 해당 구절 끝부터 번역 초안 첫 표시까지.
- 한국어 확정 지연: 발화/의미 단위 끝부터 확정 번역 표시까지.
- 발화 시작부터 첫 번역까지의 시간도 별도 기록해 문장이 길 때 생기는 기다림을 숨기지 않는다.

발화 끝 시각은 오프라인 평가용 정답 오디오에서 정의한다. 온라인 endpoint 감지 시각을 시작점으로 사용해 VAD 대기 시간을 빼지 않는다. p50과 p95를 언어·모드·영상 종류별로 보고한다.

### 14.2 초기 목표 — 성능 보장 아님

- 클라우드 스트리밍: 한국어 초안 p50 2초 이하, 확정 p95 4초 이하를 우선 시험 목표로 한다.
- 로컬/하이브리드: 한국어 초안 p50 3초 이하, 확정 p95 6초 이하를 초기 목표로 한다. 측정 후 달성 가능한 값으로 확정한다.
- 30~60분 연속 사용에서 지연이 누적 증가하지 않아야 한다.
- 프레임 드롭·오디오 끊김·자막 중복·탐색 후 이전 자막 표시는 기능 실패로 처리한다.

### 14.3 로컬 자원 운영

- 원본 가중치·양자화본·런타임 캐시를 포함해 초기 디스크 예산 20~40GB를 잡고 실제 다운로드 크기를 안내한다.
- 확장+동반 앱+모델의 RAM 예산은 초기 8~14GB 범위에서 측정·조정한다. 시스템과 브라우저에 여유를 남긴다. 모델별 실측값은 따로 표시한다.
- Arc가 공유 메모리를 사용하는 구성에서는 영상 디코딩, STT, MT가 메모리 대역폭과 전력 한도를 함께 쓴다.
- 추론 모델은 시작 때 로드·예열하고 매 문장마다 다시 로드하지 않는다.
- 로컬 STT/MT 동시 실행은 GPU 경쟁을 측정해 직렬 스케줄링 또는 CPU/GPU 분리를 선택한다. 전부 GPU에 올리는 것이 최선이라고 가정하지 않는다.
- 추론당 시간뿐 아니라 창 중첩 재연산까지 포함한 실제 처리량을 측정한다. 8초 창을 1초마다 재처리한다면 단순한 `추론 시간 / 8초`만으로 실시간 여부를 판단하지 않는다.
- 고부하 시 초안 재번역 감소 → 갱신 주기 완화 → 작은 모델 전환 순으로 로컬 모드를 조정한다. 유료 전환은 사전에 허용된 모드 안에서만 한다.
- NPU는 2차 최적화 대상으로 둔다. 실제 변환 그래프·드라이버·입력 길이 지원을 시험한 뒤 활성화한다. OpenVINO 릴리스 노트에 Core Ultra Series 3의 특정 NPU 드라이버 충돌이 기재되어 있어 배포 조합을 검증해야 한다. [OpenVINO 알려진 문제](https://docs.openvino.ai/2026/about-openvino/release-notes-openvino.html)

## 15. 권한·보안·개인정보

- 기본 권한: `activeTab`, `tabCapture`, `offscreen`, `scripting`, `storage`; Side Panel을 사용할 때 `sidePanel`.
- 사이트 지속 접근과 교차 출처 iframe은 필요한 호스트만 추가 요청한다. 모든 사이트 권한을 설치 시 무조건 요구하는 방식은 피한다.
- 로컬 서버는 `127.0.0.1`에만 바인딩한다. WebSocket Origin·Host 검증과 설치 시 만든 페어링 토큰을 함께 사용한다. CORS만으로 인증을 대신하지 않는다.
- 확장의 로컬 서버 연결은 콘텐츠 스크립트가 아닌 확장 출처에서 수행한다. Chrome 버전별 로컬 네트워크 접근·호스트 권한 동작도 시험한다. [확장 네트워크 권한](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- 외부 API 키를 확장 번들·페이지 DOM·Chrome Storage Sync에 넣지 않는다. 로컬 동반 앱 또는 서버가 공급자 호출을 맡는다.
- 기본은 원본 음성 미저장. 필요 길이의 메모리 버퍼만 두고 종료 때 해제한다. 디버그 음성·기록 저장은 사용자가 켠 경우에만 한다.
- 로그는 시간·오류 코드·모델·usage 위주이며 전사 전문과 API 키는 기본 기록하지 않는다.
- 로컬 모드는 외부 전송 0회, 하이브리드는 텍스트 전송, 클라우드는 음성 전송이라는 차이를 UI에 명확히 표시한다.
- 모델·ONNX·폰트·실행 코드는 출처와 라이선스를 기록한다. 외부에서 코드를 받아 확장에 실행하는 구조를 만들지 않는다.
- 서버 프레임 크기·세션 수·메모리·요청 속도에 제한을 둔다.

## 16. 장애 처리

- 로컬 앱 미실행: 설치/실행 안내, 사용자가 연결 시험을 다시 시도할 수 있게 한다.
- 모델 로딩 중: 로딩 상태 표시. 준비 전에 “번역 중”으로 표시하지 않는다.
- 권한 거부/캡처 실패: 원인별 안내 후 사용자 재시도. 무한 재시도 금지.
- 무음: 대기 상태 표시, 자막 환각과 API 호출 억제.
- 429/네트워크 오류: 공급자 지침에 맞춘 backoff, 작은 유한 큐, 중복 요청 방지.
- 영구 인증/결제 오류: 캡처 또는 외부 전송을 중지하고 해결 안내.
- 처리 지연: backlog를 표시하고 지난 자막을 한꺼번에 쏟아내지 않는다. 손실 구간은 기록한다.
- 브라우저 탭 닫힘·오디오 track ended·영상 교체: 자원 해제와 자막 초기화.
- 세션 시간 제한: 공급자 한도 전에 교체하고 경계 구간을 제한적으로 이어 붙인다. 중복 자막·중복 과금에 대한 계측을 남긴다.

## 17. 품질 검증과 출시 기준

### 평가 데이터

영어·일본어·중국어 각각 최소 30분씩 시작한다. 강의, 인터뷰, 드라마/예능 대화, 빠른 말, BGM, 전문 용어, 숫자·단위·고유명사를 포함한다. 사용 허가된 영상에서 원문 전사와 한국어 기준 번역을 만든다. 튜닝 데이터와 최종 평가 데이터를 분리한다.

### 측정

- 영어는 WER, 일본어·중국어는 CER 및 일관된 정규화 정책을 사용한다. 서로 다른 언어의 수치를 동일 의미로 단순 비교하지 않는다.
- 번역은 의미 보존, 누락·추가, 숫자·부정 오류, 용어 일관성, 한국어 자연스러움을 사람이 평가한다. 자동 지표는 보조로 쓴다.
- STT와 MT를 각각 평가하고, 최종 영상 자막도 별도로 평가한다. STT 오류와 번역 오류를 분류한다.
- 지연 p50/p95, 확정 후 수정률, 문장 중복률, 누락 시간, 시간당 비용, RAM 피크, 장시간 대기열 증가를 측정한다.

### 초기 합격 기준

- 의미 보존 평균 4/5 이상, 숫자·부정 등 중대 오역 비율 2% 이하를 초기 내부 목표로 둔다. 샘플과 평가자 기준을 고정해 재현한다.
- 기존 고정 모델 기준선보다 오류가 줄어들거나, 허용 품질을 유지하면서 비용/지연이 개선되어야 모델을 교체한다.
- 60분 사용 후 처리 지연이 계속 증가하지 않고 정상 중지 시 캡처와 모델 작업이 종료되어야 한다.
- 탐색 후 이전 generation 자막 0건, 종료 후 신규 외부 음성 전송 0건.
- 일반 재생·전체화면·배속·일시정지·탐색·SPA·iframe·네트워크 단절·30초 무음·다중 영상 혼합을 시험한다.
- 최소 권한 상태, 로컬 인증 실패, 악성 자막 입력, 긴 응답, 공급자 순서 뒤바뀜을 시험한다.

언어별 WER/CER 절대 합격선은 기준선 측정 후 정한다. 근거 없는 “정확도 99%”를 제품 문구로 쓰지 않는다.

## 18. 단계별 개발 로드맵

### Phase 0 — 이 노트북에서 실현 가능성 확인

정확한 CPU/GPU·드라이버·전력 모드를 기록한다. Whisper small/turbo와 로컬 MT 4B를 각각 및 동시에 시험하고, 가성비 API 번역과 비교한다. 결과물은 언어별 품질·지연·RAM·연속 처리량 측정치와 고정된 런타임 조합이다. 이 단계가 모델 기본값을 결정한다.

### Phase 1 — 캡처·시간축·오버레이

사용자 시작/중지, Offscreen 오디오, 원래 소리 재생, 영상 선택, Shadow DOM, 전체화면 조건부 대응, 설정 즉시 반영을 구현한다. 가짜 자막 이벤트로 순서·탐색·중복 문제부터 검증한다.

### Phase 2 — 로컬 STT와 로컬 MT

VAD, rolling buffer, 안정화, glossary, revision, 로컬 인증, 자원 제한을 연결한다. 영·중·일 실제 영상에서 완전 로컬 모드를 통과시킨다.

### Phase 3 — 저비용 API와 사용량

Luna를 첫 MT 어댑터로 추가하고, 필요하면 Gemini와 DeepL을 비교한다. 예산 상한, usage 기록, 실패 처리, 사이트 설정을 구현한다. 사용자가 선택한 모드만 외부 요청을 허용한다.

### Phase 4 — 품질 모드와 호환성

Nova-3 등 스트리밍 STT, 상위 MT 선택적 교정, 기존 자막 우선 경로, YouTube/iframe/OTT 시험을 추가한다. 지원하지 못하는 환경은 명시한다.

### Phase 5 — 배포·최적화

Windows 동반 앱 패키징, 최초 모델 다운로드/무결성 확인, 업데이트·버전 고정, 확장 스토어 패키지, 접근성, 60분 회귀 시험을 완성한다. Qwen3-ASR/OpenVINO, NPU, PiP는 성능·호환성 결과에 따라 후속 채택한다.

일정은 Phase 0 뒤 확정한다. 로컬 모델 호환성과 사이트별 대응이 확인되기 전에 고정된 완료 일정을 약속하지 않는다.

## 19. 개발 산출물 구조

```text
subtrans-ai/
  apps/extension/       # WXT, 팝업, 패널, 콘텐츠, offscreen, worklet
  apps/companion/       # FastAPI, 인증, 세션, 모델 관리, Windows 패키징
  packages/protocol/    # 이벤트 스키마와 버전
  providers/stt/       # OpenVINO Whisper, 클라우드, 실험 어댑터
  providers/mt/        # 로컬 모델, Luna, Gemini, DeepL, 상위 모델
  tests/               # 단위, 프로토콜, 브라우저, 장애 복구
  benchmarks/          # 허가된 평가 데이터 정의, 품질·지연·비용 결과
  docs/                # 설치, 권한, 지원 사이트, 모델 카드, 운영 정책
```

모델 파일은 저장소에 직접 넣지 않는다. 공급자·정확한 모델 ID·revision/해시·라이선스·양자화 방식·평가 결과를 모델 목록에 기록한다. 공급자의 최신 별칭이 바뀌면 회귀 평가를 거친 뒤 업데이트한다.

## 20. 이번 프로젝트의 권장 결정

1. **개발 기본 구조:** Chrome MV3 + WXT/React + Offscreen AudioWorklet + Windows 로컬 동반 앱.
2. **이 LG 그램의 로컬 STT:** OpenVINO Whisper small로 기준선 확보, large-v3-turbo가 연속 처리·품질 시험을 통과하면 승격.
3. **완전 무료 번역:** Qwen3.5-4B 4비트부터 시작. TranslateGemma 4B와 Qwen3.5-9B는 비교 후 채택.
4. **가장 추천하는 실사용 모드:** 위 로컬 STT + GPT-6 Luna 번역. 원문 음성 외부 전송 없이 번역 비용을 낮추는 구성이다.
5. **로컬 STT가 어려운 콘텐츠:** 사용자 선택으로 Nova-3 등 클라우드 STT를 적용한다. 중국어 언어 모드 제약을 확인한다.
6. **최고 품질:** 언어별 우수 STT + Sol/Sonnet급 번역, 어려운 문장만 Astra/Opus급으로 교정. 최종 승자는 자막 평가에서 결정한다.
7. **출시 약속:** 지원 영상에서 안정적으로 작동하는 영·중·일→한국어 자막. 모든 OTT 완전 호환, 무료 모드 항상 2초 미만, 번역 정확도 100%는 약속하지 않는다.

이 문서는 개발 가능한 구조와 평가 기준을 정한 명세다. 확장프로그램 구현·모델 설치·노트북 실측은 아직 수행하지 않았다.
