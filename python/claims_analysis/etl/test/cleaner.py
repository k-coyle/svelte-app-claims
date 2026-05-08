import pandas as pd
from munch import Munch

from etl.abstract import (
	AbstractEligibilityReader,
	AbstractMedicalReader,
	AbstractPharmacyReader,
)
from etl.common.cleaner import Cleaner as CommonCleaner
from etl.utils import get_pos_code


class EligibilityReader(AbstractEligibilityReader):

	def clean(self, df, year):
		d2 = df.copy()
		accepted_range = pd.date_range(
			start=f'{year}-01-01',  # year start
			periods=12,  # 12 months
			freq=pd.offsets.MonthBegin(1),  # every month start
		)
		# create column per month
		month_prefix = 'month_'
		for month in accepted_range:
			d2[f'{month_prefix}{month}'] = (  # the month is comprised in the eligibility interval
				(d2.medical_eligibility_start_date <= month)  # after
				& (month <= d2.medical_eligibility_end_date)  # before
			)
		cols_month_eligibility = d2.columns[d2.columns.str.startswith(month_prefix)]
		# group by member, sum each month column as bool to avoid double counting
		d2_sum = d2.groupby('member_id')[cols_month_eligibility].sum().astype(bool)
		# count the number of months that have a True value
		d2_sum['eligible_months'] = d2_sum[cols_month_eligibility].sum(axis=1)

		df_cleaned = df.drop_duplicates(subset='member_id', keep='last', ignore_index=True)
		df_cleaned = df_cleaned.merge(
			# keep members who are eligibile for one month or more
			d2_sum[d2_sum.eligible_months > 0].eligible_months,
			how='inner',
			left_on=df_cleaned.member_id.name,
			right_index=True,
		)
		return df_cleaned[df_cleaned.columns.difference(cols_month_eligibility)]


class MedicalReader(AbstractMedicalReader):

	def clean(self, df, df_eligibility, year):
		# add claim_id: concat claim number and sequence
		df['claim_id'] = pd.Series(
			df['number'].astype(str) + '.' + df['sequence'].astype(str),
			dtype='string',
		)

		# drop all claims with duplicate claim_id
		df.drop_duplicates('claim_id', keep=False)

		# Filtering claims by year
		df['year'] = (pd.DatetimeIndex(df.date_service_start)).year
		df = df[df.year == year]

		df = df.reset_index(drop=True)

		# Filtering claims for eligibile individuals.
		df = df[df.member_id.isin(df_eligibility.member_id.unique())]

		df.reset_index(drop=True, inplace=True)

		df.pos_code = df.pos_code.apply(get_pos_code)
		return df


class PharmacyReader(AbstractPharmacyReader):

	def clean(self, df, df_eligibility, year):
		# Filtering claims by year
		df['year'] = (pd.DatetimeIndex(df.date_written)).year
		df = df[df.year == year]

		# Filtering claims for eligibile individuals.
		df = df[df.member_id.isin(df_eligibility.member_id.unique())]
		df.reset_index(drop=True, inplace=True)
		return df


class Cleaner(CommonCleaner):
	reader_classes = Munch(
		eligibility=EligibilityReader,
		medical=MedicalReader,
		pharmacy=PharmacyReader,
	)
