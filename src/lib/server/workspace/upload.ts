import { readFile } from 'node:fs/promises';
import { writeAnalysisArtifacts } from '$lib/server/analysis';
import { buildClaimsRunProfile, profileClaimsBuffer } from '$lib/server/claimsProfile';
import { getDefaultMapping, insertUploadSession } from '$lib/server/db';
import {
	buildSessionValidation,
	cleanupRawTempFiles,
	fileStatsFromProfiles,
	fileTypes,
	legacySessionFileType,
	profileUploadedFiles,
	rawUploadRetentionPolicy,
	readFilesFromForm,
	validateAllowedFiles,
	writeCanonicalFiles,
	writeRawTempFiles,
	type CanonicalIngestionFile,
	type IngestionFileProfile,
	type IngestionSessionValidation,
	type RawUploadRetention
} from '$lib/server/ingestion';

export type User = { id: string; role: 'client' | 'client_manager'; accountId?: string };

export type WorkspaceActionEvent = {
	request: Request;
	getClientAddress?: () => string;
};

export function getUser(): User {
	return { id: 'user_123', role: 'client_manager' };
}

export function getAllowedAccounts(user: User) {
	if (user.role === 'client') return [{ id: user.accountId!, name: 'My Account' }];
	return [
		{ id: 'clientA', name: 'Client A' },
		{ id: 'clientB', name: 'Client B' },
		{ id: 'clientC', name: 'Client C' }
	];
}

export function canSelectAccount(user: User, accountId: string) {
	return user.role === 'client' ? user.accountId === accountId : true;
}

function auditLog(event: string, payload: Record<string, unknown>) {
	try {
		console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
	} catch {
		console.info(`[audit] ${event}`);
	}
}

function previewMappingSummary(files: IngestionFileProfile[]) {
	const first = files[0]?.mapping;
	return {
		usedMapping: first?.source ?? 'none',
		mappingVersion: first?.version,
		mappingFieldCount: first?.fieldCount
	};
}

function analysisMappingSummary(files: IngestionFileProfile[]) {
	const mapped = files.find((file) => file.mapping.fieldCount > 0)?.mapping;
	return mapped
		? {
				source: mapped.source,
				mappingId: mapped.mappingId,
				version: mapped.version,
				name: mapped.name,
				defaultReason: mapped.defaultReason,
				fields: mapped.fields
			}
		: { source: 'none' as const };
}

async function buildClaimsProfile(files: CanonicalIngestionFile[]) {
	const profiles = await Promise.all(
		files
			.filter((file) => file.fileType === 'medical' || file.fileType === 'pharmacy')
			.map(async (file) =>
				profileClaimsBuffer({
					filename: file.filename,
					fileType: file.fileType,
					buffer: await readFile(file.path),
					headers: null,
					rowCount: file.rowCount,
					mappingFields: {}
				})
			)
	);
	return buildClaimsRunProfile(
		profiles.filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
	);
}

async function makeProfiles(input: {
	form: FormData;
	accountId: string;
	claimMembersEligibleAssumptionAccepted: boolean;
}) {
	const files = await readFilesFromForm(input.form);
	if (!files.length) throw new Error('Please attach at least one file.');

	const validationError = validateAllowedFiles(files);
	if (validationError) throw new Error(validationError);

	const profiles = await profileUploadedFiles({
		accountId: input.accountId,
		form: input.form,
		files,
		getActiveMapping: getDefaultMapping
	});
	const validation = buildSessionValidation({
		files: profiles,
		claimMembersEligibleAssumptionAccepted: input.claimMembersEligibleAssumptionAccepted
	});

	return { files, profiles, validation };
}

function assertEligibilityConfirmation(validation: IngestionSessionValidation) {
	if (
		!validation.session.eligibilityPresent &&
		!validation.session.claimMembersEligibleAssumptionAccepted
	) {
		throw new Error(
			'Eligibility is missing. Confirm that all individuals in the claims files may be treated as eligible before continuing.'
		);
	}
}

function publicFiles(files: IngestionFileProfile[]) {
	return files.map((file) => ({
		fileId: file.fileId,
		filename: file.filename,
		bytes: file.bytes,
		mime: file.mime,
		rowCount: file.rowCount,
		headers: file.headers,
		inferredFileType: file.inferredFileType,
		fileType: file.fileType,
		mapping: {
			source: file.mapping.source,
			mode: file.mapping.mode,
			mappingId: file.mapping.mappingId,
			version: file.mapping.version,
			name: file.mapping.name,
			originalFilename: file.mapping.originalFilename,
			defaultReason: file.mapping.defaultReason,
			fieldCount: file.mapping.fieldCount,
			fields: file.mapping.fields
		},
		validation: file.validation
	}));
}

