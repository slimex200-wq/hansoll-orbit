# HANSOLL ORBIT IT 검토 안내

## 검토 목적

HANSOLL ORBIT은 Outlook 메일, 업무 파일, WIP와 사용자가 등록한 업무 상태를 한 화면에서
검색하고 정리하는 Windows 데스크톱 업무 도구입니다. 이 패키지는 Microsoft 365 연결 및
사내 배포 가능성을 검토하기 위한 파일이며 운영 배포본이 아닙니다.

## 검토 빌드 범위

- 실제 직원, 고객, 업체, 스타일, 메일 및 OneDrive 파일을 포함하지 않습니다.
- 기본 대시보드, 검색 및 Work Agent는 합성 샘플 데이터로 동작합니다.
- 외부 메일 발송, 메일 삭제 및 메일 수정 기능은 포함하지 않습니다.
- Microsoft 설정이 없으면 회사 계정 연결을 시도하지 않습니다.
- Microsoft 설정을 입력하면 Windows 회사 계정 자동 연결과 Microsoft Graph 연결을 시험할 수 있습니다.

## 빠른 실행

1. 실행파일과 이 문서가 같은 폴더에 있는지 확인합니다.
2. `HANSOLL-ORBIT-IT-Review-0.1.0-x64.exe`를 실행합니다.
3. 상단의 `IT 검토용` 표시와 합성 업무 건을 확인합니다.
4. 관리 화면에서 Outlook 연결 상태와 저장 정책을 확인합니다.

미서명 내부 검토본이므로 Windows SmartScreen 또는 회사 보안 도구가 실행을 차단할 수
있습니다. 우회 배포보다 파일 해시를 확인하고 회사의 승인된 테스트 절차를 적용하십시오.

## Outlook 연결 시험

현재 구현은 Windows Web Account Manager(WAM)와 Microsoft Graph 사용자 위임 권한을
사용합니다. Outlook 로컬 파일이나 비밀번호를 직접 읽지 않습니다.

1. Microsoft Entra에서 사내 단일 테넌트 Public Client 앱을 등록합니다.
2. Mobile and desktop applications 플랫폼에 `http://localhost`와
   `ms-appx-web://Microsoft.AAD.BrokerPlugin/<CLIENT_ID>` redirect URI를 등록합니다.
3. Microsoft Graph delegated `Mail.Read`를 등록합니다.
4. 공유 메일함 검토가 승인된 경우에만 `Mail.Read.Shared`를 추가합니다.
5. `desktop-config.example.json`을 `desktop-config.json`으로 복사합니다.
6. 실제 `tenantId`와 `clientId`를 입력하고 실행파일과 같은 폴더에 둡니다.
7. 앱을 다시 실행합니다. IT가 권한을 사전 승인한 경우 Windows의 현재 회사 계정으로
   자동 연결되고 메일 동기화가 시작됩니다.
8. 동의 또는 재인증이 필요한 경우에만 관리 > 앱 연결에서 `Windows 계정 연결`을 한 번
   실행합니다.

Client secret은 사용하거나 배포하지 않습니다. 회사의 사용자 동의 정책이 `Mail.Read`를
차단하면 Entra 관리자의 사전 승인이 필요합니다. `browserFallback`은 WAM을 사용할 수 없는
테스트 장비에서만 기존 브라우저 로그인을 허용하는 배포 옵션입니다.

## IT 확인 항목

- 사용자 메일함이 Exchange Online, 온프레미스 Exchange 또는 하이브리드 중 어디에 있는지
- Entra Public Client 앱 등록 및 사용자 위임 권한 승인 절차
- Conditional Access, Intune, Defender, 프록시 및 방화벽 정책
- 사내 코드 서명 인증서와 Windows 앱 배포 방식
- 직원별 로컬 캐시 보존 기간과 삭제 정책
- 공유 메일함 사용 여부 및 승인 범위
- 운영 배포 전 보안 점검과 로그 수집 기준

## 운영 전 필요한 작업

- 회사 코드 서명 적용
- 운영용 Entra 앱 ID 확정
- 설치형 패키지 또는 Intune/MSIX 배포 방식 확정
- 실제 업무 데이터 경로와 권한 정책 확정
- 메일 캐시 보존·초기화·퇴사자 장비 처리 정책 확정
- 자동 업데이트와 장애 로그 전달 절차 확정
