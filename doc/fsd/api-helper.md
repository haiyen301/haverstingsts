# API/URL Helper theo FSD

## Lý do

Trong dự án lớn, endpoint/URL thường nằm rải rác nhiều chỗ -> khó đổi base URL, khó kiểm soát convention body/headers.

## Đề xuất

- `src/shared/api/`:
  - Là nơi gom:
    - URL builder (baseUrl + path)
    - fetch wrapper (common headers, error handling)
    - typed client theo từng resource

### Ví dụ mapping với code hiện tại

Bạn đang có (gom một chỗ):
- `src/shared/api/stsLogin.ts`: `INTERNAL_API` (route Next cho browser), `STS_LOGIN_PATHS` (upstream STSPortal), `getStsApiUrl` / `getStsLoginUrl`
- `src/app/helper/stsLogin.ts` / `internalApi.ts`: re-export tiện import cũ

## Quy tắc gọi API

- Client (browser) chỉ gọi:
  - `INTERNAL_API.*` (route trong Next) hoặc `fetch` typed từ `shared/api`
- Server (route handler trong `src/app/api`) mới được đọc `process.env.NEXT_PUBLIC_STS_API_BASE_URL`
  - (dù biến `NEXT_PUBLIC` có thể đọc ở client, nhưng proxy route handler giúp bạn giảm expose và dễ đổi logic)

