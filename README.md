# Docs Finder

선택한 폴더의 일반 파일과 PDF, Excel, PowerPoint, Word **내용**을 검색하는 Electron + JavaScript 데스크톱 앱입니다. 문서를 읽는 데 Office 설치나 외부 API가 필요하지 않습니다. 파일을 열 때는 OS에 연결된 프로그램을 사용합니다.

## 실행

Node.js **22.13 이상**이 필요합니다. Windows x64에서 개발·빌드·실행을 검증했습니다.

```powershell
npm ci
npm start
```

이미 의존성이 설치되어 있으면 `npm start`만 실행하면 됩니다. `npm run dev`는 개발자 도구를 함께 엽니다.

빌드된 Windows 실행 파일은 `release/Docs-Finder-1.0.0-x64.exe`입니다. 설치 없이 실행하는 portable 배포본으로, Node.js가 없는 PC에서도 사용할 수 있습니다. `release/win-unpacked/Docs Finder.exe`로도 실행할 수 있으며, 이 경우 `win-unpacked` 폴더 전체를 함께 유지해야 합니다.

## 사용법

1. **폴더 선택**을 누르거나 폴더의 절대 경로를 입력합니다.
2. 단어 또는 문장을 입력하고 **검색하기**를 누릅니다.
3. 왼쪽 파일을 선택하면 오른쪽에 일치한 내용과 위치가 표시됩니다.
4. **파일 열기**, **폴더에서 보기**, **경로 복사**로 원본을 사용합니다. 파일 목록 더블클릭도 열기입니다.
5. 결과를 보관하려면 **CSV 내보내기**를 사용합니다. Excel에서 한글이 보이도록 UTF-8 BOM을 넣고, 수식으로 오인할 수 있는 셀을 이스케이프합니다.

검색 중에도 결과가 즉시 표시됩니다. **검색 중지**는 파싱 중인 워커를 종료하고 이미 발견한 결과를 남깁니다. 처리를 건너뛴 파일과 손상·암호화·권한·시간 초과 오류는 결과 하단 **건너뜀·오류**에서 확인합니다.

| 형식                                                 | 검색하는 내용                                                     | 결과 위치                      |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| 일반 텍스트 / 소스 / JSON / MD / HTML / XML / CSV 등 | 파일의 원문 텍스트. 알 수 없는 확장자도 텍스트로 판별되면 포함    | 물리적 줄 번호                 |
| `.pdf`                                               | 페이지에 저장된 추출 가능한 텍스트                                | 페이지                         |
| `.xlsx`, `.xlsm`                                     | 셀 값, 리치 텍스트, 수식 원문과 저장된 계산 결과, 메모, 숨김 시트 | 시트명 + 셀 주소               |
| `.pptx`, `.pptm`, `.ppsx`                            | 텍스트 상자, 표, 발표자 노트                                      | 실제 발표 순서의 슬라이드 번호 |
| `.docx`, `.docm`                                     | 본문, 표, 머리글·바닥글, 각주·미주, 메모                          | 영역 + 추출 문단 번호          |

일반 텍스트는 UTF-8, BOM이 있는 UTF-16 LE/BE, 한국어 CP949를 자동 판별합니다. 상세 옵션에서 UTF-8 / CP949 / UTF-16 LE로 직접 지정할 수도 있습니다. Office 매크로·수식·링크를 실행하거나 다시 계산하지 않습니다.

### 검색 옵션과 단축키

- 하위 폴더, 대소문자 구분, 유니코드 단어 단위 검색, JavaScript Unicode 정규식을 지원합니다.
- 확장자: `*.pdf, *.xlsx` 또는 `pdf, docx`처럼 쉼표로 구분합니다. 비워 두면 모든 지원 형식을 검사합니다.
- 제외 항목: 폴더·파일 이름 또는 `/`로 구분한 상대 경로를 사용합니다. `*`, `?` 와일드카드를 지원합니다. 기본적으로 `.git`, `node_modules`, `dist`, `build`, `release` 등을 제외합니다.
- 점으로 시작하는 파일·폴더는 기본 제외합니다. Windows의 숨김 속성 자체를 판별하는 옵션은 아닙니다.
- 최근 폴더 6개, 최근 검색어 5개와 검색 옵션은 이 PC의 앱 저장소에 남습니다. 검색어 옆 **×**로 기록을 개별 삭제하고, 기록이 여러 개일 때는 **전체 지우기**로 모두 삭제할 수 있습니다. 문서 텍스트는 저장하지 않습니다.
- `Ctrl+Enter`: 검색, `Ctrl+O`: 폴더 선택, `Ctrl+F`: 검색어 입력, `Esc`: 검색 중지.
- 파일 목록에서 위·아래 방향키로 선택하고 `Enter`로 파일을 엽니다.

## 샘플과 CLI

```powershell
npm run samples
```

`samples` 폴더에 실제 PDF·XLSX·PPTX·DOCX, UTF-8·CP949·UTF-16 텍스트와 하위 폴더를 만듭니다. 이 폴더에서 **자동화 테스트** 또는 **SEARCH_TOKEN**을 검색해 보세요. Windows의 맑은 고딕 글꼴이 없으면 PDF 샘플만 영문으로 생성됩니다.

검색 엔진을 Electron과 분리했으므로 CLI로도 사용할 수 있습니다. 결과는 JSON Lines로 표준 출력에, 처리 내역과 통계는 표준 오류에 기록합니다.

