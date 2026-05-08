import { describe, expect, it } from 'vitest';
import { buildClaimsRunProfile, profileClaimsBuffer } from '../src/lib/server/claimsProfile';

describe('claims profile', () => {
	it('profiles mapped medical claims from an uploaded CSV buffer', () => {
		const csv = [
			'Member Identifier,Date Service Started,Diagnosis Code 1,Paid Amount,Place of Service',
			'm1,2023-01-05,E119,10.50,11',
			'm2,2023-02-05,I10,20,23',
			'm1,2024-01-05,E119,30,11'
		].join('\n');

		const profile = profileClaimsBuffer({
			filename: 'medical.csv',
			fileType: 'medical',
			buffer: Buffer.from(csv),
			headers: [
				'Member Identifier',
				'Date Service Started',
				'Diagnosis Code 1',
				'Paid Amount',
				'Place of Service'
			],
			rowCount: 4,
			mappingFields: {
				'Member Identifier': 'member_id',
				'Date Service Started': 'date_service_start',
				'Diagnosis Code 1': 'icd_1',
				'Paid Amount': 'amount_total',
				'Place of Service': 'pos_code'
			}
		});

		expect(profile).toBeTruthy();
		expect(profile?.profiledRows).toBe(3);
		expect(profile?.metrics.uniqueMembers).toBe(2);
		expect(profile?.metrics.totalAmount).toBe(60.5);
		expect(profile?.coverage.hasDiagnosis).toBe(true);
		expect(profile?.topDiagnoses[0]).toMatchObject({ code: 'E119', count: 2 });

		const run = buildClaimsRunProfile(profile ? [profile] : []);
		expect(run?.summary.profiledRows).toBe(3);
		expect(run?.summary.serviceYears[0].year).toBe('2023');
	});
});
