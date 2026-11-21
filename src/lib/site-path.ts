/**
 * ログイン後の遷移先を、このサイトの中のパスだけに限る。
 * ブラウザと同じ規則で URL として解決し、別のサイトを指すもの（スラッシュ 2 つで始まるもの、
 * バックスラッシュを挟んだもの、タブや改行を挟んだものなど）は、トップページに置き換える。
 */
export function sitePath(next: string): string {
  const base = "http://keiri.invalid";
  try {
    const url = new URL(next, base);
    const path = `${url.pathname}${url.search}${url.hash}`;
    // "/.//example.com" のように、解決したあとで // から始まるパスは、ブラウザが別のサイトとして読む。
    return url.origin === base && !path.startsWith("//") ? path : "/";
  } catch {
    return "/";
  }
}
