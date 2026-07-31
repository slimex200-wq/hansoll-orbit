HANSOLL ORBIT - IT 검토용 빌드

1. HANSOLL-ORBIT-IT-Review 실행파일을 실행합니다.
2. 이 빌드에는 실제 직원, 고객, 메일, OneDrive 자료가 포함되어 있지 않습니다.
3. 기본 화면은 합성 샘플 데이터로 동작합니다.
4. Outlook 연결을 시험하려면 desktop-config.example.json을 복사하여
   desktop-config.json으로 이름을 바꾸고 tenantId/clientId를 입력합니다.
5. desktop-config.json은 실행파일과 같은 폴더에 둡니다.
6. 앱을 다시 실행하면 Windows의 현재 회사 계정을 자동으로 확인합니다.
7. 추가 승인이 필요한 경우에만 관리 > 앱 연결에서 Windows 계정 연결을 선택합니다.

주의
- 현재 실행파일은 내부 검토용 미서명 빌드입니다.
- 실제 배포 전에 회사 코드 서명, Entra 승인, 배포 정책 검토가 필요합니다.
- Microsoft 계정 연결 후에는 Graph에서 내려받은 메일 사본이 Windows 사용자별
  앱 데이터 폴더에 저장될 수 있습니다.
- 이 빌드에는 메일 발송, 삭제, 수정 권한이 없습니다.

상세 내용은 IT_REVIEW_GUIDE_KO.md와 SECURITY_AND_DATA_FLOW_KO.md를 확인하십시오.
