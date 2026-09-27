# SubTrans AI Lab

Experimental Chrome extensions for translating web video speech and captions.

SubTrans AI Lab은 Chrome에서 재생되는 웹 동영상의 음성 또는 기존 자막을 번역해 영상 위에 표시하는 연구용 프로토타입입니다. Chrome 내장 AI를 사용하는 무료 온디바이스 방식과 사용자가 직접 제공한 OpenAI 또는 Gemini API 키를 사용하는 방식을 각각 독립된 확장프로그램으로 실험합니다.

> [!WARNING]
> 이 저장소는 실험과 기술 검증을 위한 알파 단계 프로젝트입니다. 프로덕션 사용, 모든 웹사이트 호환, 일정한 실시간 성능 또는 번역 정확도를 보장하지 않습니다.

## Editions

### On-device Lab 0.4

`subtrans-ai-ondevice/`

Chrome의 Gemini Nano, Translator API와 로컬 Speech Recognition을 사용합니다. 지원되는 환경에서는 음성과 자막을 외부 AI API로 보내지 않으며 별도의 API 키와 사용료가 필요하지 않습니다.

현재 구현:

- 영어·일본어 탭 음성 → Gemini Nano 전사 → 한국어 번역
- HTML5 영어·일본어·중국어 자막 → 한국어 번역
- 한국어 탭 음성 → 영어·일본어 번역 실험
- 탭 오디오 캡처와 원래 영상 소리 유지
- 약 4초 음성 구간과 강제 분할 시 0.7초 오버랩
- Shadow DOM 자막 오버레이
- 자막 크기·위치·원문 표시 설정
- 전체 화면 내장 AI 실험실과 모델 사전 준비
- 외부 AI 서버 연결 차단

실제 Chrome에서 Gemini Nano의 오디오 세션과 YouTube 영상의 한국어 자막 출력을 확인했습니다. 현재 자막은 음성보다 1~2초 이상 늦게 표시될 수 있으며 YouTube 자체 자막보다 문장 연결이 덜 자연스러울 수 있습니다.

### API Edition 0.1

`subtrans-ai/`

사용자가 직접 제공한 OpenAI 또는 Gemini API 키로 탭 음성을 처리합니다. 별도의 운영 서버 없이 선택한 공급자의 API를 확장프로그램이 직접 호출합니다.

현재 구현:

- OpenAI 음성 전사 후 한국어 번역
- Gemini 오디오 이해를 이용한 원문·한국어 생성
- 가성비·고품질 모드
- 직전 자막 문맥과 사용자 용어집
- 자막 스타일 설정과 SRT 내보내기
- 요청 큐, 시간 제한, 취소와 늦은 응답 차단
- API 키의 세션 저장과 선택적 기기 저장

API 연결 구조는 모의 응답으로 검증했지만 실제 사용자 키를 사용한 언어별 품질, 요금과 지연 시간 평가는 아직 완료하지 않았습니다.

## Current architecture

```text
Current Chrome tab
  → tabCapture
  → Offscreen Document
  → AudioWorklet / speech segmentation
  → Chrome built-in AI or OpenAI/Gemini API
  → Content Script
  → isolated Shadow DOM subtitle overlay
```

Manifest V3 서비스 워커는 권한, 세션과 메시지를 관리합니다. 장시간 오디오 스트림과 AI 처리는 Offscreen Document에서 실행합니다. 웹페이지에는 API 키를 전달하지 않습니다.

## Requirements

공통:

- Windows 또는 데스크톱 Chrome
- Node.js 22 이상은 개발과 검사에만 필요

On-device Lab:

- Chrome 138 이상
- Chrome 내장 AI를 지원하는 CPU/GPU와 충분한 저장 공간
- Gemini Nano 오디오 입력은 지원되는 GPU 환경 필요
- 최초 모델과 언어팩 다운로드 시 인터넷 연결 필요

API Edition:

- Chrome 116 이상
- 본인이 관리하는 OpenAI 또는 Gemini API 키
- API 계정의 모델 접근 권한과 사용 가능 할당량

## Install locally

각 edition 폴더에서 빌드합니다.

```powershell
npm test
npm run check
npm run build
```

