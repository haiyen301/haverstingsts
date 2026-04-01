# FSD — Mục lục

Tài liệu chuẩn hoá **Feature-Sliced Design** (phiên bản thích ứng) cho Next.js App Router trong repo **stsrenew**.

## Đọc theo thứ tự gợi ý

1. **[overview.md](./overview.md)** — Tầng, hướng phụ thuộc, thuật ngữ.
2. **[folder-structure.md](./folder-structure.md)** — Cấu trúc thư mục đang dùng + ví dụ `entities/projects`, `features/project`.
3. **[workflow.md](./workflow.md)** — Quy trình khi thêm tính năng mới (từng bước, đường dẫn).
4. **[api-helper.md](./api-helper.md)** — `shared/api`, proxy, STS.
5. **[auth-session.md](./auth-session.md)** — Auth, token, `stsProxyClient`.
6. **[migration-guide.md](./migration-guide.md)** — Migrate dần từ code cũ.
7. **[gaps-and-roadmap.md](./gaps-and-roadmap.md)** — Nợ kỹ thuật và đề xuất bổ sung.

## Một dòng mỗi file

| File | Mục đích |
|------|----------|
| `overview.md` | Lý thuyết tầng + mapping App Router |
| `folder-structure.md` | Cây `src/` + **vai trò từng thư mục** + bảng “đặt file ở đâu” + entity `model` vs feature `model` |
| `workflow.md` | Checklist thêm entity / feature / page |
| `api-helper.md` | URL, fetch, proxy |
| `auth-session.md` | Session, guard, redirect 401 |
| `migration-guide.md` | Bước migrate từng pha |
| `gaps-and-roadmap.md` | Trạng thái vs FSD lý tưởng |
