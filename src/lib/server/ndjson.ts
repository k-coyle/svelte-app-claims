export type Insertable = (docs: any[]) => Promise<void>;

/** Feed NDJSON chunks, batch every N lines, decorate, and insert. */
export function createNdjsonIngestor(
  insertMany: Insertable,
  decorate: (o: any) => any,
  batchSize = 1000
) {
  let rest = '';
  let batch: any[] = [];

  async function flushInternal() {
    if (batch.length) {
      await insertMany(batch);
      batch = [];
    }
  }

  return {
    async push(chunk: string) {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? ''; // keep trailing partial line
      for (const line of lines) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        batch.push(decorate(obj));
        if (batch.length >= batchSize) {
          await flushInternal();
        }
      }
    },
    async flush() {
      // parse any leftover (if it is a complete line)
      if (rest.trim()) {
        const obj = JSON.parse(rest);
        batch.push(decorate(obj));
        rest = '';
      }
      await flushInternal();
    }
  };
}
