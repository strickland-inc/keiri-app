import type { MetadataRoute } from "next";

// 全クローラに対し全パスを拒否（経理データのため非公開扱い）
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
