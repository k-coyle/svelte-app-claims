import sys
import pandas as pd
from munch import Munch

from etl.abstract import (
	AbstractEligibilityReader,
	AbstractMedicalReader,
	AbstractPharmacyReader,
	AbstractReader,
)
from etl.common.cleaner import Cleaner as CommonCleaner
from etl.utils import get_pos_code


class Reader(AbstractReader):
	parser_config = Munch(
		na_values=['END OF FILE'],
		sep='\t',
		error_bad_lines=False,
	)


class EligibilityReader(AbstractEligibilityReader, Reader):
    def __init__(self, paths=None):
        super().__init__(paths=paths)

    def clean(
        self,
        df,
        year,
        start_col="medical_eligibility_start_date",
        end_col="medical_eligibility_end_date",
        id_col="member_id",
        relationship_col="member_relationship",
        fill_missing_end_date=True,
        filter_relationship=None,  # e.g. ['SELF'], ['DAUGHTER', 'SON'], etc.
        monthly_columns=True,
        drop_duplicates=True,
        duplicate_subset=None,  # e.g. ['member_id']
        as_of_col=None,  # e.g. 'medical_eligibility_date_as_of' for worldbank
        expand_prior_months=0,  # e.g. 2 for worldbank
    ):
        d2 = df.copy()
        print(f"Data DataFrame columns: \n {df.info()}", file=sys.stderr)
        if as_of_col:
            # Worldbank-style: use as_of_col for year/month extraction
            d2['year'] = pd.DatetimeIndex(d2[as_of_col]).year
            d2 = d2[d2['year'] == year]
            d2['month'] = pd.DatetimeIndex(d2[as_of_col]).month
            d2.drop(columns=as_of_col, inplace=True)
            frames = [d2]
            for i in range(1, expand_prior_months + 1):
                temp = d2.copy()
                temp['month'] = temp['month'] - i
                frames.append(temp)
            d2 = pd.concat(frames, ignore_index=True)
            if drop_duplicates:
                subset = duplicate_subset or [id_col, 'month']
                d2.drop_duplicates(subset=subset, keep='last', inplace=True)
            return d2

        # Standard monthly eligibility logic
        if fill_missing_end_date:
            d2[end_col] = d2[end_col].fillna(pd.to_datetime("today"))
        accepted_range = pd.date_range(
            start=f'{year}-01-01', periods=12, freq=pd.offsets.MonthBegin(1)
        )
        if monthly_columns:
            month_prefix = 'month_'
            for month in accepted_range:
                d2[f'{month_prefix}{month}'] = (
                    (d2[start_col] <= month) & (month <= d2[end_col])
                )
            cols_month_eligibility = d2.columns[d2.columns.str.startswith(month_prefix)]
            d2_sum = d2.groupby(id_col)[cols_month_eligibility].sum().astype(bool)
            d2_sum['eligible_months'] = d2_sum[cols_month_eligibility].sum(axis=1)
            df_cleaned = d2.drop_duplicates(subset=id_col, keep='last', ignore_index=True)
            df_cleaned = df_cleaned.merge(
                d2_sum[d2_sum.eligible_months > 0].eligible_months,
                how='inner',
                left_on=id_col,
                right_index=True,
            )
            if filter_relationship:
                df_cleaned = df_cleaned[df_cleaned[relationship_col].isin(filter_relationship)]
            return df_cleaned[df_cleaned.columns.difference(cols_month_eligibility)]
        else:
            if drop_duplicates:
                subset = duplicate_subset or [id_col]
                d2 = d2.drop_duplicates(subset=subset, keep='last', ignore_index=True)
            if filter_relationship:
                d2 = d2[d2[relationship_col].isin(filter_relationship)]
            return d2

