import { currentSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { getRepositories } from "@/repositories";
import { loadCompanyContext } from "@/lib/active-company";
import { isValidClosingTerm, loadClosing } from "@/lib/closing/load-closing";
import {
  expensesToFreeeCsv,
  revenuesToFreeeCsv,
} from "@/lib/closing/freee-csv";
import { asciiFallbackFilename } from "@/lib/documents/pdfFilename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_LABELS = { expenses: "経費", revenues: "売上" } as const;
type Kind = keyof typeof KIND_LABELS;

function isKind(v: string): v is Kind {
  return v === "expenses" || v === "revenues";
}

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const term = Number(url.searchParams.get("term"));
  const kind = url.searchParams.get("kind") ?? "";
  if (!isValidClosingTerm(term) || !isKind(kind)) {
    return new Response("Bad Request", { status: 400 });
  }

  const repos = await getRepositories();
  const company = await loadCompanyContext(repos);
  const loaded = await loadClosing(repos, company, term);
  if (!loaded || !company.active) {
    return new Response("Not Found", { status: 404 });
  }

  const csv =
    kind === "expenses"
      ? expensesToFreeeCsv(loaded.expenses, {
          settlementAccount:
            url.searchParams.get("account")?.trim() || undefined,
        })
      : revenuesToFreeeCsv(loaded.revenues);

  const filename = `freee取引_${KIND_LABELS[kind]}_第${term}期_${company.active.name}.csv`;
  const encodedName = encodeURIComponent(filename);
  const fallbackName = asciiFallbackFilename(filename);

  await recordAudit(
    session,
    "export.freee_csv",
    { type: "closing", id: String(term) },
    `freee 用の${KIND_LABELS[kind]} CSV を書き出し（第${term}期、${company.active.name}）`,
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
