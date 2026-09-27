# SubTrans AI — API Edition 0.1

**OpenAI 또는 Gemini API 키 하나로 동영상의 한국어 자막을 생성하는 Chrome 확장프로그램입니다.** 별도 서버·로컬 모델·동반 앱 설치가 필요 없습니다.

## 설치와 사용

1. Chrome 주소창에 `chrome://extensions`를 입력합니다.
2. 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 프로젝트의 `dist` 폴더를 선택합니다. ZIP으로 받았다면 먼저 압축을 풀고 `manifest.json`이 들어 있는 폴더를 선택합니다.
4. 유튜브 등 일반 웹페이지에서 동영상을 재생합니다.
5. 확장 아이콘 → OpenAI 또는 Gemini API 키 입력 → **현재 탭 번역 시작**.
6. **자막 스타일 · 상세 설정**에서 글꼴, 크기, 색상, 배경, 위치, 원문 병기, 용어집을 바꿉니다.

API 키는 채팅에 보내지 말고 확장프로그램 설정에 직접 입력하세요. `sk-`는 OpenAI, `AIza`는 Gemini로 감지합니다. 다른 형식의 키는 공급자를 수동 선택할 수 있습니다.

키 발급: [OpenAI Platform](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey). ChatGPT/Gemini 월 구독과 API 사용료는 별개입니다. 해당 모델 접근 권한과 API 할당량이 있어야 합니다.

## 구현된 기능

- Manifest V3의 서비스 워커 + Offscreen Document + AudioWorklet.
- 탭 오디오 캡처와 원래 소리 재생 유지, 16kHz PCM WAV 생성.
- 에너지 기반 무음 감지, 유한 길이 음성 분할, 한 번에 한 요청 파이프라인.
- OpenAI: `gpt-4o-mini-transcribe` → `gpt-6-luna`. 고품질: `gpt-4o-transcribe` → `gpt-6-sol`.
- Gemini: `gemini-3.5-flash-lite` 음성→원문+한국어. 고품질: `gemini-3.8-flash`.
- 한 공급자의 키만 사용. 다른 공급자로 자동 전환하거나 키를 보내지 않습니다.
- 직전 3개 구간 문맥, 최대 40개 용어집, JSON 응답 검증.
- Shadow DOM 자막, 사이트 전체화면 컨테이너 대응, 영상 요소 자체 전체화면에서는 native TextTrack 대안.
- 키의 세션 보관 또는 사용자가 선택한 기기 저장. 웹페이지·콘텐츠 스크립트에는 키를 전달하지 않습니다.
- 탐색/일시정지/배속/영상 변경 시 이전 작업 취소, 세대 번호로 늦은 응답 차단.
- 처리량 초과 시 큐 제한·오래된 구간 건너뛰기, 429·API 오류 시 중지.
- 기본 30분 자동 중지, 요청 수·자막 수·구간 완료 후 처리 지연 표시.
- 현재 브라우저 세션의 최근 최대 2,000개 자막 유지. SRT는 마지막 연속 재생 구간만 내보냅니다.

## 이번 버전의 범위

이 버전은 **짧은 음성 구간을 연속 처리하는 초기 버전**입니다. 원어민 발화가 끝나기도 전에 단어 단위로 번역되는 네이티브 스트리밍 구현은 아닙니다. 무음이 감지되면 일찍 확정하며 긴 발화는 기본 최대 3.6초마다 나눕니다. 구간 수집 + 네트워크 + 모델 시간 때문에 수 초 이상의 지연이 발생할 수 있습니다.

에너지 감지는 실제 음성과 음악을 정확히 구별하는 신경망 VAD가 아닙니다. 작은 목소리는 민감도를 높이고 BGM이 큰 영상에서는 요청량을 확인하세요. 고정 길이 분할 경계에서 단어나 문장이 잘릴 수 있고, 타임스탬프는 구간 단위입니다. 프리롤에는 짧은 무음이 포함될 수 있습니다.

일반 최상위 페이지의 `<video>`를 자동 선택합니다. 접근 권한이 필요한 교차 출처 iframe, 닫힌 Shadow Root, PiP, 일부 DRM/OTT는 자동 영상 추적을 지원하지 않습니다. 영상이 감지되지 않으면 탭 오디오를 번역해 창 하단에 표시하며 탐색·일시정지 추적과 정밀 영상 시각은 사용할 수 없습니다. 탭의 모든 소리가 섞일 수 있습니다. 페이지를 새로 열거나 이동하면 안전하게 중지하며 다시 시작해야 합니다.

자막 미리보기의 폰트는 설치된 시스템 폰트를 사용합니다. Pretendard 등의 폰트 파일은 포함하지 않았습니다. 영상 자체 전체화면에서 native 자막으로 대체되면 사용자 스타일 일부가 적용되지 않을 수 있습니다.

이 소스에는 실제 API 키가 없습니다. 연결 확인은 모델 메타데이터 접근만 검사하며, 음성/번역 청구 가능 여부나 품질·지연을 입증하지 않습니다. 실제 API 유료 호출과 언어별 번역 품질은 사용자 키로 별도 검증해야 합니다.

## 개인정보와 비용

시작을 누르면 **현재 탭의 음성, 앞선 자막 문맥, 용어집**이 선택한 공급자로 직접 전송됩니다. OpenAI 경로는 음성 전사 후 원문/문맥을 동일 공급자의 텍스트 모델에 보냅니다. Gemini 경로는 음성과 문맥을 한 요청으로 보냅니다. 별도 운영자 서버·추적 도구·원본 음성 저장은 없습니다. 공급자의 자체 데이터 보관 정책은 해당 API 계정 조건을 따릅니다.

키는 기본 `chrome.storage.session`에 보관합니다. **이 브라우저에 키 기억하기**를 켜면 `chrome.storage.local`에 저장하며 별도 암호화하지 않습니다. 둘 다 TRUSTED_CONTEXTS 접근 제한을 적용합니다. 본인이 관리하는 PC용 BYOK 초기 배포이며, 대규모 서비스 배포 시에는 사용자별 인증·토큰 발급·비용 관리 백엔드를 추가해야 합니다.

현재 소스는 비용 추정치를 임의로 표시하지 않습니다. 시간 제한은 달러 한도가 아니며, 최종 비용은 공급자 대시보드에서 확인해야 합니다. 사용자 설정과 무관한 재시도나 고가 모델로의 자동 fallback은 하지 않습니다. 취소 전에 이미 전송된 API 요청은 공급자에서 처리·과금될 수 있습니다.

## 개발·검증

Node.js 22 이상. 프로덕션 확장은 외부 JavaScript 패키지 없이 동작하며 빌드도 단순 복사 방식입니다. 초기 구현은 Chrome API를 직접 사용하므로 React/WXT 설치가 필요 없습니다.

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
```

- `extension/`: 실제 확장 소스. 이 폴더 자체도 압축해제 확장으로 로드할 수 있습니다.
- `dist/`: 설치용 결과물. 배포 시 테스트·브라우저·문서는 제외됩니다.
- `tests/`: 오디오 시간축, 분할, 공급자 요청, 취소, 자막 파일 검증.
- `docs/`: 구현 범위·검증 기록.

공식 API 확인 기준: 2026-09-26. [OpenAI 전사](https://developers.openai.com/api/docs/guides/speech-to-text), [Responses](https://developers.openai.com/api/docs/guides/text), [Gemini 오디오](https://ai.google.dev/gemini-api/docs/generate-content/audio), [Gemini 3.8 모델 옵션](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/), [Chrome 캡처](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture).
