# Cấu trúc thư mục (thực tế trong repo)

> Cập nhật theo trạng thái `src/` — dùng làm **nguồn sự thật** khi tạo file mới.

## Cây tổng quan `src/`

```txt
src/
  app/                          # Next.js App Router — routing & API routes
    api/                          # Proxy / route handlers (STS, auth…)
    login/, register/, …          # Mỗi thư mục = URL segment
    dashboard/, harvest/, projects/, planning/, profile/
    layout.tsx, page.tsx
    components/                   # Legacy — ưu tiên dùng widgets/features (xem gaps)
    helper/                       # Re-export / helper gần route (có thể gom vào shared)

  entities/                     # Domain theo resource
    projects/
      model/types.ts            # ProjectData, MondayProjectServerRow, API response types…
      api/projectsApi.ts        # Gọi STS: dynamic table, update parent, upload ảnh…
      index.ts

  features/                     # Tính năng (use-case)
    auth/
      ui/                       # LoginForm, RegisterForm…
      RequireAuth.tsx
    harvesting/
      api/, lib/
    project/                      # Monday project list / card (slice “project” UI)
      lib/                        # merge row, sort, buildProjectData…
      model/projectListProps.ts   # Props của ProjectListItem
      ui/ProjectListItem.tsx
      index.ts

  shared/
    api/                        # stsProxyClient, stsApiPaths, stsLogin
    config/                     # stsUrls
    lib/                        # format/date, parseJsonMaybe, …
    store/                      # zustand (harvestingData, auth…)
    ui/                         # DatePicker, …

  widgets/
    layout/                     # DashboardLayout, SidebarProfile

  lib/                          # utils (vd. cn), assets
  components/ui/                # shadcn-style (Popover…)
```

---

## Vai trò từng thư mục (giải thích ngắn)

### `app/` — Routing & API của Next.js

- **Tính năng:** Định nghĩa **URL** (`page.tsx`), **khung trang** (`layout.tsx`), và **Route Handlers** (API nội bộ).
- **Nên làm:** Ghép layout, gọi feature/entity, state local của trang; giữ **mỏng**, logic nặng đưa xuống `features/` / `entities/`.
- **Phụ:** `app/api/` — proxy tới STSPortal (`[...path]`, `sts/...`), auth (`authentication/login`…); browser không gọi STS trực tiếp mà qua đây + `shared/api`.
- **Legacy trong app:** `app/components/`, `app/helper/` — code cũ / re-export; ưu tiên dần chuyển sang `widgets/`, `features/`, `shared/`.

### `entities/` — Domain theo *resource*

- **Tính năng:** Một **thực thể** nghiệp vụ (vd. `projects`): **kiểu dữ liệu** (`model/`), **hàm gọi API** server cho resource đó (`api/`).
- **Không phải:** Màn hình hay component list/detail — đó thuộc `app/` + `features/`.
- **Ví dụ repo:** `entities/projects` — `ProjectData`, `MondayProjectServerRow`, `fetchMondayProjectRowsFromServer`, cập nhật row Monday…

### `features/` — Luồng nghiệp vụ (use case)

- **Tính năng:** **Một việc user làm** hoặc **một khối UI + logic** gắn chặt với việc đó: form đăng nhập, gửi harvest, card/list project kiểu Monday.
- **Cấu trúc thường gặp:** `ui/` (component), `lib/` (xử lý, merge, sort…), đôi khi `api/` (submit đặc thù), `model/` (props/interface UI).
- **Trong repo:**
  - `auth/` — Login, register, forgot password, `RequireAuth`.
  - `harvesting/` — Parse/gửi dữ liệu harvest (kèm `api/` riêng nếu cần).
  - `project/` — `ProjectListItem`, `buildProjectCardData`, merge/sort row Monday.

### `shared/` — Dùng chung, không thuộc một feature cụ thể

- **`shared/api/`** — Client gọi proxy (`stsProxyClient`), path STS, login session.
- **`shared/config/`** — URL domain STS, path public (ảnh…).
- **`shared/lib/`** — Format số/ngày, parse JSON an toàn, helper harvest không gắn một màn.
- **`shared/store/`** — Zustand (auth user, harvesting cache…).
- **`shared/ui/`** — Component tái dùng “không nghiệp vụ” (date picker, calendar…).

### `widgets/` — Khối UI lớn, nhiều trang

- **Tính năng:** **Shell** bao quanh nhiều route: sidebar, header profile, `DashboardLayout`.
- **Khác `features/`:** Không phải một “tính năng hẹp” mà là **khung** chứa nhiều tính năng.

### `lib/` (gốc `src/lib/`) — Tiện ích tối thiểu / legacy

- **Tính năng:** Ví dụ `cn()` (classnames), assets tĩnh; có thể gom dần vào `shared/lib` nếu muốn thống nhất.

### `components/` (gốc `src/components/`) — UI primitive / shadcn

- **Tính năng:** Component **không nghiệp vụ** (Popover, v.v.) — style hệ thống, dùng lại ở mọi nơi; tách với `features/*/ui`.

---

## Bảng: “File loại X đặt ở đâu?”

| Loại | Nơi đặt | Ví dụ trong repo |
|------|---------|------------------|
| Type/domain của một resource | `entities/<name>/model/` | `entities/projects/model/types.ts` |
| Hàm gọi API server (theo resource) | `entities/<name>/api/` | `entities/projects/api/projectsApi.ts` |
| Barrel export entity | `entities/<name>/index.ts` | `export *` model + api |
| Logic + UI một luồng nghiệp vụ | `features/<name>/` | `features/project/lib`, `ui` |
| Props của component feature | `features/<name>/model/` | `projectListProps.ts` |
| Layout nhiều trang | `widgets/` | `widgets/layout/DashboardLayout.tsx` |
| Fetch proxy, token, path chung | `shared/api/` | `stsProxyClient.ts`, `stsApiPaths.ts` |
| Zustand / state chung | `shared/store/` | `harvestingDataStore.ts` |
| `page.tsx` route | `app/<route>/page.tsx` | `app/projects/page.tsx` |

---

## Entity `model` vs Feature `model` (cùng chữ “project”, không trùng vai trò)

Hai thư mục đều liên quan **project** nhưng **tầng khác nhau** — không gộp thành một:

| Thư mục | Vai trò | Nội dung điển hình |
|---------|---------|-------------------|
| `entities/projects/model/` | **Miền + hợp đồng dữ liệu** của resource `projects` | `ProjectData`, `MondayProjectServerRow`, kiểu API, trạng thái domain… — mô tả *dữ liệu project là gì* (gần backend / parity Flutter). |
| `features/project/model/` | **Hợp đồng UI** của một luồng/feature cụ thể | Ví dụ `projectListProps.ts`: interface **props** của `ProjectListItem` — *component này cần props kiểu gì*, thường **import lại** type từ `@/entities/projects`. |

**Hướng phụ thuộc:** `features/project` → `entities/projects` (feature dùng entity; entity không import feature).

**Khi thêm type mới:**  
- Thuộc **shape dữ liệu / API / domain** chung → `entities/projects/model/`.  
- Chỉ phục vụ **một component hoặc một màn** trong slice `features/project` → `features/project/model/` (hoặc cạnh `ui/` nếu chỉ dùng nội bộ file đó).

---

## Không có (hoặc chưa dùng) trong repo

- **`src/pages/`** (lớp “screen” tách hẳn khỏi `app/`): có thể thêm sau nếu muốn `page.tsx` chỉ 1 dòng `return <XScreen />`.
- **Segment FSD gốc** như `processes/`, `segments/`**: không bắt buộc.
