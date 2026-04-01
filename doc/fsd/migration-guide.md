# Migrate dần sang FSD (gợi ý)

Tài liệu này bổ sung cho [workflow.md](./workflow.md) (quy trình **file mới**) — tập trung vào **code cũ**.

## Bước 1: Tách routing khỏi logic nghiệp vụ

- Giữ `src/app/**/page.tsx` gọn: compose widget/feature, gọi hook/store, ít xử lý dài.
- Logic map dữ liệu / gọi API theo resource → `entities/<name>/`.
- Logic theo luồng user → `features/<name>/`.

## Bước 2: Layout & shell

- Layout dashboard: một nguồn duy nhất — ưu tiên `src/widgets/layout/DashboardLayout.tsx`.
- Tránh duplicate `DashboardLayout` / `RequireAuth` dưới `app/components/` (xem [gaps-and-roadmap.md](./gaps-and-roadmap.md)).

## Bước 3: Auth

- Form login / register: `src/features/auth/ui/`.
- Guard: `src/features/auth/RequireAuth.tsx` (hoặc tương đương).

## Bước 4: API & proxy

- Path upstream: `src/shared/api/stsApiPaths.ts`.
- Client browser: `src/shared/api/stsProxyClient.ts`.
- Chi tiết: [api-helper.md](./api-helper.md).

## Bước 5: Mock / dev data

- Mock theo feature: `src/features/<name>/lib/mock.ts` hoặc `model/mock.ts` (tuỳ team).

## Tiêu chí “đủ tốt”

- Không nhét logic nặng vào `page.tsx` mà không có kế hoạch tách.
- Mỗi resource quan trọng có **entity** (types + API) khi API được dùng lại.
- Tính năng phức tạp có **feature** slice rõ (`lib` / `ui`).

## Đọc thêm

- Cấu trúc thư mục hiện tại: [folder-structure.md](./folder-structure.md)
- Quy trình thêm mới: [workflow.md](./workflow.md)
