import { describe, expect, it } from 'vitest';
import { workspaceActionUrl } from '../src/lib/workspace/actionUrl';

describe('workspace action URLs', () => {
	it('builds a named root action URL', () => {
		expect(workspaceActionUrl('upload', '')).toBe('?/upload');
	});

	it('preserves the selected client in named action URLs', () => {
		expect(workspaceActionUrl('runSession', 'Mock')).toBe('?/runSession&client=Mock');
	});

	it('encodes client ids and omits blank clients', () => {
		expect(workspaceActionUrl('importMappingCsv', 'client B/demo')).toBe(
			'?/importMappingCsv&client=client%20B%2Fdemo'
		);
		expect(workspaceActionUrl('saveMapping', '   ')).toBe('?/saveMapping');
	});
});