```powershell
npm run search -- "D:\Documents" "자동화 테스트"
npm run search -- "D:\Documents" "테스트\s+\d+" --regex "--ext=*.pdf,*.docx"
```

## 구현 구조

```text
electron/                 창, 폴더 선택, 제한된 IPC, OS 파일 동작, CSV
ui/                       한국어 UI (HTML / CSS / JavaScript, 빌드 과정 불필요)
core/
  options.js              검색 옵션 검증, 확장자·제외 패턴
  scanner.js              비동기 폴더 탐색, 링크·크기·경로 검사
  search-engine.js        작업 분배, 결과·처리 내역 스트리밍, 진행 통계
  worker-pool.js          3개 재사용 워커, 파일별 시간 제한, 취소
  workers/                추출과 검색 실행
  extractors/             PDF.js / ExcelJS / OOXML ZIP + XML 파서
  matcher.js              문자열·정규식·유니코드 단어 경계, 미리보기
scripts/                  CLI, 샘플 생성, Electron UI 검증
tests/                    실제 파일을 이용한 검색 엔진 회귀 테스트
assets/                   앱 아이콘
```

추출기는 `{ text, location }` 청크를 반환합니다. 일반 파일은 줄, PDF는 페이지, Excel은 셀, Word는 문단, PPT는 슬라이드 단위입니다. 검색 엔진은 이 공통 인터페이스만 사용합니다. 워커는 파일마다 추출·검색하고, UI에는 일치한 위치와 제한된 문맥만 보냅니다. 디스크 색인 없이 매 검색마다 원본을 읽는 방식입니다.

Renderer의 Node 접근을 끄고 `contextIsolation`, `sandbox`, CSP를 사용합니다. IPC는 앱의 메인 프레임만 허용하며 파일 열기·복사·탐색기 동작은 현재 검색 결과에 등록되고 선택 폴더 안에 있는 파일로 제한합니다. Windows에서 실행될 수 있는 `.js`, `.cmd`, `.ps1` 등의 텍스트 파일은 **메모장**으로 엽니다. 링크·정션을 따라가지 않으며 Office ZIP의 항목 수·압축 해제 크기, 워커 메모리와 처리 시간을 제한합니다.

## 범위와 제한

- OCR은 포함하지 않습니다. 이미지·스캔 PDF 안의 글자, 그림으로 삽입한 텍스트, 내장 개체와 차트의 모든 텍스트를 읽을 수 있는 것은 아닙니다. 텍스트 없는 PDF는 처리 내역에 표시합니다.
- 구형 `.doc`, `.xls`, `.ppt`, `.xlsb`와 HWP/HWPX는 지원하지 않습니다. 최신 Office 형식이나 텍스트 PDF로 변환해 주세요. 암호가 걸린 문서는 해제 후 검색해야 합니다.
- Word 문단은 **추출 기준**입니다. 화면의 페이지 번호가 아닙니다. PDF 텍스트의 읽기 순서는 문서 레이아웃에 따라 달라질 수 있습니다.
- 파일 열기는 원본을 여는 기능입니다. PDF 특정 페이지, Excel 특정 셀, PPT 특정 슬라이드로 자동 이동하지 않습니다.
- 검색 단위 안의 공백·탭·줄바꿈은 단일 공백으로 정리됩니다. 일반 파일의 서로 다른 줄, Excel의 서로 다른 셀, Word의 서로 다른 문단을 가로지르는 검색은 지원하지 않습니다. 정규식도 이 정리된 텍스트에 적용됩니다.
- 파일당 기본 50 MB (설정으로 최대 500 MB), 처리 30초, 추출 텍스트 1,600만 자, 최대 일치 200개입니다. 전체 결과 파일은 10,000개까지 표시합니다. 한도 도달은 UI에 표시하며 위치별 미리보기는 최대 6개 문맥, 문맥당 최대 1,200자입니다.
- Office ZIP은 압축 해제 총 180 MB, 개별 항목 32 MB, 15,000항목까지 처리합니다. 이미지가 많은 정상 문서도 한도를 넘으면 건너뛸 수 있습니다.
- 검색 정확도 검증에 집중한 직접 검색 버전입니다. SQLite FTS 색인, 변경 감시, OCR, Office 자동화는 이후 추가할 수 있도록 분리했습니다.

## 검증과 배포

```powershell
npm test                # 파일별 추출, 인코딩, 필터, 정규식, 취소, 시간·ZIP 한도
npm run test:ui         # 실제 Electron을 열어 검색·IPC·미리보기·CSV·취소 검증
npm run dist            # Windows portable EXE
npm run pack            # 압축 해제된 앱 폴더
```

`npm run test:ui`는 테스트용으로 실행한 앱 안에서 열기/탐색기/저장 대화상자를 대체하므로 Office나 탐색기를 실제로 열지 않습니다. UI 스크린샷과 CSV는 `test-results`에 저장합니다. 패키지 검증은 `node scripts/smoke-ui.js "release/win-unpacked/Docs Finder.exe"`입니다.

의존성 버전과 lockfile을 고정했습니다. ExcelJS의 UUID와 샘플 생성 도구의 image-size는 취약점이 수정된 버전으로 override하고 실제 추출·생성 테스트로 호환성을 확인합니다. 공식 API 참고: [Electron 격리 및 IPC](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [PDF.js Node 예제](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs), [ExcelJS](https://github.com/exceljs/exceljs).
