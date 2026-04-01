# Phiên đăng nhập & xử lý Unauthorized (STS Renew)

## Tóm tắt

- **JWT** được lưu ở browser: `localStorage` key `sts_token` (xem `STORAGE_TOKEN_KEY` trong `src/shared/lib/sessionUser.ts`).
- **Bảo vệ route phía client** (`RequireAuth`): chỉ kiểm tra **có token hay không**, **không** xác thực token với server.
- Khi API STSPortal (qua proxy Next) trả `success: false` với nội dung lỗi **Unauthorized** (hoặc HTTP **401**), client cần **xóa phiên** và **chuyển về trang đăng nhập** — logic này nằm tập trung trong `src/shared/api/stsProxyClient.ts`.

## Vì sao có thể thấy dashboard nhưng API báo lỗi token?

| Tình huống | Hành vi |
|------------|---------|
| Không có `sts_token` | `RequireAuth` redirect về `/` (login). |
| Có token nhưng **hết hạn / sai / bị thu hồi** | Guard vẫn cho vào dashboard; request đầu tiên fail → trước đây chỉ hiện lỗi trên trang. |
| Server trả JSON kiểu `{"success":false,"message":"Unauthorized. Token is missing or invalid."}` | Đây là từ chối **phía API** (Bearer không hợp lệ), không nhất thiết là `localStorage` trống. |

## Luồng xử lý trong `stsProxyClient`

Các hàm gọi qua proxy cùng origin (`stsProxyGet`, `stsProxyGetHarvestingIndex`, `stsProxyPostFormData`, `stsProxyPostJson`):

1. Đọc token từ `localStorage`, gửi header `Authorization: Bearer <token>`.
2. Parse JSON; nếu `success !== true` thì gọi `assertStsSuccessOrThrow`.
3. Trong đó, nếu được coi là **Unauthorized** (`isStsUnauthorizedResponse`):
   - HTTP status **401**, hoặc
   - `message` chứa các pattern như `unauthorized`, `token is missing`, `invalid token`, v.v.
4. Gọi **`clearAuthSession()`** (`src/shared/store/authUserStore.ts`): xóa JWT, dữ liệu user legacy, reset store liên quan.
5. **`window.location.assign("/")`** — full navigation về trang login (cùng entry với user đã đăng nhập từ `/`).

Sau bước 5, trình duyệt tải lại app ở `/`; không còn token nên không vào dashboard được cho đến khi đăng nhập lại.

## Dynamic import `authUserStore`

`stsProxyClient` **không** import tĩnh `clearAuthSession` để tránh **vòng phụ thuộc**:

`authUserStore` → `harvestingDataStore` → `stsProxyClient` → (nếu import tĩnh) → `authUserStore`.

Thay vào đó dùng `await import("@/shared/store/authUserStore")` **chỉ khi** cần xử lý Unauthorized.

## Liên quan file

| File | Vai trò |
|------|---------|
| `src/features/auth/RequireAuth.tsx` | Chỉ check token có tồn tại. |
| `src/shared/api/stsProxyClient.ts` | Proxy client + redirect khi Unauthorized. |
| `src/shared/store/authUserStore.ts` | `clearAuthSession`, persist user. |
| `src/app/page.tsx` | Nếu đã có token thì redirect `/dashboard`. |

## Ghi chú cho developer

- Thêm API mới: ưu tiên dùng các helper trong `stsProxyClient` để **tự động** áp dụng cùng quy tắc Unauthorized.
- Nếu gọi `fetch` thủ công tới `/api/...` với Bearer, cần **tự** xử lý `success: false` + Unauthorized hoặc mở rộng helper tập trung để tránh user kẹt trên màn hình protected với token hết hạn.
