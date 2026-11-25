import { site } from "@nodrail/web-shared/site";

const ink = "#172925";
const text = "#273b32";
const muted = "#6b7a72";
const ivory = "#f5f3eb";
const line = "#e4e1d6";
const font =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The one look every Nodrail email shares. Tables and inline styles, because
 * that is what email clients render. All values arrive already escaped.
 */
export function brandedEmail({
  heading,
  paragraphs,
  action,
  footnote,
}: {
  heading: string;
  paragraphs: string[];
  action: { label: string; href: string };
  footnote?: string;
}) {
  const body = paragraphs
    .map(
      (value) =>
        `<p style="margin:0 0 14px;color:${text};font:15px/1.55 ${font}">${value}</p>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${ivory}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ivory}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px"><img src="${site.url}/brand/email-logo.png" width="144" height="45" alt="Nodrail" style="display:block;border:0"></td></tr>
<tr><td style="padding:32px;background:#ffffff;border:1px solid ${line};border-radius:12px">
<h1 style="margin:0 0 14px;color:${ink};font:600 21px/1.3 ${font}">${heading}</h1>
${body}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr><td style="background:${ink};border-radius:8px"><a href="${action.href}" style="display:inline-block;padding:12px 22px;color:${ivory};font:600 15px/1 ${font};text-decoration:none">${action.label}</a></td></tr></table>
${footnote ? `<p style="margin:22px 0 0;color:${muted};font:13px/1.5 ${font}">${footnote}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 4px 0;color:${muted};font:12px/1.5 ${font}">Nodrail · The open control plane for AI agent development<br>Questions? ${site.contactEmail}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
