import { randomBytes } from "node:crypto";

/**
 * An email DRAFT as a standard .eml file (RFC 5322 / MIME): plain text body plus attachments. Double-clicking it opens it in the owner's mail program
 * (Outlook, Windows Mail, Thunderbird) as a message to review and send by hand. Nothing is sent and no mail service is contacted.
 * Header values are checked to be one line, so a subject or address can never smuggle in another header.
 */
export const EML_LIMITS = { attachments: 5, attachmentBytes: 10_000_000, totalBytes: 15_000_000, body: 20_000, recipients: 5, subject: 200 };
export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,}$/;
export const ATTACHMENT_EXTENSIONS = ["pdf", "xlsx", "csv", "docx", "pptx", "txt", "md", "html", "svg"] as const;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  svg: "image/svg+xml",
};
const oneLine = (s: string) => !/[\r\n]/.test(s);
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap64 = (b: Buffer) => (b.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

export interface EmlInput {
  to: string[];
  subject: string;
  body: string;
  attachments: { filename: string; data: Buffer }[];
  /** Set for tests; the real call uses the current time. */
  date?: Date;
}

export function buildEml(input: EmlInput): Buffer {
  if (!oneLine(input.subject)) throw new Error("The subject must be one line.");
  for (const a of input.to) if (!EMAIL_RE.test(a)) throw new Error(`"${a}" is not an email address.`);
  const boundary = `=_awp_${randomBytes(12).toString("hex")}`;
  const lines: string[] = [
    // X-Unsent makes Outlook open the file as an editable draft instead of a received message.
    "X-Unsent: 1",
    ...(input.to.length ? [`To: ${input.to.join(", ")}`] : []),
    `Subject: ${encodeWord(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap64(Buffer.from(input.body, "utf8")),
  ];
  for (const a of input.attachments) {
    const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
    const safe = a.filename.replace(/[^\w .()\-]/g, "_").slice(0, 120);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${MIME[ext] ?? "application/octet-stream"}; name="${safe}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safe}"`,
      "",
      wrap64(a.data),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}
