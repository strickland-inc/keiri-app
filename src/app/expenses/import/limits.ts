// "use server" のファイルは関数しか export できないため、画面とサーバーで共有する上限はここに置く。

/** 1 回の保存で取り込める行数。1 回の要求でスプレッドシートへ書く量を抑える。 */
export const MAX_IMPORT_ROWS = 500;

/** Server Action の本文の上限（既定 1MB）に収まる大きさ。 */
export const MAX_FILE_BYTES = 1_000_000;
