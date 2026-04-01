import { redirect } from "next/navigation";

/** Đăng nhập nằm tại `/`; giữ route cũ để bookmark không gãy. */
export default function LoginPage() {
  redirect("/");
}
