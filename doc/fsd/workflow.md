# Quy trình xử lý — thêm code theo FSD

Tài liệu này mô tả **thứ tự làm việc** và **nơi tạo thư mục/file** khi mở rộng ứng dụng.

---

## 1. Thêm API / type cho một **resource** (entity)

**Khi nào:** Có model mới (hoặc bộ field mới) từ STSPortal, cần type + hàm gọi API dùng lại nhiều nơi.

**Bước:**

1. Tạo (hoặc mở) `src/entities/<resource>/`
2. **`model/types.ts`** — interface/type domain, response API.
3. **`api/<resource>Api.ts`** — hàm dùng `stsProxyGet` / `stsProxyPostJson` / … và `STS_API_PATHS` từ `shared`.
4. **`index.ts`** — `export *` từ `model` và `api`.

**Import:** `import { … } from "@/entities/<resource>"`.

**Ví dụ đã có:** `entities/projects/` (Monday dynamic table, `react_update_parent_item`, upload ảnh).

---

## 2. Thêm một **tính năng** (feature slice)

**Khi nào:** Một luồng user cụ thể (màn form, wizard, card phức tạp) với logic không chỉ là “gọi API một phát”.

**Bước:**

1. Tạo `src/features/<feature-name>/`
2. Cấu trúc gợi ý:
   - **`lib/`** — pure functions, map dữ liệu, validate (không JSX).
   - **`model/`** — props của component feature, types chỉ dùng trong feature.
   - **`ui/`** — component React (`"use client"` nếu cần).
   - **`api/`** — (tuỳ chọn) nếu API chỉ dùng trong feature và không muốn đưa lên entity; *ưu tiên entity nếu cùng resource.*
   - **`index.ts`** — export public của feature.

**Import:** `import { … } from "@/features/<feature-name>"`.

**Ví dụ đã có:** `features/project/` — merge/sort Monday rows, `buildProjectDataFromServerRow`, `ProjectListItem` UI.

---

## 3. Thêm **route** (trang Next.js)

**Bước:**

1. Tạo `src/app/<đường-dẫn-url>/page.tsx` (và `layout.tsx` nếu cần).
2. Trong `page.tsx`:
   - Import layout từ `widgets/` nếu là trang trong app đã login.
   - Import feature UI hoặc compose entity API + state (`shared/store`).
3. Giữ `page.tsx` **mỏng**: điều hướng, `useEffect` fetch top-level, render — logic nặng đưa xuống `features/` hoặc `entities/`.

---

## 4. State toàn cục (Zustand, v.v.)

- **`shared/store/`** — store dùng nhiều route (auth, harvesting reference data).
- Tránh đặt store trong `entities/` trừ khi team thống nhất; hiện repo đặt store ở `shared/store`.

---

## 5. Proxy / gọi STS từ browser

1. Đường dẫn upstream: `shared/api/stsApiPaths.ts`.
2. Client: `shared/api/stsProxyClient.ts` (Bearer từ `localStorage`).
3. Route handler catch-all: `app/api/[...path]/route.ts` (hoặc tương đương).

Chi tiết: [api-helper.md](./api-helper.md).

---

## Checklist nhanh

| Việc | Thư mục |
|------|---------|
| Type dùng chung cho “Project” | `entities/projects/model/` |
| POST/GET STS cho project rows | `entities/projects/api/` |
| Card Monday + merge row | `features/project/lib/` + `ui/` |
| Layout dashboard | `widgets/layout/` |
| Trang `/projects` | `app/projects/page.tsx` |
| Sửa URL API STS | `shared/api/stsApiPaths.ts` |

---

## Liên kết

- [folder-structure.md](./folder-structure.md) — cây thư mục chi tiết.
- [overview.md](./overview.md) — tầng và hướng phụ thuộc.
- [gaps-and-roadmap.md](./gaps-and-roadmap.md) — phần chưa chuẩn hoá.
