export class BodyLimitError extends Error {}

/** Bound bytes before decoding, even with no/forged Content-Length. */
export async function boundedText(stream: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0; let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new BodyLimitError('Body limit exceeded'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}