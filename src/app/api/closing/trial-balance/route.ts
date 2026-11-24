import { currentSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { getRepositories } from "@/repositories";
import { loadCompanyContext } from "@/lib/active-company";
import { isValidClosingTerm, loadClosing } from "@/lib/closing/load-closing";
import { buildTrialBalanceCsv } from "@/lib/closing/trial-balance-csv";
import { asciiFallbackFilename } from "@/lib/documents/pdfFilename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const term = Number(url.searchParams.get("term"));
  if (!isValidClosingTerm(term)) {
    return new Response("Bad Request", { status: 400 });
  }

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const loaded = await loadClosing(repos, company, term);
  if (!loaded || !company.active) {
    return new Response("Not Found", { status: 404 });
  }

  const csv = buildTrialBalanceCsv(loaded.report);
  const filename = `試算表_第${term}期_${company.active.name}.csv`;
  const encodedName = encodeURIComponent(filename);
  const fallbackName = asciiFallbackFilename(filename);

  await recordAudit(
    session,
    "export.trial_balance_csv",
    { type: "closing", id: String(term) },
    `試算表 CSV を書き出し（第${term}期、${company.active.name}）`,
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