class MedicalReader(AbstractMedicalReader, Reader):
    def __init__(self, paths=None):
        super().__init__(paths=paths)
        
    def clean(
        self,
        df,
        df_eligibility,
        year,
        claim_id_cols=("number", "sequence"),
        claim_id_from_index=False,
        drop_duplicates=True,
        duplicate_keep=False,
        duplicate_subset=None,  # e.g. ['claim_id']
        year_col="date_service_start",
        year_field_name="year",
        eligibility_id_col="member_id",
        eligibility_ref_col="member_id",
        filter_relationship=None,  # e.g. ['Active Employees']
        relationship_col="member_relationship",
        filter_status=None,  # e.g. ['Paid']
        status_col="status_code",
        pos_code_col="pos_code",
        apply_pos_code=True,
    ):
        d2 = df.copy()
        # Claim ID construction
        if claim_id_from_index:
            d2['claim_id'] = d2.reset_index(drop=True).index.astype(str)
        else:
            d2['claim_id'] = (
                d2[claim_id_cols[0]].astype(str) + '.' + d2[claim_id_cols[1]].astype(str)
            )
        # Duplicate handling
        if drop_duplicates:
            subset = duplicate_subset or ['claim_id']
            d2.drop_duplicates(subset=subset, keep='first' if duplicate_keep else False, inplace=True)
        # Year filtering
        d2[year_field_name] = pd.DatetimeIndex(d2[year_col]).year
        d2 = d2[d2[year_field_name] == year]
        # Eligibility filtering
        d2 = d2[d2[eligibility_id_col].isin(df_eligibility[eligibility_ref_col].unique())]
        # Relationship filtering
        if filter_relationship:
            d2 = d2[d2[relationship_col].isin(filter_relationship)]
        # Status filtering
        if filter_status:
            d2 = d2[d2[status_col].isin(filter_status)]
        # POS code mapping
        if apply_pos_code and pos_code_col in d2.columns:
            d2[pos_code_col] = d2[pos_code_col].apply(get_pos_code)
        d2 = d2.reset_index(drop=True)
        return d2


class PharmacyReader(AbstractPharmacyReader, Reader):
    def __init__(self, paths=None):
        super().__init__(paths=paths)
        
    def clean(
        self,
        df,
        df_eligibility,
        year,
        date_col="date_written",
        year_field_name="year",
        eligibility_id_col="member_id",
        eligibility_ref_col="member_id",
        filter_status=None,  # e.g. ['Paid']
        status_col="status_code",
        reset_index=True,
    ):
        d2 = df.copy()
        d2[year_field_name] = pd.DatetimeIndex(d2[date_col]).year
        d2 = d2[d2[year_field_name] == year]
        d2 = d2[d2[eligibility_id_col].isin(df_eligibility[eligibility_ref_col].unique())]
        if filter_status:
            d2 = d2[d2[status_col].isin(filter_status)]
        if reset_index:
            d2 = d2.reset_index(drop=True)
        return d2


class Cleaner(CommonCleaner):
	reader_classes = Munch(
		eligibility=EligibilityReader,
		medical=MedicalReader,
		pharmacy=PharmacyReader,
	)


# TODO: move to auditor class
def find_inconsistent_rows(df, column):
	employee_id__column_count = df.pivot(
		index='medical_eligibility_date_as_of',
		columns='employee_id',
		values=column,
	).nunique()
	return df[df['employee_id'].isin(employee_id__column_count.index[employee_id__column_count > 1])]


def audit_eligibility(df):
	# make list of members who have multiple birth years
	multiple_birthyears = find_inconsistent_rows(df, 'birth_year')
	# make list of members whose gender has changed
	multiple_genders = find_inconsistent_rows(df, 'gender')
	# add year to each row
	df['year'] = pd.DatetimeIndex(df.medical_eligibility_date_as_of).year
	result = Munch()
	result.clean = df[  # drop members with multiple_birthyears
		~df.employee_id.isin(multiple_birthyears.employee_id)
		& ~df.employee_id.isin(multiple_genders)]
	result.multiple_birthyears = multiple_birthyears
	result.multiple_genders = multiple_genders
	result.by_year = dict([*result.clean.groupby('year')])
	return result


def verify_total_paid_is_zero(medical_claims_repeated):
	'''
	When a medical claim number appears more than once with the same sequence number
	the amounts paid of the claims sharing said claim number cancel out.
	'''
	assert len(
		medical_claims_repeated.groupby('claim_number')['paid_amount'].sum().round(4).reset_index(
			name='sum'
		).query('sum != 0')
	) == 0

	# conditions
	is_active_employee = df.member_relationship == 'Active Employees'
	is_claim_number_and_sequence_repeated = df.claim_number.isin(claim_numbers_repeated)
	is_member_eligible = df.member_id.isin(members_eligible)

	result.clean = df[is_active_employee
																			& ~is_claim_number_and_sequence_repeated
																			& is_member_eligible]
	return result
