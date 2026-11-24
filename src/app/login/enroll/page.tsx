import Link from "next/link";
import { redirect } from "next/navigation";
import { beginTotpEnrollment } from "@/lib/auth-server";
import { readPending } from "@/lib/session";
import { sitePath } from "@/lib/site-path";
import { AuthFrame } from "../auth-frame";
import { EnrollForm } from "./enroll-form";

// 設定の途中なら同じ秘密を返し、なければ作って保存する。キャッシュさせない
export const dynamic = "force-dynamic";

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const pending = await readPending("enroll");
  if (!pending) redirect("/login");
  const sp = await searchParams;

  let enrollment;
  try {
    enrollment = await beginTotpEnrollment(pending.userId);
  } catch {
    // すでに設定済みなど。最初からやり直す
    redirect("/login");
  }

  return (
    <AuthFrame title="2段階認証の設定" wide>
      <EnrollForm
        secret={enrollment.secret}
        uri={enrollment.uri}
        qrSvg={enrollment.qrSvg}
        next={sitePath(sp.next ?? "/")}
      />
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
