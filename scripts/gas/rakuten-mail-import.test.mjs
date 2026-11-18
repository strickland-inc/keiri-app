import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("./rakuten-mail-import.gs", import.meta.url),
  "utf8",
);
const context = vm.createContext({ console });
vm.runInContext(source, context);

test("速報版本文から同額の重複を含む全明細を抽出する", () => {
  const body = [
    "ご利用日",
    "利用者",
    "ご利用金額",
    "2026/07/13 本人 1,033 円",
    "2026/07/13 本人 1,033 円",
    "2026/07/13 本人 899 円",
    "2026/07/13 本人 786 円",
  ].join("\n");

  const actual = context.parsePreliminaryTransactions_(body);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), [
    { date: "2026-07-13", amount: 1033 },
    { date: "2026-07-13", amount: 1033 },
    { date: "2026-07-13", amount: 899 },
    { date: "2026-07-13", amount: 786 },
  ]);
});

test("既存の速報行を同日同額の確定明細へ一対一で置換する計画を作る", () => {
  const existingRows = [
    [
      "p1",
      "2026-07-13",
      "利用先未確定（楽天速報）",
      "1033",
      "要確認",
      "楽天速報",
      "確定版待ち",
      "created",
      "updated",
    ],
    [
      "p2",
      "2026-07-13",
      "利用先未確定（楽天速報）",
      "1033",
      "要確認",
      "楽天速報",
      "確定版待ち",
      "created",
      "updated",
    ],
    [
      "p3",
      "2026-07-13",
      "利用先未確定（楽天速報）",
      "899",
      "要確認",
      "楽天速報",
      "確定版待ち",
      "created",
      "updated",
    ],
    [
      "p4",
      "2026-07-13",
      "利用先未確定（楽天速報）",
      "786",
      "要確認",
      "楽天速報",
      "確定版待ち",
      "created",
      "updated",
    ],
  ];
  const confirmed = [
    { date: "2026-07-13", merchant: "利用先A", amount: 1033 },
    { date: "2026-07-13", merchant: "利用先B", amount: 1033 },
    { date: "2026-07-13", merchant: "利用先C", amount: 899 },
  ];

  const actual = context.planExpenseImports_(existingRows, confirmed, []);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    confirmedUpdates: [
      { dataIndex: 0, transaction: confirmed[0] },
      { dataIndex: 1, transaction: confirmed[1] },
      { dataIndex: 2, transaction: confirmed[2] },
    ],
    confirmedInserts: [],
    preliminaryInserts: [],
  });
});

test("既存件数を超える速報だけを追加し、再実行では重複させない", () => {
  const existingRows = [
    [
      "p1",
      "2026-07-14",
      "利用先未確定（楽天速報）",
      "682",
      "要確認",
      "楽天速報",
      "確定版待ち",
      "created",
      "updated",
    ],
  ];
  const preliminary = [
    { date: "2026-07-14", amount: 682 },
    { date: "2026-07-14", amount: 1190 },
  ];

  const actual = context.planExpenseImports_(existingRows, [], preliminary);

  assert.deepEqual(JSON.parse(JSON.stringify(actual.preliminaryInserts)), [
    { date: "2026-07-14", amount: 1190 },
  ]);
});

test("同日同額の確定行が既にある過去速報は追加しない", () => {
  const existingRows = [
    [
      "c1",
      "2026-07-12",
      "確定済み利用先",
      "12020",
      "通信費",
      "楽天メール",
      "",
      "created",
      "updated",
    ],
  ];
  const preliminary = [{ date: "2026-07-12", amount: 12020 }];

  const actual = context.planExpenseImports_(existingRows, [], preliminary);

  assert.deepEqual(JSON.parse(JSON.stringify(actual.preliminaryInserts)), []);
});

test("他決済手段の同日同額行は楽天速報の追加を妨げない", () => {
  const existingRows = [
    [
      "other1",
      "2026-07-16",
      "別決済",
      "620",
      "消耗品費",
      "PayPay",
      "",
      "created",
      "updated",
    ],
  ];
  const preliminary = [{ date: "2026-07-16", amount: 620 }];

  const actual = context.planExpenseImports_(existingRows, [], preliminary);

  assert.deepEqual(
    JSON.parse(JSON.stringify(actual.preliminaryInserts)),
    preliminary,
  );
});
