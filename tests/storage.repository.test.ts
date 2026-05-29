import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileDocumentRepository } from '../src/lib/server/storage/fileRepository';

describe('file document repository', () => {
	let root: string | null = null;

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		root = null;
	});

	it('stores sessions in per-session folders and maintains upload indexes', async () => {
		root = await mkdtemp(join(process.cwd(), 'var', 'test-storage-'));
		const repo = createFileDocumentRepository({ rootDir: root });

		const id = await repo.insertUploadSession({
			_id: 'sess_mvp_storage',
			uploaderUserId: 'user_123',
			accountId: 'clientA',
			fileType: 'mixed',
			fileTypes: ['eligibility', 'medical'],
			usedMapping: 'stored',
			stats: [{ filename: 'medical.csv', bytes: 12, rowCount: 2 }],
			createdAt: '2026-05-27T12:00:00.000Z',
			totalBytes: 12
		});

		const sessionPath = join(root, 'sessions', id, 'session.json');
		const indexPath = join(root, 'indexes', 'upload-sessions.json');

		expect(id).toBe('sess_mvp_storage');
		expect(existsSync(sessionPath)).toBe(true);
		expect(existsSync(indexPath)).toBe(true);

		const indexed = JSON.parse(await readFile(indexPath, 'utf8'));
		expect(indexed.upload_sessions).toHaveLength(1);
		expect(indexed.upload_sessions[0]._id).toBe(id);

		const rows = await repo.listUploadSessions({ accountId: 'clientA', fileType: 'medical' });
		expect(rows).toHaveLength(1);
		expect(rows[0]._id).toBe(id);
	});

	it('deletes selected demo session metadata and generated artifacts', async () => {
		root = await mkdtemp(join(process.cwd(), 'var', 'test-storage-'));
		const repo = createFileDocumentRepository({ rootDir: root });
		const id = await repo.insertUploadSession({
			_id: 'sess_delete_me',
			uploaderUserId: 'user_123',
			accountId: 'clientA',
			fileType: 'medical',
			fileTypes: ['medical'],
			usedMapping: 'canonical',
			stats: [],
			createdAt: '2026-05-27T12:00:00.000Z',
			totalBytes: 0
		});
		await mkdir(join(root, 'analysis', id), { recursive: true });
		await mkdir(join(root, 'uploads', id), { recursive: true });
		await writeFile(join(root, 'analysis', id, 'manifest.json'), '{}', 'utf8');
		await writeFile(join(root, 'uploads', id, 'raw.csv'), 'raw', 'utf8');

		const result = await repo.deleteUploadSession(id);

		expect(result.deleted).toBe(true);
		expect(existsSync(join(root, 'sessions', id))).toBe(false);
		expect(existsSync(join(root, 'analysis', id))).toBe(false);
		expect(existsSync(join(root, 'uploads', id))).toBe(false);
		expect(await repo.countUploadSessions()).toBe(0);
	});

	it('clears demo sessions without removing mappings', async () => {
		root = await mkdtemp(join(process.cwd(), 'var', 'test-storage-'));
		const repo = createFileDocumentRepository({ rootDir: root });
		await repo.upsertMapping({
			accountId: 'clientA',
			fileType: 'medical',
			version: 1,
			json: { fields: { MemberID: 'member_id' } },
			isActive: true
		});
		await repo.insertUploadSession({
			_id: 'sess_clear_me',
			uploaderUserId: 'user_123',
			accountId: 'clientA',
			fileType: 'medical',
			fileTypes: ['medical'],
			usedMapping: 'stored',
			stats: [],
			createdAt: '2026-05-27T12:00:00.000Z',
			totalBytes: 0
		});
		await mkdir(join(root, 'analysis', 'orphan_old_session'), { recursive: true });
		await writeFile(join(root, 'analysis', 'orphan_old_session', 'manifest.json'), '{}', 'utf8');

		const result = await repo.clearDemoSessions();

		expect(result.deletedSessions).toBe(1);
		expect(await repo.countUploadSessions()).toBe(0);
		expect(await repo.listMappings({ accountId: 'clientA', fileType: 'medical' })).toHaveLength(1);
		expect(existsSync(join(root, 'analysis', 'orphan_old_session'))).toBe(false);
	});
});