그다음 Chrome에서 다음 순서로 설치합니다.

1. `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
4. 사용할 edition의 `dist` 폴더를 선택합니다.

두 edition은 서로 독립적이며 동시에 설치할 수 있습니다.

## On-device model setup

1. On-device Lab 확장 아이콘을 엽니다.
2. **전체 화면 내장 AI 실험실**을 엽니다.
3. **Nano 모델만 미리 준비**를 누릅니다.
4. 다운로드가 완료될 때까지 Chrome과 실험실 창을 유지합니다.
5. `chrome://on-device-internals`에서 모델과 오류 상태를 확인할 수 있습니다.

Chrome이 모델을 프로필별로 관리하므로 실제 사용할 Chrome 프로필에서 준비해야 합니다. Chrome 업데이트, 프로필 삭제 또는 저장 공간 부족으로 모델이 제거되면 다시 다운로드될 수 있습니다.

## Known limitations

- On-device 음성 경로는 현재 완전한 스트리밍 전사가 아니라 짧은 오디오 청크를 순차 처리합니다.
- 약 4초 청크, 무음 판정, Nano 전사와 번역의 직렬 처리 때문에 자막이 늦을 수 있습니다.
- 현재 On-device Nano 음성 모드는 영어와 일본어만 지원합니다.
- YouTube의 자체 자막은 일반 HTML5 `TextTrack`으로 노출되지 않을 수 있습니다.
- 일부 OTT, DRM 영상, 교차 출처 iframe, Picture-in-Picture와 특수 전체화면은 동작하지 않을 수 있습니다.
- 탭의 광고, 알림과 다른 미디어 소리가 함께 캡처될 수 있습니다.
- API Edition은 선택한 공급자에게 현재 탭 음성과 필요한 문맥을 전송합니다.

## Validation status

- API Edition: 단위 테스트 18개, Chrome 통합 검사 15개 통과
- On-device Lab: 단위 테스트 5개, Chrome 통합 검사 13개 통과
- 실제 Chrome Translator의 영어→한국어 응답 확인
- 실제 Gemini Nano `audio_input=1` 세션 생성 확인
- 실제 YouTube 영상의 On-device 한국어 자막 출력 확인

브라우저 통합 검사 중 AI 공급자 응답을 사용하는 항목은 재현 가능한 모의 모델로 검사합니다. 실제 서비스 모델 품질과 장시간 안정성은 별도의 수동 평가가 필요합니다.

## Roadmap

1. 영어·일본어 실제 영상의 단계별 지연과 오류 계측
2. YouTube 기존 자막을 우선 사용하는 사이트 어댑터
3. 적응형 2초대 오디오 구간과 짧은 무음 판정
4. 초안·확정 자막과 cue revision
5. 원문 문맥, 중복 제거와 문장 안정화 개선
6. 실제 OpenAI/Gemini 키의 품질·속도·비용 비교
7. 사이트별 호환성 표와 장시간 회귀 시험

## Documentation

- [통합 개발명세서 v4](./SubTrans-AI-통합개발명세서-v4.md)
- [이전 기술 조사·로컬 모델 설계안](./SubTrans-AI-개발명세서-v2.md)
- [API Edition 개발명세](./subtrans-ai/docs/API-개발명세-v3.md)
- [API Edition 검증 기록](./subtrans-ai/docs/검증기록.md)
- [On-device Lab 개발명세](./subtrans-ai-ondevice/docs/개발명세.md)
- [On-device Lab 검증 기록](./subtrans-ai-ondevice/docs/검증기록.md)

## Privacy and cost

On-device Lab의 추론은 Chrome이 관리하는 로컬 모델에서 실행되며 확장에는 외부 AI 호스트 권한이 없습니다. API Edition은 사용자가 선택한 OpenAI 또는 Gemini API로 직접 요청하며 공급자의 정책과 요금이 적용됩니다.

API 키, 실제 `.env` 파일, 브라우저 프로필, 다운로드된 모델, 테스트 결과와 빌드 파일은 저장소에 포함하지 않습니다.

## Project status

Research prototype / experimental alpha. Contributions and reproducible test reports are welcome, but the repository should not yet be treated as a production subtitle service.

