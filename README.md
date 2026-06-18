# 도서 구매비 지원 프로그램

팀 이메일로 본인 신청만 확인하는 도서 구매 신청 페이지입니다.

## 핵심 흐름

- 팀 이메일 저장
- 참고 링크 입력
- 도서 정보 자동 추출
- 확인 후 신청
- 내 신청만 조회
- CSV 다운로드

## 화면 구성

- 운영 안내 대시보드 제거
- 불필요한 비밀번호 입력 제거
- 신청 폼 최소화
- 자동 추출 결과는 수정 가능

## 참고

- 현재 페이지는 정적 HTML 기반입니다.
- 기록은 브라우저 저장소에 보관되며, Vercel API가 연결되면 Google Sheets에도 동시에 기록됩니다.
- Vercel 환경 변수: `GOOGLE_SHEET_URL` 또는 `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
