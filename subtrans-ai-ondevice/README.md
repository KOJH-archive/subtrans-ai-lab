# SubTrans AI · On-device Lab 0.4

기존 `subtrans-ai` API 버전과 **완전히 별도로 설치하는 Chrome 내장 AI 실험판**입니다. OpenAI/Gemini API 키나 별도 서버 없이 브라우저의 모델을 사용합니다. 기존 API 버전의 파일은 수정하지 않았습니다.

## 현재 되는 일

1. **기존 영상 자막 번역(권장):** HTML5 `<video>`의 자막/캡션 트랙에서 영어·일본어·중국어 텍스트를 읽고 Chrome `Translator` API로 한국어 자막을 띄웁니다. Chrome 138 이상 데스크톱 환경에서 언어쌍이 제공되어야 합니다.
2. **Gemini Nano 음성 실험:** 현재 탭 오디오를 캡처하고, 브라우저 `LanguageModel` Prompt API의 오디오 입력으로 영어·일본어 음성을 전사한 다음 `Translator`로 한국어 번역합니다. 오디오 입력 지원 GPU와 Chrome 빌드가 필요합니다. 중국어 음성은 이 경로에서 지원하지 않습니다.
3. **한국어 음성 → 영어/일본어 실험:** Chrome의 온디바이스 `SpeechRecognition`이 한국어 탭 음성을 인식하면 `Translator`가 영어 또는 일본어로 번역합니다. 한국어 음성팩과 대상 언어팩을 먼저 준비해야 합니다. 기존 영·일 음성 경로와 별도로 작동합니다.

팝업에서 지원 여부를 표시합니다. 첫 사용은 **원문 언어 선택 → 언어팩 / 모델 미리 준비 → 현재 탭에서 시작** 순서가 좋습니다. 팝업의 **전체 화면 내장 AI 실험실**에서는 창을 계속 열어 둔 채 **Nano 모델만 미리 준비**할 수 있고, 실제 텍스트 번역과 음성 파일 전사·번역 응답도 확인할 수 있습니다. Chrome이 모델을 최초 다운로드할 때 인터넷·저장공간을 사용하지만, 번역/전사 추론은 기기에서 실행됩니다. 확장 자체는 `connect-src 'none'`이며 클라우드 API 요청 코드는 없습니다.

## 설치

Chrome 주소창에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다. **압축해제된 확장 프로그램을 로드합니다**로 이 프로젝트의 `dist` 폴더를 선택합니다. ZIP을 받았다면 먼저 풀고 `manifest.json`이 있는 폴더를 선택합니다. 기존 API 버전과 나란히 설치할 수 있습니다.

**Chrome 플래그는 기본 설치 단계가 아닙니다.** Translator API와 확장 프로그램용 Prompt API는 Chrome 138부터 안정 버전에 제공됩니다. 현재 Chrome을 최신으로 업데이트한 뒤, 팝업에 표시되는 API 지원 상태와 **전체 화면 내장 AI 실험실**의 실제 응답을 먼저 확인하세요. `unavailable`은 플래그가 꺼졌다는 뜻으로 단정할 수 없으며, 지원 언어·기기 사양·모델 다운로드 조건에 따라 달라집니다. 오래된 개발/시험용 Chrome 빌드에서 플래그를 사용한다면 해당 빌드의 공식 안내를 확인해야 합니다. 이 확장은 특정 `chrome://flags` 항목의 수동 활성화를 요구하지 않습니다.

동영상 페이지를 열고 확장 아이콘을 누릅니다. 기존 자막이 있으면 **영상의 기존 자막 번역**을 선택하고, 영어·일본어·중국어 중 언어를 지정합니다. **전체 화면 내장 AI 실험실**에서 먼저 해당 언어의 실제 번역 응답을 확인하면 모델 다운로드 상태를 분명히 알 수 있습니다. 그다음 팝업에서 **현재 탭에서 시작**을 누릅니다. 팝업을 닫아도 작동하며 다시 열어 중지할 수 있습니다.

음성 실험은 자막이 없는 영상에서 **Gemini Nano 음성 인식 · 실험**을 선택하고 영어 또는 일본어를 지정합니다. 팝업이 `unavailable`을 표시하거나 준비가 실패하면 그 Chrome/기기 조합에서 사용할 수 없습니다. 사용자가 알려준 32GB RAM과 Intel Arc 내장 그래픽 정보만으로는 Prompt API 오디오 입력의 **4GB 초과 GPU VRAM 조건** 충족 여부를 판정할 수 없습니다. 실제 `LanguageModel.availability()` 결과가 기준입니다.

