import { describe, expect, it } from 'vitest';
import {
	mappingPayloadToFields,
	parseHistoricalMappingCsv
} from '../src/lib/server/mappingImport';

describe('historical mapping import', () => {
	it('parses the legacy column mapping CSV shape', () => {
		const parsed = parseHistoricalMappingCsv(
			[
				'column_number,column,column_uspm,dtype,parse_date',
				'0,Claim Number,number,Int64,FALSE',
				'1,Member Identifier,member_id,string,FALSE',
				'2,Date Service Started,date_service_start,,TRUE'
			].join('\n')
		);

		expect(parsed.sourceFormat).toBe('historical_column_mapping_csv');
		expect(parsed.fields['Claim Number']).toBe('number');
		expect(parsed.fields['Date Service Started']).toBe('date_service_start');
		expect(parsed.positionFields['2']).toBe('date_service_start');
		expect(parsed.dateFields).toEqual(['date_service_start']);
	});

	it('uses position fields when uploaded headers are numeric', () => {
		const parsed = parseHistoricalMappingCsv(
			[
				'column_number,column,column_uspm,dtype,parse_date',
				'0,member_id,member_id,string,FALSE',
				'1,name_first,name_first,string,FALSE'
			].join('\n')
		);

		expect(mappingPayloadToFields(parsed, ['0', '1'])).toEqual({
			'0': 'member_id',
			'1': 'name_first'
		});
		expect(mappingPayloadToFields(parsed, ['member_id', 'name_first'])).toEqual({
			member_id: 'member_id',
			name_first: 'name_first'
		});
	});
});
