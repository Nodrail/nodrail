const docsOrigin =
  process.env.NEXT_PUBLIC_NODRAIL_DOCS_ORIGIN || "https://nodrail.com";

export const docsUrl = (path = "") =>
  new URL(path ? `/docs/${path}` : "/docs", docsOrigin).href;
