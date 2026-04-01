# Tài liệu STS Renew (Next.js)

## Feature-Sliced Design (FSD)

Toàn bộ hướng dẫn tổ chức code, quy trình tạo thư mục và nơi đặt từng loại file nằm trong:

| Tài liệu | Nội dung |
|----------|----------|
| [fsd/README.md](./fsd/README.md) | Mục lục và điểm vào nhanh |
| [fsd/overview.md](./fsd/overview.md) | Tầng FSD, quy tắc phụ thuộc, ánh xạ Next.js App Router |
| [fsd/folder-structure.md](./fsd/folder-structure.md) | Cây thư mục **thực tế** trong repo + mẫu chỗ đặt file |
| [fsd/workflow.md](./fsd/workflow.md) | **Quy trình xử lý**: thêm entity, feature, route, API |
| [fsd/migration-guide.md](./fsd/migration-guide.md) | Gợi ý migrate dần từ code cũ |
| [fsd/api-helper.md](./fsd/api-helper.md) | Quy ước proxy / `shared/api` |
| [fsd/auth-session.md](./fsd/auth-session.md) | Phiên đăng nhập, `RequireAuth`, 401 |
| [fsd/gaps-and-roadmap.md](./fsd/gaps-and-roadmap.md) | Điểm chưa khớp FSD + hướng hoàn thiện |

Không phải “FSD thuần” theo tài liệu gốc (segment names, public API) — repo này **thích ứng** với Next.js App Router và STSPortal; nguyên tắc **tách routing / domain / tính năng / shared** vẫn giữ.