async function confirmSession(input: {
	user: User;
	accountId: string;
	profiles: IngestionFileProfile[];
	files: Awaited<ReturnType<typeof readFilesFromForm>>;
	validation: IngestionSessionValidation;
	createdAt: string;
	totalBytes: number;
	retention: RawUploadRetention;
}) {
	const stats = fileStatsFromProfiles(input.profiles);
	const sessionFileType = legacySessionFileType(input.profiles);
	const sessionFileTypes = fileTypes(input.profiles);
	const sessionId = await insertUploadSession({
		uploaderUserId: input.user.id,
		accountId: input.accountId,
		fileType: sessionFileType,
		fileTypes: sessionFileTypes,
		usedMapping: previewMappingSummary(input.profiles).usedMapping,
		mappingVersion: previewMappingSummary(input.profiles).mappingVersion,
		stats,
		files: publicFiles(input.profiles),
		validation: input.validation,
		rawUploadRetention: input.retention,
		createdAt: input.createdAt,
		totalBytes: input.totalBytes,
		audit: { confirmAt: input.createdAt }
	});

	let rawDir: string | undefined;
	let finalRetention = input.retention;
	try {
		rawDir = await writeRawTempFiles({ sessionId, files: input.files });
		const canonicalFiles = await writeCanonicalFiles({
			sessionId,
			files: input.files,
			profiles: input.profiles
		});
		finalRetention = await cleanupRawTempFiles(rawDir, input.retention);

		await writeAnalysisArtifacts({
			manifestVersion: 2,
			sessionId,
			accountId: input.accountId,
			createdAt: input.createdAt,
			files: canonicalFiles.map((file) => ({
				fileId: file.fileId,
				path: file.path,
				filename: file.filename,
				bytes: file.bytes,
				fileType: file.fileType,
				rowCount: file.rowCount,
				headers: file.headers,
				mime: file.mime,
				mapping: {
					source: file.mapping.source,
					mode: file.mapping.mode,
					mappingId: file.mapping.mappingId,
					version: file.mapping.version,
					name: file.mapping.name,
					originalFilename: file.mapping.originalFilename,
					defaultReason: file.mapping.defaultReason,
					fields: file.mapping.fields,
					fieldCount: file.mapping.fieldCount
				},
				validation: file.validation,
				invalidRowCount: file.validation.invalidRowCount,
				rejectedRowCount: file.validation.rejectedRowCount,
				artifacts: file.artifacts
			})),
			fileTypes: sessionFileTypes,
			claims: await buildClaimsProfile(canonicalFiles),
			mapping: analysisMappingSummary(input.profiles),
			validation: input.validation,
			rawUploadRetention: finalRetention
		});

		auditLog('upload.confirm', {
			sessionId,
			accountId: input.accountId,
			fileType: sessionFileType,
			fileTypes: sessionFileTypes,
			productionReady: input.validation.productionReady,
			rawUploadRetention: finalRetention.cleanupStatus,
			files: input.profiles.map((file) => ({
				filename: file.filename,
				bytes: file.bytes,
				fileType: file.fileType,
				mappingSource: file.mapping.source,
				mappingVersion: file.mapping.version,
				validationStatus: file.validation.status
			}))
		});

		return { sessionId, rawUploadRetention: finalRetention };
	} catch (error) {
		if (rawDir) await cleanupRawTempFiles(rawDir, input.retention);
		throw error;
	}
}

export async function handleUploadAction(evt: WorkspaceActionEvent) {
	try {
		const request = evt.request;
		const ip = typeof evt.getClientAddress === 'function' ? evt.getClientAddress() : undefined;
		const form = await request.formData();
		const user = getUser();

		const intent = String(form.get('intent') ?? 'preview');
		const accountId = String(form.get('accountId') ?? '');
		const claimMembersEligibleAssumptionAccepted = form.get('assumeClaimMembersEligible') === 'on';

		if (!accountId) return { error: 'Account is required.' };
		if (!canSelectAccount(user, accountId)) return { error: 'Not allowed for this account.' };

		const { files, profiles, validation } = await makeProfiles({
			form,
			accountId,
			claimMembersEligibleAssumptionAccepted
		});
		const stats = fileStatsFromProfiles(profiles);
		const totalBytes = stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0);
		const summary = previewMappingSummary(profiles);
		const sessionFileType = legacySessionFileType(profiles);
		const sessionFileTypes = fileTypes(profiles);

		if (intent === 'preview') {
			auditLog('upload.preview', {
				uploaderUserId: user.id,
				accountId,
				fileType: sessionFileType,
				fileTypes: sessionFileTypes,
				ip,
				productionReady: validation.productionReady,
				files: profiles.map((file) => ({
					filename: file.filename,
					bytes: file.bytes,
					mime: file.mime,
					fileType: file.fileType,
					mappingSource: file.mapping.source,
					mappingVersion: file.mapping.version,
					validationStatus: file.validation.status
				})),
				totalBytes
			});

			return {
				preview: {
					uploaderUserId: user.id,
					accountId,
					fileType: sessionFileType,
					fileTypes: sessionFileTypes,
					...summary,
					stats,
					files: publicFiles(profiles),
					validation
				}
			};
		}

		if (intent === 'confirm') {
			assertEligibilityConfirmation(validation);
			const createdAt = new Date().toISOString();
			const retention = rawUploadRetentionPolicy();
			const confirmed = await confirmSession({
				user,
				accountId,
				profiles,
				files,
				validation,
				createdAt,
				totalBytes,
				retention
			});

			return {
				confirmed: true,
				sessionId: confirmed.sessionId,
				accountId,
				validation,
				rawUploadRetention: confirmed.rawUploadRetention
			};
		}

		return { error: 'Unknown intent.' };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : 'Unexpected error';
		if (process.env.NODE_ENV !== 'test') console.error('Upload error:', message);
		return { error: message };
	}
}
