# AI Canvas Tauri

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어**

<p align="center">
  <img src="public/icons.svg" alt="AI Canvas Tauri Icon" width="140" height="140" />
</p>

> **Tauri 2 + React 19 + React Flow 12** 기반의 로컬 우선 AI 멀티모달 캔버스 및 대화형 에이전트 데스크톱 애플리케이션.

AI Canvas Tauri는 텍스트, 이미지, 비디오, 오디오, 프레임 단위 애니메이션, Markdown, 샷 리스트, 360° 파노라마, 손글씨 노트를 연결 가능한 캔버스 노드로 구성합니다. 하나의 프로젝트 안에서 생성 파이프라인을 구성하고, 캐릭터 라이브러리와 로컬 에셋을 관리하고, ComfyUI 워크플로를 실행하고, 대화형 어시스턴트로 캔버스를 조회·수정하고, 미디어를 생성하고, 읽기 전용 하위 에이전트를 파견하고, 허가된 파일을 읽고, 프로젝트 메모리를 축적할 수 있습니다. 프로젝트는 시리즈와 에피소드로 나눌 수 있으며, 숏폼 드라마의 각 회차는 하나의 캔버스를 갖고 캐릭터 라이브러리와 에셋은 시리즈 전체에서 공유합니다.

![Version](https://img.shields.io/badge/version-0.8.9-6366f1)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![React](https://img.shields.io/badge/React-19-61dafb)
![React Flow](https://img.shields.io/badge/React_Flow-12-ff0072)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![License](https://img.shields.io/badge/license-source--available-f59e0b)

**온라인 체험:** <https://tenney95.github.io/AI-Canvas-tauri/> (첫 화면에서 바로 사용 가능, 데모 캔버스 내장)

**다운로드:** <https://github.com/tenney95/AI-Canvas-tauri/releases> (데스크톱 설치 패키지)

[온라인 체험](https://tenney95.github.io/AI-Canvas-tauri/) · [다운로드](https://github.com/tenney95/AI-Canvas-tauri/releases) · [주요 기능](#주요-기능) · [빠른 시작](#빠른-시작) · [문서](#문서) · [라이선스](#라이선스)

> 웹 버전은 캔버스와 인터페이스 체험에 적합합니다. 파일 시스템, 자격 증명 저장소, 독립 창, 3D 디렉터 데스크, 로컬 모델 등은 Tauri 데스크톱 환경에 의존합니다. 완전한 체험을 원하시면 아래 단계에 따라 데스크톱 앱을 실행하세요.

## 화면 미리보기

![AI Canvas Tauri Screenshot](public/screenshot.png)

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 멀티모달 노드 캔버스 | 텍스트, 이미지, 비디오, 오디오, 프레임 단위 애니메이션, Markdown, 샷 리스트, 파노라마, 3D 디렉터 데스크, 소스 파일, 캔버스 노트 노드를 통합 연결·구성. |
| AI 및 워크플로 | 클라우드 모델, 사용자 지정 모델 실행 프로토콜, ComfyUI 워크플로, Dreamina 로그인 연동 호출, 로컬 ONNX 추론 지원. |
| 내장 비디오 편집 | 비디오 노드를 독립 편집기에서 열어 멀티 트랙 편집, 잘라내기·분할, 변형, 전환, 텍스트·스티커, 볼륨 조정, 무손실 패스스루 또는 합성 내보내기 지원. |
| 대화형 에이전트 | 다중 세션, 스트리밍 응답, Plan/B/C 실행 모드, 도구 호출, 승인 카드, 작업 타임라인, 컨텍스트 압축, 프로젝트 메모리. |
| 읽기 전용 하위 에이전트 | 사용자가 어시스턴트 안에서 도메인 역할을 정의하고, 메인 작업이 필요에 따라 병렬 읽기 전용 하위 에이전트를 파견하며, 산출물은 샌타이즈 후 반환. |
| 캐릭터 라이브러리 및 숏폼 드라마 에셋 | 글로벌/프로젝트 레벨 캐릭터 카드, 다중 참조 이미지, 음성 바인딩 및 더빙 내보내기, 숏폼 드라마 인물·장면·소품 에셋. |
| 로컬 MCP 컨트롤 브리지 | 수동으로 활성화하는 세션 단위 stdio MCP 어댑터로, 외부 클라이언트가 동일한 도구·Policy·승인·작업 타임라인을 재사용. |
| 로컬 우선 및 보안 | 미디어는 프로젝트 데이터 디렉터리에 저장되고, 구조화 데이터는 IndexedDB로 영속화되며, API 키는 Rust 자격 증명 저장소에 격리 보관. |
| 시리즈 및 에피소드 | 프로젝트를 시리즈와 에피소드로 나누고, 각 회차가 캔버스를 차지하며 캐릭터 라이브러리·프로젝트 메모리·에셋 디렉터리를 공유. 어시스턴트가 대본을 읽은 뒤 일괄로 회차를 생성 가능. |
| 프로젝트 및 에셋 | 다중 프로젝트, 에셋 라이브러리, 복구 가능한 삭제, `.aicanvas` 프로젝트 전체 가져오기/내보내기. |
| 온보딩 및 도움말 센터 | 최초 실행 시 가이드를 표시하고, 호버 힌트와 스페이스로 대화상자 열기, 길게 눌러 일괄 생성 등 숨겨진 조작을 집중 안내. 도움말 센터는 시나리오별로 분류되며 실제 @ 칩으로 ComfyUI 입력 노드 쓰기 과정을 시연. |
| 주문형 3D 디렉터 데스크 | 디렉터 데스크 노드를 처음 생성할 때 고정·검증된 실행 리소스를 다운로드하고, Tauri 독립 창에서 장면 배치, 카메라 프리비즈, 스크린샷 반환을 수행. |

자세한 기능 설명과 단계별 진행 상황은 [기능 방안](doc/对话式画布助手-功能方案.md) 및 [에이전트 역량 구현 방안](doc/对话助手-Agent能力实施方案.md) (중국어)을 참고하세요.

## 기술 스택

| 기술 | 용도 |
| --- | --- |
| [Tauri 2](https://tauri.app/) + Rust | 데스크톱 셸, 창, 파일, 업데이트, 로컬 모델 및 시스템 기능 |
| [React 19](https://react.dev/) + TypeScript 6 | UI, 도메인 타입 및 엄격한 타입 검사 |
| [React Flow 12](https://reactflow.dev/) | 노드 캔버스, 연결 및 뷰 제어 |
| [Zustand 5](https://zustand.docs.pmnd.rs/) | 슬라이스 기반 전역 상태 관리 |
| [Tailwind CSS 3](https://tailwindcss.com/) | 컴포넌트 스타일 및 `canvas-*` 디자인 토큰 |
| [Vitest](https://vitest.dev/) | 자동화 테스트 |
| IndexedDB | 로컬 구조화 데이터 영속화 |

## 빠른 시작

### 환경 요구사항

- Node.js: Vite 8 실행 요건 충족, 현재 LTS 권장
- npm
- Rust stable 툴체인
- 플랫폼별 [Tauri 시스템 종속성](https://v2.tauri.app/start/prerequisites/)

Windows 빌드에는 Visual Studio Build Tools 2022와 "C++를 사용한 데스크톱 개발" 워크로드가 추가로 필요합니다.

### 의존성 설치

```bash
npm install
```

### 개발 환경 실행

```bash
# 웹 프론트엔드만 실행, 기본적으로 http://localhost:1420 접속
npm run dev

# 전체 Tauri 데스크톱 앱 실행
npm run tauri dev
```

웹 모드는 UI 개발에 적합합니다. 네이티브 대화상자, 로컬 파일 도구, 독립 창, 로컬 모델, 3D 디렉터 데스크 등은 Tauri 데스크톱 환경이 필요합니다.

### 검사 및 빌드

```bash
# TypeScript 타입 검사
npm run typecheck

# ESLint 검사
npm run lint

# 단위 테스트 (Vitest)
npm run test

# lint + 타입 검사 + 테스트
npm run check

# 프론트엔드 프로덕션 빌드
npm run build

# 데스크톱 앱 빌드
npm run tauri build
```

릴리스 시 `package.json`을 버전 원본으로 사용하며, `npm run sync-version`으로 Rust 설정과 README 버전 배지를 동기화할 수 있습니다.

## 문서

- [개발 가이드](doc/开发指南.md): 환경, 명령어, 디렉터리, 개발 규약, 디버깅, FAQ (중국어)
- [아키텍처 설명](doc/架构说明.md): 핵심 모듈, 데이터 흐름, 보안 경계, 성능 설계 (중국어)
- [ComfyUI 워크플로 통합 설명](doc/ComfyUI工作流集成说明.md): 가져오기, IO 노드 감지, 콘텐츠·파라미터 주입, 결과 회수 (중국어)
- [대화형 캔버스 어시스턴트 기능 방안](doc/对话式画布助手-功能方案.md)
- [대화형 어시스턴트 에이전트 역량 구현 방안](doc/对话助手-Agent能力实施方案.md)
- [패키징 및 릴리스 절차](doc/打包与发版流程.md)

장기적인 엔지니어링 경계는 저장소의 [AGENTS.md](AGENTS.md)를 따르며, 아키텍처 결정 기록은 [`doc/adr/`](doc/adr/)에 있습니다.

## 라이선스

본 프로젝트는 **AI Canvas Tauri Source-Available License**에 따라 제공됩니다. 전체 조항은 [LICENSE](LICENSE)를 참고하세요.

학습, 연구, 내부 사용, 수정 및 통합 사용이 허용됩니다. 무단 스킨 판매, 화이트라벨 배포, 소스 코드 재판매, 상업적 재배포 및 본 프로젝트를 동종 제품으로 상업화하는 것은 금지됩니다.

본 프로젝트는 OSI 정의상 오픈소스가 아닙니다. 상업용 라이선스가 필요하시면 저작권자에게 문의하세요.

### 타사 소재

캔버스 노트의 툴바 및 속성 패널 시각 디자인은 [Excalidraw](https://github.com/excalidraw/excalidraw)를 참고했습니다. 라이선스는 [doc/licenses/excalidraw-MIT.txt](doc/licenses/excalidraw-MIT.txt)를 참고하세요.

## 연락처

개발 소통 QQ 그룹: 873354155

## 공동 개발자

<p>
  <a href="https://github.com/zhurui0523" title="zhurui0523"><img src="https://images.weserv.nl/?url=github.com/zhurui0523.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="zhurui0523" /></a>
  <a href="https://github.com/stars-one" title="stars-one"><img src="https://images.weserv.nl/?url=github.com/stars-one.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="stars-one" /></a>
  <a href="https://github.com/luckcatlin2000" title="luckcatlin2000"><img src="https://images.weserv.nl/?url=github.com/luckcatlin2000.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="luckcatlin2000" /></a>
  <a href="https://github.com/xiaozangao" title="xiaozangao"><img src="https://images.weserv.nl/?url=github.com/xiaozangao.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="xiaozangao" /></a>
  <a href="https://github.com/orlova851986-debug" title="orlova851986-debug"><img src="https://images.weserv.nl/?url=github.com/orlova851986-debug.png&amp;w=128&amp;h=128&amp;fit=cover&amp;mask=circle" width="64" height="64" alt="orlova851986-debug" /></a>
</p>
