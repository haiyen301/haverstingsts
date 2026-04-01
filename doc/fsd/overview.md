# Feature-Sliced Design (FSD) — Tổng quan (Next.js App Router)

## Mục tiêu

1. **Tách lớp routing** (`src/app`) khỏi **domain**, **tính năng** và **UI tái sử dụng**.
2. **Giảm coupling**: thêm màn hình / API mới ít phải sửa file “trung tâm” không liên quan.
3. **Định hướng import** rõ ràng: tầng dưới không import tầng trên (xem mục Phụ thuộc).

Đây là **FSD thích ứng**: không bắt buộc mọi rule của [FSD gốc](https://feature-sliced.design/) (ví dụ public API `@x`); ưu tiên **thực tế triển khai** với STSPortal + proxy Next.

---

## Các tầng (layers) và vai trò

| Tầng | Thư mục | Vai trò |
|------|---------|---------|
| **App** | `src/app/` | **Routing**: `page.tsx`, `layout.tsx`, Route Handlers (`api/.../route.ts`). Chỉ nên **ghép** widget/feature, wiring route, ít logic nghiệp vụ. |
| **Widgets** | `src/widgets/` | Khối UI lớn, nhiều feature (ví dụ layout dashboard + sidebar). |
| **Features** | `src/features/<name>/` | **Một luồng nghiệp vụ**: form login, submit harvest, **project Monday card** (UI + lib xử lý slice đó). |
| **Entities** | `src/entities/<name>/` | **Đối tượng domain** tái dùng: type, mapper nhẹ, **API gọi server cho resource đó** (ví dụ `entities/projects/api`). |
| **Shared** | `src/shared/` | Dùng chung toàn app: `api/` (proxy client), `ui/`, `lib/`, `store/`, `config/`. |
| **Lib gốc** | `src/lib/`, `src/components/` | Legacy / shadcn-style; ưu tiên dần gom vào `shared` hoặc `features`. |

### Hướng phụ thuộc (đề xuất)

```
app  →  widgets  →  features  →  entities  →  shared
```

- **`app`** có thể import `widgets`, `features`, `entities`, `shared`.
- **`features`** import `entities`, `shared`; **không** import `app`.
- **`entities`** import `shared`; **không** import `features` / `app`.
- **`shared`** **không** import `entities` / `features` / `app` (tránh vòng).

*(Ngoại lệ thực tế: một số `page.tsx` vẫn chứa logic dài — nên thu gọn dần theo [workflow](./workflow.md).)*

---

## Ánh xạ sang Next.js App Router

| FSD | Next.js |
|-----|---------|
| “Trang” | `src/app/<segment>/page.tsx` |
| Layout | `src/app/.../layout.tsx` |
| API browser → STS | `src/app/api/[...path]/route.ts` (proxy) + client gọi qua `shared/api/stsProxyClient.ts` |
| Không dùng `src/pages` của Pages Router | Có thể có lớp `src/pages/...` **chỉ là composition UI** (tùy chọn); hiện repo thường compose trực tiếp trong `app/.../page.tsx`. |

---

## Thuật ngữ ngắn

- **Entity**: “Thứ” trong nghiệp vụ (project, user, harvest row) — **model + API** theo resource.
- **Feature**: “Việc user làm” (đăng nhập, tạo project Monday, nộp harvest) — thường có **`ui/`** + **`lib/`** + đôi khi **`api/`**.
- **Widget**: Khối UI không thuộc một feature hẹp (layout shell).

---

## Quy ước đặt tên slice

- Thư mục slice: **`kebab-case`** hoặc **`camelCase`** thống nhất; repo đang dùng tên ngắn: `features/project`, `entities/projects`.
- File: theo convention TypeScript/React hiện có (`PascalCase` cho component).

---

## Liên quan

- Cấu trúc thư mục thực tế: [folder-structure.md](./folder-structure.md)
- Quy trình thêm code mới: [workflow.md](./workflow.md)
- Khoảng cách so với FSD lý tưởng: [gaps-and-roadmap.md](./gaps-and-roadmap.md)
