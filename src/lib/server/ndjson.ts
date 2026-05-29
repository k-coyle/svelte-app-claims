export type NdjsonRecord = Record<string, unknown>;
export type Insertable<TRecord extends NdjsonRecord = NdjsonRecord> = (
	docs: TRecord[]
) => Promise<void>;

/** Feed NDJSON chunks, batch every N lines, decorate, and insert. */
export function createNdjsonIngestor<
	TInput extends NdjsonRecord = NdjsonRecord,
	TOutput extends NdjsonRecord = NdjsonRecord
>(insertMany: Insertable<TOutput>, decorate: (o: TInput) => TOutput, batchSize = 1000) {
	let rest = '';
	let batch: TOutput[] = [];

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
				const obj = JSON.parse(line) as TInput;
				batch.push(decorate(obj));
				if (batch.length >= batchSize) {
					await flushInternal();
				}
			}
		},
		async flush() {
			// parse any leftover (if it is a complete line)
			if (rest.trim()) {
				const obj = JSON.parse(rest) as TInput;
				batch.push(decorate(obj));
				rest = '';
			}
			await flushInternal();
		}
	};
}