한국어 영상을 영어 또는 일본어로 바꾸려면 **한국어 음성 → 영어/일본어 · 실험**을 선택합니다. 팝업의 **언어팩 / 모델 미리 준비**를 눌러 한국어 음성팩과 번역 언어팩을 준비한 후 시작합니다. 이 경로의 실제 영상 인식 품질은 아직 검증되지 않았습니다.

## 구현 범위와 제약

- 기본 자막 모드는 **브라우저가 노출하는 HTML5 TextTrack**만 읽습니다. YouTube 자체 자막 UI, 일부 OTT·DRM, 교차 출처 iframe, PiP, 자막 없는 영상은 이 모드에서 번역할 수 없습니다.
- 자막 표시는 이미 **Shadow DOM 오버레이**입니다. 음성 모드에서는 페이지에 `<video>`가 없어도 탭 오디오를 처리하고 화면에 자막을 띄울 수 있습니다. 오버레이나 투명 iframe을 추가해도 접근할 수 없는 커스텀 자막 원문을 읽거나 DRM을 우회할 수는 없습니다.
- 음성 실험은 약 4초 발화 구간 단위로 처리합니다. 강제 분할 시 앞 청크의 마지막 **0.7초를 다음 청크에 겹쳐** 넣고, 전사에서 반복된 앞부분을 제거합니다. 무음 종료에는 겹침을 적용하지 않습니다. 즉시 자막이나 2초 이내 지연을 보장하지 않으며, 음악/효과음이 큰 영상에서 음성 감지가 잘못될 수 있습니다.
- Chrome Prompt API의 현재 공식 언어 목록에 한국어·중국어가 없어 Nano에 한국어 번역을 맡기지 않습니다. Nano는 영어/일본어 전사만 수행하며, 한국어는 별도 내장 Translator API가 담당합니다.
- 사이트가 영상 요소 자체를 전체화면으로 만들면 브라우저의 native TextTrack으로 자막을 표시합니다. 이때 스타일 일부가 제한될 수 있습니다.
- 모델 다운로드에는 온라인 연결과 저장 공간이 필요합니다. Chrome 버전·기기·언어쌍에 따라 지원 여부가 다릅니다. 첫 Gemini Nano 다운로드가 5분을 넘어 실제 테스트를 막아 모델 준비 제한을 20분으로 늘렸습니다. 모델 상태는 `chrome://on-device-internals`에서 확인할 수 있습니다.
- 설치된 Chrome 153의 별도 임시 프로필에서 **실제 Translator API**로 `Good morning.` → `좋은 아침입니다.` 응답을 확인했습니다. 또한 실제 Chrome에 확장을 로드해 사용자가 지정한 영어·일본어 YouTube 영상을 각각 약 40초 재생했습니다. 두 영상 모두 오디오 모드 시작·탭 오디오 캡처·Shadow DOM 오버레이 삽입은 확인했지만, 최초 Gemini Nano 다운로드가 완료되지 않아 번역 자막은 0개였습니다. 따라서 두 영상의 전사·번역 품질과 지연은 아직 검증되지 않았습니다. 상세 수치는 [검증 기록](docs/검증기록.md)에 있습니다.

## 개발 검증

Node.js 22 이상에서 `npm test`, `npm run check`, `npm run build`를 실행합니다. Chrome 통합 검사는 Playwright 및 Chrome for Testing 경로를 환경 변수 `SUBTRANS_PLAYWRIGHT`, `SUBTRANS_BROWSER`에 지정하고 `node scripts/browser-test.mjs`를 실행합니다. Chrome 153 이상 정식 빌드에서는 `SUBTRANS_CDP_LOAD=1`을 추가합니다. 현재 단위 테스트 5개와 Chrome 통합 검사 13개가 통과했습니다. 상세 범위는 [검증 기록](docs/검증기록.md)에 있습니다.

공식 근거: [Chrome 138 안정 버전 제공 범위](https://developer.chrome.com/blog/ai-api-updates-io25), [Translator API](https://developer.chrome.com/docs/ai/translator-api), [Prompt API와 오디오·언어·GPU 조건](https://developer.chrome.com/docs/ai/prompt-api), [Chrome 확장 탭 오디오 캡처](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [내장 AI 시작하기](https://developer.chrome.com/docs/ai/get-started).
