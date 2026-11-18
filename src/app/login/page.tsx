import { login } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const hasError = sp.error === "1";
  const next = sp.next ?? "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[360px]">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight">
          KEIRI にログイン
        </h1>

        {hasError && (
          <Alert tone="danger" className="mb-4">
            ID またはパスワードが違います
          </Alert>
        )}

        <form action={login} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="ID" htmlFor="id">
            <Input
              id="id"
              name="id"
              type="text"
              autoComplete="username"
              required
              autoFocus
            />
          </Field>
          <Field label="パスワード" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" className="mt-2 w-full">
            ログイン
          </Button>
        </form>
      </div>
    </div>
  );
}
