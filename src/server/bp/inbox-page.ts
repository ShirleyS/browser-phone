export const INBOX_PAGE_BYTES = 60000;
type Row = { seq: number; external_id: string; type: string; text: string | null; link: unknown; created_at: string };
export function inboxPage(rows: Row[], after: string, session: { status: string; expires_at: string }) {
  const page = { messages: [] as { id: string; type: string; text: string | null; link: unknown; created_at: string; cursor: string }[], next_cursor: after, session };
  const encoder = new TextEncoder();
  for (const row of rows) {
    const message = { id: row.external_id, type: row.type, text: row.text, link: row.link, created_at: row.created_at, cursor: String(row.seq) };
    const candidate = { ...page, messages: [...page.messages, message], next_cursor: message.cursor };
    if (encoder.encode(JSON.stringify(candidate)).byteLength > INBOX_PAGE_BYTES) break;
    page.messages.push(message); page.next_cursor = message.cursor;
  }
  return page;
}