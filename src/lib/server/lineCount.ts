// src/lib/server/lineCount.ts
export function countLinesFast(buf: Buffer): number {
	return buf
		.toString('utf8')
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0).length;
}
