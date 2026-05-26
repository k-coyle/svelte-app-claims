export type ReportCellValue = string | number | boolean | null;

export type AnalysisRequirement = {
	key: string;
	label: string;
	status: 'met' | 'needed' | 'optional';
	description: string;
};

export type AnalysisMetric = {
	label: string;
	value: string | number;
	tone?: 'default' | 'good' | 'warning';
};

export type ReportYearSummary = {
	sheetName: string;
	analysisYear: number | null;
	medicalTotal: number | null;
	medicalTotalAfterExclusions: number | null;
	pharmacyTotal: number | null;
	fte: number | null;
	medicalPppy: number | null;
	medicalPppyAfterExclusions: number | null;
	exclusionSavings: number | null;
};

export type AnalysisReportSummary = {
	sourceFilename: string;
	yearCount: number;
	sectionCount: number;
	years: ReportYearSummary[];
	latestYear: Omit<ReportYearSummary, 'sheetName' | 'pharmacyTotal' | 'fte'> | null;
	conditionCosts: Record<string, ReportCellValue>[];
	conditionPrevalence: Record<string, ReportCellValue>[];
	riskProfile: Record<string, ReportCellValue>[];
	availableSections: string[];
};

export type ClaimsProfile = {
	source: 'uploaded_claims';
	profiledAt: string;
	maxRowsPerFile: number;
	summary: {
		fileCount: number;
		profiledRows: number;
		uniqueMembers: number;
		totalAmount: number | null;
		serviceYears: Array<{ year: string; count: number; amount: number | null }>;
		topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
	};
	files: Array<{
		filename: string;
		fileType: string;
		profiledRows: number;
		totalRows?: number | null;
		mappedFieldCount: number;
		coverage: {
			hasMemberId: boolean;
			hasServiceDate: boolean;
			hasAmount: boolean;
			hasDiagnosis: boolean;
		};
		metrics: {
			uniqueMembers: number;
			totalAmount: number | null;
			averageAmount: number | null;
			minServiceDate: string | null;
			maxServiceDate: string | null;
		};
		serviceYears: Array<{ year: string; count: number; amount: number | null }>;
		topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
		topPlacesOfService: Array<{ code: string; count: number; amount: number | null }>;
		topRelationships: Array<{ value: string; count: number; amount: number | null }>;
	}>;
};

export type AnalysisManifest = {
	manifestVersion?: number;
	sessionId: string;
	accountId: string;
	createdAt: string;
	status: string;
	fileTypes?: string[];
	files: Array<{
		fileId?: string;
		path?: string;
		filename: string;
		fileType: string;
		bytes?: number;
		rowCount?: number | null;
		headers?: string[] | null;
		mime?: string;
		mapping?: {
			source: 'stored' | 'provided' | 'canonical' | 'none';
			mode?: string;
			version?: number;
			fields?: Record<string, string>;
			fieldCount?: number;
		};
		validation?: Record<string, unknown>;
		invalidRowCount?: number;
		rejectedRowCount?: number;
		artifacts?: {
			canonicalCsv?: string;
		};
	}>;
	requirements: AnalysisRequirement[];
	metrics: AnalysisMetric[];
	python: {
		pythonRoot: string;
		requirementsFile: string;
		runner: string;
		status: string;
		notes: string[];
	};
	artifacts?: {
		reportSections?: string;
		reportWorkbook?: string;
		reportXlsx?: string;
		claimsProfile?: string;
		dashboard?: string;
		manifest?: string;
	};
	mapping?: {
		source: 'stored' | 'provided' | 'canonical' | 'none';
		version?: number;
		fields?: Record<string, string>;
	};
	validation?: {
		productionReady?: boolean;
		session?: {
			eligibilityPresent?: boolean;
			medicalPresent?: boolean;
			pharmacyPresent?: boolean;
			claimMembersEligibleAssumptionAccepted?: boolean;
		};
		warnings?: Array<{
			severity?: string;
			code?: string;
			message?: string;
			filename?: string;
			fileType?: string;
		}>;
	};
	rawUploadRetention?: {
		retained?: boolean;
		reason?: string;
		cleanupStatus?: string;
		rawUploadDir?: string;
	};
	claims?: ClaimsProfile;
	report?: AnalysisReportSummary;
};

export type ReportSection = {
	rows: Record<string, ReportCellValue>[];
	properties?: Record<string, ReportCellValue>;
	columns?: string[];
};

export type ReportSectionsArtifact = {
	analysisMode?: string;
	cleanedArtifacts?: Record<string, string>;
	xlsxReportPath?: string;
	validation?: {
		claimCount: number;
		serviceYears: number[];
		productionReady?: boolean;
		session?: {
			eligibilityPresent?: boolean;
			medicalPresent?: boolean;
			pharmacyPresent?: boolean;
			claimMembersEligibleAssumptionAccepted?: boolean;
		};
		checks: Array<{
			key: string;
			label: string;
			status: 'met' | 'missing' | 'warning';
			coverage: number;
		}>;
		warnings: string[];
		cleanedArtifacts: Record<string, string>;
	};
	dashboard?: {
		kpis?: Record<string, ReportCellValue>;
		trends?: {
			annualMedicalCost?: Array<Record<string, ReportCellValue>>;
			averageAnnualMedicalChangePct?: number;
		};
		rankedLists?: {
			conditionCosts?: Record<string, ReportCellValue>[];
			conditionPrevalence?: Record<string, ReportCellValue>[];
			riskProfile?: Record<string, ReportCellValue>[];
		};
		matrix?: Record<string, ReportCellValue>[];
		findings?: Array<{ title: string; body: string }>;
		recommendations?: string[];
	};
	years?: Array<{
		analysisYear: number;
		sections: Record<string, ReportSection>;
	}>;
	warnings?: string[];
} | null;
