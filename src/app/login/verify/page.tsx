import Link from "next/link";
import { redirect } from "next/navigation";
import { readPending } from "@/lib/session";
import { sitePath } from "@/lib/site-path";
import { AuthFrame } from "../auth-frame";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // パスワードを通っていない、または 5 分を過ぎた。最初からやり直す
  if (!(await readPending("totp"))) redirect("/login");
  const sp = await searchParams;

  return (
    <AuthFrame title="2段階認証">
      <VerifyForm next={sitePath(sp.next ?? "/")} />
      <p className="mt-8 text-center text-xs text-ink-muted">
        <Link
          href="/login"
          className="underline underline-offset-2 hover:text-ink"
        >
          ログインからやり直す
        </Link>
      </p>
    </AuthFrame>
  );
}
