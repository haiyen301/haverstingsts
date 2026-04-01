# Khoảng cách so với FSD & đề xuất

Repo đang **áp dụng có chọn lọc** FSD. Dưới đây là điểm lệch thực tế và cách hoàn thiện dần (không bắt buộc một lần).

## Đã bám sát

- **`entities/projects`**: model + API STS cho project / Monday dynamic table.
- **`features/project`**: logic merge/sort/build card + UI `ProjectListItem` tách khỏi entity.
- **`shared/api`**: proxy client, paths.
- **`widgets/layout`**: `DashboardLayout`.

## Chưa đồng nhất / nợ kỹ thuật

| Vấn đề | Gợi ý |
|--------|--------|
| `src/app/components/` (RequireAuth, DashboardLayout) trùng vai trò với `features/` / `widgets/` | Dần xoá hoặc re-export một nguồn; route chỉ import từ `features/auth` hoặc `widgets/layout`. |
| Lớp **`src/pages/`** (screen) chưa dùng | Có thể thêm `pages/projects/ui/ProjectsScreen.tsx` và để `app/projects/page.tsx` chỉ `return <ProjectsScreen />` nếu muốn page cực mỏng. |
| `lib/` + `components/ui/` ngoài `shared/` | Dần gom `cn`, UI dùng chung vào `shared/lib`, `shared/ui`. |
| Public API chính thức theo FSD gốc (`@x`) | Chưa áp dụng; dùng alias `@/entities/...`, `@/features/...` đủ thực tế. |

## Roadmap ngắn (ưu tiên)

1. Thống nhất **một** nơi export `RequireAuth`, `DashboardLayout` (xóa duplicate dưới `app/components`).
2. Mỗi route lớn: rút logic khỏi `page.tsx` → feature `lib` hoặc `ui`.
3. Tài liệu này + [workflow.md](./workflow.md) làm checklist PR.
