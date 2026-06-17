# 도서 구매비 지원 프로그램

12명 팀원이 함께 쓰는 도서 구매 신청/상태 관리 웹사이트입니다.

## 포함 기능

- 프로그램 시작 월 안내
- 매월 구매 마감일 안내
- 신청 등록
- 구매 상태 관리
- 공유 가능 여부 관리
- 개인 배송지 비밀번호 보호
- Google Sheets 동기화
- CSV 다운로드
- 관리자 상태 수정

## 실행

이 앱은 외부 패키지 없이 동작하도록 만들어졌습니다.

```bash
/Users/han/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 app.py
```

그다음 브라우저에서 `http://127.0.0.1:8000`을 엽니다.

## Google Sheets 연동

구글 시트에 연결하려면 서비스 계정이 필요합니다.

1. Google Cloud에서 서비스 계정을 만들고 키를 발급합니다.
2. 아래 시트를 서비스 계정 이메일에 공유합니다.
   - 실제 운영 시 본인 시트 링크를 넣으세요.
3. 환경 변수를 설정합니다.

### 필요한 환경 변수

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=YOUR_SHEET_ID
GOOGLE_SHEET_URL=YOUR_SHEET_URL
GOOGLE_SHEET_TAB=Sheet1
MANAGER_PASSWORD=your-manager-password
APP_SECRET=change-me-in-production
DEFAULT_PURCHASER=Kristy
```

## 개인정보 보호 방식

- 배송지는 암호화해서 저장합니다.
- 목록 화면에는 마스킹된 주소만 보입니다.
- 신청할 때 넣은 비밀번호를 입력해야 원문 주소를 확인할 수 있습니다.

## CSV 다운로드

- 기본 다운로드는 마스킹된 공개 정보만 포함합니다.
- 관리자 비밀번호가 있으면 전체 내역으로 내려받을 수 있습니다.

## 시트 컬럼

앱은 신청 ID, 신청자, 도서명, 금액, 상태, 담당자, 공유 상태, 암호화된 배송지 등을 시트에 동기화합니다.
