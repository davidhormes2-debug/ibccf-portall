import crypto from "crypto";
import path from "path";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";

const ROOT = path.resolve(
  process.env.CHAT_ATTACHMENT_DIR || path.join(process.cwd(), "var", "chat-attachments"),
);

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function persistChatAttachment(input: {
  caseId: string;
  fileName: string;
  bytes: Buffer;
}): Promise<string> {
  const caseDir = path.join(ROOT, safeSegment(input.caseId));
  await mkdir(caseDir, { recursive: true });
  const ext = path.extname(input.fileName).slice(0, 16);
  const storageKey = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  await writeFile(path.join(caseDir, storageKey), input.bytes, { flag: "wx" });
  return `${safeSegment(input.caseId)}/${storageKey}`;
}
export async function readChatAttachment(storageKey: string): Promise<Buffer> {
  const resolved = path.resolve(ROOT, storageKey);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("Invalid attachment storage key");
  }
  return readFile(resolved);
}

export async function deleteChatAttachment(storageKey: string): Promise<void> {
  try {
    const resolved = path.resolve(ROOT, storageKey);
    if (!resolved.startsWith(`${ROOT}${path.sep}`)) return;
    await unlink(resolved);
  } catch {
    // Best effort cleanup only.
  }
}

export function getChatAttachmentRoot(): string {
  return ROOT;
}