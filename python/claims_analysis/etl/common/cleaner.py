import re
from pathlib import Path
import ipdb
import numpy as np
from numpy.lib.function_base import diff
import pandas as pd
from munch import Munch
from datetime import datetime
from pydash import py_

from etl.utils import code_mappings, is_trauma_diagnosis, writer_excel

# Current Procedural Terminology (CPT) codes identifying claims as ER procedures
PROCEDURES_EMERGENCY = ['99281', '99282', '99283', '99284', '99285']

# Place of Service (POS) codes
LOCATIONS = Munch(
	INPATIENT = [
		21,  # 'Inpatient Hospital'
		25,  # 'Birthing Center'
		51,  # 'Inpatient Psychiatric Facility'
		61,  # 'Comprehensive Inpatient Rehabilitation Facility'
	],
	OUTPAITENT = [ 
		22,  # 'Comprehensive Outpatient Rehabilitation Facility'
		62,  # 'Comprehensive Outpatient Rehabilitation Facility'
	],
	EMERGENCY_ROOM = 23, # 'Emergency Room – Hospital'
	OFFICE_VISIT = 11 # 'Office'
)

# roof amount for Stop Loss in Exclusions 
AMOUNT_STOP_LOSS = 10**5  # $100k Stop Loss Amount

# percentages used in determining Disease Risk Acuity Profile
TOP_10_PCT = .1
TOP_50_PCT = .5


class Cleaner():

	reader_classes = None  # configure in subclass
	df_prefix = 'df_'

	def __init__(self, eligibility_paths, medical_claims_paths, pharmacy_claims_paths, year, expanded_codes=False):
		self.client_name = re.sub(r'etl\.(\w+)\..+', r'\1', self.__module__)
		self.year = year
		self.expanded_codes = expanded_codes
		self.paths = Munch()
		self.paths.clean_structure = Path(f'data/{self.client_name}/clean/{self.year}')

		if not self.reader_classes:
			raise Exception('Improperly configured: make sure reader_classes are set.')

		# gathering flat files in call list. 
		self.readers = Munch(
			eligibility=self.reader_classes.eligibility(eligibility_paths),
			medical=self.reader_classes.medical(medical_claims_paths),
			pharmacy=self.reader_classes.pharmacy(pharmacy_claims_paths),
		)

		self.df = Munch()
		self.df.eligibility = Munch()
		self.df.medical = Munch()
		self.df.pharmacy = Munch()

		# reading files in call list
		try:
			self.read()
		except IOError:
			self.read_raw()
		self.post_init()

	def post_init(self):
		# any function with 'df_' prefix is set a callable object for class with _set_dataframe
		for method_name in [m for m in dir(self) if m.startswith(self.df_prefix)]:
			method = getattr(self, method_name)
			if not callable(method):
				continue
			setattr(self, method_name, self._set_dataframe(method))
		self._pos__flags()
		self.df_medical__diagnosis()
		self._eligibility__apply_exclusions()
		self._medical__apply_exclusions()
		self.df_medical__member_comorbidity()
		self._setting_risk_profile()

	def _set_dataframe(self, method):
		"""Sets the return of any attribute starting with the df_prefix as a part of the class"""
		def inner(*args, **kwargs):
			dataframe_name = (method.__name__[len(self.df_prefix):]).replace('__', '.')
			df_attr = method.__self__.df
			df = py_.get(df_attr, dataframe_name)
			if df is not None:
				return df
			df = method(*args, **kwargs)
			py_.set(df_attr, dataframe_name, df)
			return df

		return inner

	def read_raw(self):
		''' Reads in data from flat files using paraent class and creates subclasses'''
		eligibility = self.df.eligibility
		medical = self.df.medical
		pharmacy = self.df.pharmacy
		
		eligibility.raw = self.readers.eligibility.read()
		eligibility.clean = self.readers.eligibility.clean(eligibility.raw, self.year)

		medical.raw = self.readers.medical.read()
		medical.clean = self.readers.medical.clean(medical.raw, eligibility.clean, self.year)

		pharmacy.raw = self.readers.pharmacy.read()
		pharmacy.clean = self.readers.pharmacy.clean(pharmacy.raw, eligibility.clean, self.year)

	def read(self):
		'''Searches for feather files'''
		paths_feather = [*self.paths.clean_structure.glob('*/*.ftr')]
		if not paths_feather:
			raise IOError(f'No feather files found for ({self.client_name}, {self.year}).')
		for path in paths_feather:
			path_relative = path.relative_to(self.paths.clean_structure)
			category = path_relative.parent.name
			df_name = path_relative.stem
			if category not in self.df:
				self.df[category] = Munch()
			self.df[category][df_name] = pd.read_feather(path)

	def write(self):
		'''Write dataframes to disk, to save time. '''
		for category, dfs in self.df.items():
			path = self.paths.clean_structure/category
			# create path if not exists
			path.mkdir(parents=True, exist_ok=True)
			for name, df in py_.omit(dfs, 'raw').items():
				print(f'writing {category} {name}')
				df.reset_index(drop=True).to_feather((path/name).with_suffix('.ftr'))

	def _pos__flags(self):
		'''Adds Emergency Roon, In-Paitient, Office Visit, Out-Paitient flag fields to `self.df.medical.clean`'''
		df = self.df.medical.clean
		df = df.assign(
			is_ip=(df.pos_code.isin(LOCATIONS.INPATIENT)
				& ~df.procedure_code.isin(PROCEDURES_EMERGENCY)),
			is_op=(df.pos_code.isin(LOCATIONS.OUTPAITENT)
				& ~df.procedure_code.isin(PROCEDURES_EMERGENCY)),
			is_ov=((df.pos_code == LOCATIONS.OFFICE_VISIT)
				& ~df.procedure_code.isin(PROCEDURES_EMERGENCY)),
			is_er=((df.pos_code == LOCATIONS.EMERGENCY_ROOM)
				| df.procedure_code.isin(PROCEDURES_EMERGENCY))
		)
		#Edge case: If date_service_end isn't provided then assign missing
		try:
			df['days_spent']=((df.date_service_end - df.date_service_start).dt.days) + 1
		except:
			df['date_service_end'] = np.NaN
			df['days_spent'] = np.NaN
		self.df.medical.clean = df

	def df_medical__diagnosis(self):
		'''Provides wide-to-long format change for ICD codes
		
		Parameters
		----------
		self: class
			requiers clean medical claims data

		Returns
		-------
		df: pandas dataframe
			transformed medical claims into a long format
		'''
		df = self.df.medical.clean
		columns_diagnosis = [*df.columns[df.columns.str.startswith('icd_')]]
		columns_id = [
			'member_id',
			'claim_id',
			'pos_code',
			'procedure_code',
			'date_service_start',
			'date_service_end',
			'days_spent',
			'is_ip',
			'is_er',
			'is_op',
			'is_ov',
		]
		df = df[columns_id + columns_diagnosis]
		df = pd.melt(df, id_vars=columns_id, var_name='column_id', value_name='icd_code')
		df = df.drop(columns=['column_id'])
		df = df.dropna(subset=['icd_code'])
		df = df.drop_duplicates()
		df = df.reset_index(drop=True)
		df.icd_code = df.icd_code.str.replace('.', '')
		df.fillna('', inplace=True)
		return df
	
	def _eligibility__apply_exclusions(self):
		'''Adds flag for member level exclusions in `self.df.eligibility.clean` (ICD, POS, & CPT codes)'''
		df = self.df.medical.diagnosis
		df = df.groupby(df.claim_id.name).head(5).reset_index(drop=True)
		member_excluded_list = df[
			df.icd_code.isin(code_mappings.icd__condition_group_exclusions.icd_code) 
			| df.procedure_code.isin(code_mappings.cpt__procedure_exclusions.cpt_code)
			| df.pos_code.isin(code_mappings.pos__pos_exclusions.pos_code)
		].member_id.unique()
		self.df.eligibility.clean = self.df.eligibility.clean.assign(
			is_member_excluded = self.df.eligibility.clean.member_id.isin(member_excluded_list)
		)
		 
	def _medical__apply_exclusions(self):
		'''Adds flag for claim level exclusions in `self.df.medical.clean` (Trauma)'''
		df = self.df.medical.diagnosis
		#taking first 5 ICD positions 
		df = df.groupby(df.claim_id.name).head(4).reset_index(drop=True)
		df = df.assign(
			is_trauma=((df.is_ip | df.is_er) 
				& df.icd_code.apply(is_trauma_diagnosis))
		)
		df = df.assign(
			is_claim_excluded=(df.is_trauma)
		)
		df_eligibility = self.df.eligibility.clean.copy()
		df = df.merge(
			df_eligibility[['member_id','is_member_excluded']], 
			on='member_id',
			how='left'
		)
		self.df.medical.diagnosis = df
		claims_excluded = df[(df.is_claim_excluded) | (df.is_member_excluded)].claim_id.unique()
		self.df.medical.clean = self.df.medical.clean.assign(
			is_excluded = self.df.medical.clean.claim_id.isin(claims_excluded),
			is_trauma = self.df.medical.clean.claim_id.isin(df[df.is_trauma].claim_id.unique())
		)
	
	def _setting_risk_profile(self):
		'''Set risk profile in `self.df.eligibility.clean`'''
		df = self.df.medical.clean.copy()
		risks = Munch(high='high', moderate='moderate', low='low')
		# High Risk based on claims amount
		top_spenders_non_high_risk = df.groupby(df.member_id).amount_total.sum().reset_index().sort_values(
			'amount_total', 
			ascending=False
		)
		high_risk_spender_count = int(len(top_spenders_non_high_risk)*TOP_10_PCT)
		moderate_risk_spender_count = int(len(top_spenders_non_high_risk)*TOP_50_PCT)
		df.loc[df.member_id.isin(
			top_spenders_non_high_risk.head(high_risk_spender_count).member_id
			),
			'risk_group'
		] = risks.high
		# High Risk based on claim codes
		er_in_months_6_12 = df[
			(df.date_service_start.dt.month >= 6) 
			& (df.is_er)
		].member_id.unique()
		df['has_er_in_last_6_months'] = df.member_id.isin([*er_in_months_6_12])
		ip_in_months_0_12 = df[df.is_ip].member_id.unique()
		df['has_ip_in_last_12_months'] = df.member_id.isin([*ip_in_months_0_12])
		df = df.merge(
			self.df.medical.member_comorbidity[['comorbidity_count']],
			left_on='member_id',
			how='left',
			right_index=True,
		)
		df.loc[
			(df.has_er_in_last_6_months)
			| (df.has_ip_in_last_12_months) 
			| (df.comorbidity_count > 1), 
			'risk_group'
		] = risks.high
		# Moderate Risk based on claims amount
		#yapf: disable
		moderate_spenders = (high_risk_spender_count, 
							 moderate_risk_spender_count)
		df.loc[
			df.risk_group.isna()
			& df.member_id.isin(
				top_spenders_non_high_risk[moderate_spenders[0]:moderate_spenders[1]].member_id
			),
			'risk_group'
		] = risks.moderate
		# yapf: enable
		# Moderate Risk based on claim codes
		df.loc[
			df.risk_group.isna()
			& df.member_id.isin(df[df.is_er].member_id)
			& df.comorbidity_count == 1, 
			'risk_group'
		] = risks.moderate
		# Low Risk based on claim codes
		df.loc[
			df.risk_group.isna()
			& df.comorbidity_count == 1,
			'risk_group'
		] = risks.low
		self.df.eligibility.clean = self.df.eligibility.clean.merge(
			df[['member_id','risk_group']].drop_duplicates(keep='first'),
			on ='member_id',
			how ='left'
		)
		self.df.medical.clean = df.drop(
			columns=[
				'has_er_in_last_6_months',
				'has_ip_in_last_12_months',
				'comorbidity_count',
				]
			)

	def df_apply_stop_loss(self): 
		'''
		Applys Stop Loss filtration to clean medical and pharmacy dataframes.

		Parameters
		----------
		self: class
			requiers clean medical cliams data

		Returns
		-------
		df: pandas dataframe
			member aggreagated medical and pharmacy cost.
		'''
		df_medical = self.df.medical.clean.copy()
		df_medical = df_medical[~df_medical.is_excluded]
		df_eligibility = self.df.eligibility.clean[~self.df.eligibility.clean.is_member_excluded]
		df_medical = df_medical.groupby('member_id')['amount_total'].sum()
		df_medical[df_medical >= AMOUNT_STOP_LOSS] = AMOUNT_STOP_LOSS
		df = df_medical.to_frame().rename(columns={'amount_total':'medical_total'})

		df_pha = self.df.pharmacy.clean[
			self.df.pharmacy.clean.amount_total > 0
		].copy()
		df_pha = df_pha[df_pha.member_id.isin(df_eligibility.member_id)]
		df_pha = df_pha.groupby('member_id')['amount_total'].sum()
		df_pha[df_pha >= AMOUNT_STOP_LOSS] = AMOUNT_STOP_LOSS
		df_pha = df_pha.to_frame().rename(columns={'amount_total':'pharmacy_total'})
		df = df.merge(
			df_pha,
			on = 'member_id',
			how = 'outer'
		)
		return df 

	def df_medical__comorbidity(self): 
		'''For each employee, if they have a chronic condition, set it in the medical claims clean dataframe under 'condition_group' column

		Parameters
		----------
		self: class
			requiers clean medical claims data

		Returns
		-------
		df: pandas dataframe
			self.df.medical.clean with 'condition_group' column 
		'''
		if self.expanded_codes:
			icd__condition_group__rank = code_mappings.icd__condition_group_expanded.merge(
			code_mappings.condition_group_expanded__rank,
			on='condition_group',
			)
		else:
			icd__condition_group__rank = code_mappings.icd__condition_group.merge(
				code_mappings.condition_group__rank,
				on='condition_group',
			)

		# self.df.medical.clean = self.df.medical.clean.merge(df, on='claim_id', how='left')
		df = self.df.medical.diagnosis
		df = df.groupby(df.claim_id.name).head(4).reset_index(drop=True)

		df_comorbidity = df.merge(
			icd__condition_group__rank,
			on='icd_code',
			copy=True,
		)

		df_comorbidity.sort_values('rank', inplace=True)
		df_comorbidity = df_comorbidity.reset_index(drop=True)

		df_main_chronic_condition = df_comorbidity.drop_duplicates(subset=['member_id'])
		df_main_chronic_condition = df_main_chronic_condition.rename(
			columns=dict(condition_group='main_chronic_condition'),
		)
		df_main_chronic_condition = df_main_chronic_condition[['member_id', 'main_chronic_condition']]
		df_main_chronic_condition = df_main_chronic_condition.reset_index(drop=True)

		clean = self.df.medical.clean
		clean = clean.drop(columns=['main_chronic_condition'], errors='ignore')
		self.df.medical.clean = clean.merge( 
			df_main_chronic_condition,
			on='member_id',
			how='left',
		)
		return df_comorbidity

	def df_medical__member_comorbidity(self, apply_exclusions=False):
		'''
		For each member that has a chronic condition determins if they have comorbidities, 
		and member aggreagate costs for pharmacy and medical claims.

		Creates a comorbidity dataframe and sets it in `self.df_medical__member_comorbidity()`

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		cm = self.df_medical__comorbidity()
		df = cm[[cm.member_id.name, cm.condition_group.name]].copy()
		df = df.drop_duplicates(df.member_id.name).set_index(df.member_id.name)
		cm_by_member = cm.groupby(cm.member_id.name)
		df['comorbidity_count'] = cm_by_member.condition_group.nunique()
		df['is_single_condition'] = df.comorbidity_count == 1

		if apply_exclusions:
			member_cost_w_stop_loss = self.df_apply_stop_loss()
			df['cost_medical'] = member_cost_w_stop_loss.medical_total.sum()
			df_pharmacy = member_cost_w_stop_loss.pharmacy_total.rename(column={'pharmacy_total':'cost_rx'})
		else:
			df_pharmacy = self.df.pharmacy.clean
			df_medical = self.df.medical.clean
			df_medical = df_medical[[
				df_medical.member_id.name, df_medical.amount_total.name
				]].groupby(df_medical.member_id.name).amount_total.sum().rename('cost_medical')
			df = df.merge( 
				df_medical,
				how='left',
				right_index=True,
				left_index=True
			).fillna(0)
			df_pharmacy = df_pharmacy.groupby('member_id').amount_total.sum().rename('cost_rx')

		df = df.merge( 
				df_pharmacy,
				how='left',
				right_index=True,
				left_index=True
			).fillna(0)
		df['cost_total'] = df.cost_medical + df.cost_rx

		return df

	def get_cost_per_comorbidity_count(self, apply_exclusions=False):
		'''
		Groups by number of comorbidities, and aggreagate costs for pharmacy 
		and medical claims.

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		member_comorbidity = self.df_medical__member_comorbidity(apply_exclusions)
		by_comorbidity_count = member_comorbidity.groupby(member_comorbidity.comorbidity_count)
		df = pd.DataFrame()
		df['claimant_count'] = by_comorbidity_count.condition_group.count()
		df['cost_medical'] = by_comorbidity_count.cost_medical.sum()
		df['cost_rx'] = by_comorbidity_count.cost_rx.sum()
		df['cost_total'] = df.cost_medical + df.cost_rx
		df['pppy'] = (df.cost_total/df.claimant_count).round(decimals=2)
		if self.expanded_codes:
			cc_rank = code_mappings.condition_group_expanded__rank['rank'].to_list()
		else:
			cc_rank = code_mappings.condition_group__rank['rank'].to_list()
		df = df.merge(
			pd.DataFrame(index=cc_rank),
			left_index=True,
			right_index=True,
			how='outer'
		)
		return df

	def get_costs_grouped_by(self, grouped_by, apply_exclusions=False):
		'''
		Groups medical and pharmacy cost by columns in `self.df_medical__member_comorbidity()`

		Keyword arguments:
		grouped_by -- columns name in `self.df_medical__member_comorbidity()`
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		cm = self.df_medical__member_comorbidity(apply_exclusions)
		grouped_by_cols = [g if isinstance(g, str) else g.name for g in grouped_by]
		grouped = cm.groupby(grouped_by_cols)
		df = grouped.agg(
			claimant_count=pd.NamedAgg(column=cm.is_single_condition.name, aggfunc='count'),
			cost_medical_total=pd.NamedAgg(column=cm.cost_medical.name, aggfunc=np.sum),
			cost_medical_mean=pd.NamedAgg(column=cm.cost_medical.name, aggfunc=np.mean),
			cost_rx_total=pd.NamedAgg(column=cm.cost_rx.name, aggfunc=np.sum),
			cost_rx_mean=pd.NamedAgg(column=cm.cost_rx.name, aggfunc=np.mean),
			cost_total=pd.NamedAgg(column=cm.cost_total.name, aggfunc=np.sum),
			cost_total_mean=pd.NamedAgg(column=cm.cost_total.name, aggfunc=np.mean),
		)
		if self.expanded_codes:
			df.reindex(code_mappings.condition_group_expanded__rank.condition_group)
		else:
			df.reindex(code_mappings.condition_group__rank.condition_group)

		return df

	def get_cc_summary_enhanced(self, apply_exclusions=False):
		'''
		See self.get_cc_summary()
		Includes condition counts for member list 

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		cc = self.get_cc_summary(apply_exclusions, add_pct=True)
		comorbidity_by_member = self.df_medical__member_comorbidity(apply_exclusions)
		# yapf: disable
		cc['count_single_condition'] = (
			comorbidity_by_member.groupby(comorbidity_by_member.condition_group.name)
			.is_single_condition.sum().astype('Int16')
		)
		# yapf: enable
		cc['count_multiple_conditions'] = cc.claimant_count - cc.count_single_condition
		return cc

	def get_summary(self, apply_exclusions=False):
		'''
		Groups by condition, with member list & claimant_count

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		client_name = self.client_name
		analysis_year = self.year
		dfs = self.df.medical.clean
		if apply_exclusions:
			dfs = dfs[~dfs.is_excluded]
			medical_total = self.df_apply_stop_loss().medical_total.sum().round(decimals=2)
			pharmacy_total = self.df_apply_stop_loss().pharmacy_total.sum().round(decimals=2)
			fte = self.df.eligibility.clean[
				~self.df.eligibility.clean.is_member_excluded
			].eligible_months.sum()/12
		else:
			medical_total = dfs.amount_total.sum().round(decimals=2)
			# yapf: disable
			pharmacy_total = self.df.pharmacy.clean[
				(self.df.pharmacy.clean.amount_total > 0)
			].amount_total.sum().round(decimals=2)
			fte = self.df.eligibility.clean.eligible_months.sum()/12
		# yapf: enable
		medical_total_pppy = medical_total/fte
		pharmacy_total_pppy = pharmacy_total/fte
		return py_.omit(locals(), ['self', 'dfs'])

	def get_cc_summary(self, apply_exclusions=False, add_pct=False):
		'''
		Groups by condition, with member list & claimant_count

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		add_pcts -- place percentages of claimant_count
		'''
		m = self.df.medical.clean
		if apply_exclusions:
			m = m[~m.is_excluded]
		cc_summary = pd.DataFrame()  # chronic condition summary
		cc_summary['member_set'] = m.groupby(m.main_chronic_condition).member_id.unique()
		if add_pct:
			#yapf: disable
			if cc_summary.member_set.values.shape[0] > 1:
				cc_summary.loc['chronics', 'member_set'] = np.concatenate(cc_summary.member_set.values)
			elif cc_summary.member_set.values.shape[0] == 1:
				cc_summary.loc['chronics', 'member_set'] = cc_summary.member_set.values
			else:
				cc_summary.loc['chronics', 'member_set'] = np.nan
			cc_summary.loc['non chronics','member_set'] = m[pd.isnull(m.main_chronic_condition)
				].member_id.unique()
			#yapf: enable
			cc_summary.loc['all', 'member_set'] = np.concatenate(
				cc_summary.loc[['chronics', 'non chronics']].member_set.values
			)
		cc_summary['claimant_count'] = cc_summary.member_set.apply(len).astype('Int16')
		if add_pct:
			claimant_count_total = cc_summary.loc['all', 'claimant_count']
			cc_summary['pct'] = (cc_summary.claimant_count/claimant_count_total)*100
		
		if self.expanded_codes:
			cc_summary = cc_summary.reindex(code_mappings.condition_group_expanded__rank.condition_group)
		else:
			cc_summary = cc_summary.reindex(code_mappings.condition_group__rank.condition_group)
		cc_summary['member_set'] = [ [] if x is np.NaN else x for x in cc_summary['member_set'] ]
		return cc_summary

	def get_medical__cc_matrix(self, apply_exclusions=True):
		'''
		Creates the Condition Hierarchy Matrix

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		cc_summary = self.get_cc_summary(apply_exclusions)
		comorbidity = self.df_medical__comorbidity()
		
		if self.expanded_codes:
			chronic_conditions = code_mappings.condition_group_expanded__rank.condition_group.values
		else:
			chronic_conditions = code_mappings.condition_group__rank.condition_group.values
		cc_hier_matrix = pd.DataFrame(
			columns=chronic_conditions,
			index=chronic_conditions,
		)
		cm = comorbidity.copy()
		for r_index, r in enumerate(chronic_conditions):
			cm_r = cm[cm.member_id.isin(cc_summary.member_set[r])]
			for c in chronic_conditions[r_index:]:
				cc_hier_matrix.loc[r, c] = cm_r[cm_r.condition_group == c].member_id.nunique()
				cm = cm[~cm.member_id.isin(cm_r.member_id)]
		cc_hier_matrix.loc['total'] = cc_hier_matrix.sum().astype('Int32')
		return cc_hier_matrix

	def get_cc__prevalence(self, apply_exclusions=True):
		'''
		Creates dataframe with prevalence rates

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		cc_summary = self.get_cc_summary(apply_exclusions)
		cm = self.df_medical__comorbidity().copy()
		
		if self.expanded_codes:
			chronic_conditions = code_mappings.condition_group_expanded__rank.condition_group.values
		else:
			chronic_conditions = code_mappings.condition_group__rank.condition_group.values
		cc_hier_matrix = pd.DataFrame(
			columns=chronic_conditions,
			index=chronic_conditions
		)
		for r_index, r in enumerate(chronic_conditions):
			cm_r = cm[cm.member_id.isin(cc_summary.member_set[r])]
			for c in chronic_conditions[r_index:]:
				cc_hier_matrix.loc[r, c] = cm_r[cm_r.condition_group == c].member_id.unique()
				cm = cm[~cm.member_id.isin(cm_r.member_id)]
		
		cc_prevalnce = pd.DataFrame(
			columns=[
				'member_set',
				'member_count',
				],
			index=chronic_conditions
		)
		cc_hier_matrix
		for cc in chronic_conditions:
			cc_column = cc_hier_matrix[cc].replace([],np.nan) #Inclueded to deal with empty list
			cc_members = cc_column.apply(pd.Series).stack().reset_index(drop=True).to_list()
			cc_prevalnce.loc[cc,'member_set']= cc_members
			cc_prevalnce.loc[cc,'member_count'] = len(cc_members)
		return cc_prevalnce
	
	def get_primary_icd_cost(self, apply_exclusions=True):
		'''
		Creates dataframe aggreagating the cost of claims with condition in the 1st ICD code position

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		if self.expanded_codes:
			icd__condition_group = code_mappings.icd__condition_group_expanded
			cc_rank = code_mappings.condition_group_expanded__rank
		else:
			icd__condition_group = code_mappings.icd__condition_group
			cc_rank = code_mappings.condition_group__rank
		med_df = self.df.medical.clean #
		if apply_exclusions:
			med_df = med_df[~med_df.is_excluded]
		df = self.df.medical.diagnosis
		df = df.groupby(df.claim_id.name).head(1).reset_index(drop=True)

		df_comorbidity = df[['claim_id','icd_code']].merge(
			icd__condition_group,
			how='left',
			on='icd_code',
			copy=True,
		)
		cc_table = pd.DataFrame(
			columns=[
				'member_count',
				'claim_count',
				'cost_medical',
				],
			index=cc_rank.condition_group
		)
		for cc in cc_table.index:
			claim_ids = df_comorbidity[df_comorbidity.condition_group == cc].claim_id.to_list()
			claim_set = med_df[med_df.claim_id.isin(claim_ids)]
			cc_table.loc[cc,'member_count'] = claim_set.member_id.nunique()
			cc_table.loc[cc,'claim_count'] = claim_set.claim_id.nunique()
			cc_table.loc[cc,'cost_medical'] = claim_set.amount_total.sum()
		return cc_table

	# need to move this to sperate file (i.e. Utlilities)
	def _get_total_cost(self, cc_summary, df_claims):
		'''Arregates claims cost by condition'''
		cc = cc_summary
		return cc.apply(
			lambda r: df_claims[df_claims.member_id.isin(cc.loc[r.name].member_set)].
			drop_duplicates(df_claims.claim_id.name).amount_total.sum(),
			axis=1
		)

	def get_cc_costs(self, apply_exclusions=False): #need to apply stop loss 
		'''
		Arregates medical and pharmacy costs by chronic condition.

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		def total_paid(df):
			return ccuh.apply(
				lambda row: df[df.member_id.isin(cc_summary.member_set[row.name])].amount_total.sum(),
				axis=1,
			)
		cc_summary = self.get_cc_summary(apply_exclusions, add_pct=True)
		ccuh = cc_summary[[cc_summary.claimant_count.name, cc_summary.pct.name]]
		if apply_exclusions:
			m = self.df_apply_stop_loss().reset_index(drop=False)
			ccuh = ccuh.assign(
				cost_medical=total_paid(m.rename(
					columns={'medical_total':'amount_total'})
					),
				cost_rx=total_paid(m.rename(
					columns={'pharmacy_total':'amount_total'})
					),
			)
		else:
			m = self.df.medical.clean
			rx = self.df.pharmacy.clean[self.df.pharmacy.clean.member_id.isin(m.member_id)]
			ccuh = ccuh.assign(
				cost_medical=total_paid(m),
				cost_rx=total_paid(rx),
			)
		ccuh['total'] = ccuh.cost_rx + ccuh.cost_medical
		ccuh['pppy'] = (ccuh.total/ccuh.claimant_count).round(decimals=2)
		return ccuh

	def get_cc_costs_ip_er(self, apply_exclusions=True):
		'''
		Arregates inpatient and emergency room costs by chronic condition.
		
		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		'''
		df = self.df.medical.clean
		if apply_exclusions:
			df = df[~(df.is_excluded)]
		cc = self.get_cc_summary(apply_exclusions)
		claims_er = df[df.is_er]
		claims_ip = df[df.is_ip]
		cc['cost_ip'] = self._get_total_cost(cc, claims_ip)
		cc['cost_er'] = self._get_total_cost(cc, claims_er)
		cc['cost_ip_er'] = cc.cost_ip + cc.cost_er
		cc.loc['total'] = cc.sum(numeric_only=True)
		return cc.drop(columns=cc.member_set.name)

	def get_ccuh_ip_er_visits(self, apply_exclusions=True, scale_to=1000):
		'''
		Counts inpatient & emergency room visits, and days spent group by condition. 
		Both have scaled and raw values. 

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default False)
		scale_to -- Scaling factor (default 1000)
		'''
		# df_diagnosis = self.df_medical__diagnosis(apply_exclusions).copy()
		df = self.df.medical.clean.copy()
		cc = self.get_cc_summary(apply_exclusions)
		cc = cc[[cc.claimant_count.name]]
		#Trying to figure out why I am doing this merge???
		# df = df_medical.merge(
		# 	df_diagnosis[[
		# 		df_diagnosis.claim_id.name, df_diagnosis.is_ip.name, df_diagnosis.is_er.name,
		# 		df_diagnosis.days_spent.name
		# 	]],
		# 	how='left',
		# 	on = df_diagnosis.claim_id.name
		# )
		if apply_exclusions:
			df = df[~df.is_excluded]
		# yapf: disable
		cc['ip_visit_count'] = (
			df[df.is_ip].drop_duplicates(subset=[df.member_id.name, df.date_service_start.name])
			.groupby(df.main_chronic_condition).claim_id.count()
		)
		cc['er_visit_count'] = (
			df[df.is_er].drop_duplicates(subset=[df.member_id.name, df.date_service_start.name])
			.groupby(df.main_chronic_condition).claim_id.count()
		)
		cc['ip_visit_days_spent'] = (
			df[df.is_ip].drop_duplicates(subset=[df.member_id.name, df.date_service_start.name])
			.groupby(df.main_chronic_condition).days_spent.sum()
		)

		if scale_to:
			cc['ip_visit_count_scaled'] = (cc.ip_visit_count/cc.claimant_count*scale_to).round(decimals=2)
			cc['er_visit_count_scaled'] = (cc.er_visit_count/cc.claimant_count*scale_to).round(decimals=2)
			cc['ip_visit_days_spent_scaled'] = ((cc.ip_visit_days_spent/cc.claimant_count*scale_to)
				.round(decimals=2)
			)
		# yapf: enable
		return cc

	def get_disease_risk_acuity_profile(self, cc_filter=True, cc_subgrouping=False, apply_exclusions=True): 
		'''
		Counts number of members in each disease risk acuity group

		Keyword arguments:
		cc_filter -- filters base table to only members with chronic condition
		cc_subgrounping -- breaks table out into condition grouping
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		if self.expanded_codes:
			cc_codes = code_mappings.condition_group_expanded__rank
		else:
			cc_codes = code_mappings.condition_group__rank
		if apply_exclusions:
			df = self.df.eligibility.clean[~self.df.eligibility.clean.is_member_excluded]
		else:
			df = self.df.eligibility.clean
		if cc_filter:
			sub_pop = self.df_medical__comorbidity()[['member_id','condition_group']].drop_duplicates(subset=['member_id'])
			df = df[df.member_id.isin(sub_pop.member_id)]
		if cc_subgrouping:
			df = df.merge(
				self.df_medical__member_comorbidity()[['condition_group']],
				left_on = df.member_id.name,
				right_index=True,
				how='left'
			)
			totals = pd.DataFrame(
				df.groupby(['condition_group','risk_group'], as_index=False).member_id.nunique()
				).rename(columns={'member_id': 'counts'})
			full_set = pd.DataFrame({
				'condition_group':cc_codes.condition_group, 
				'risk_group':[['low','moderate','high']]*9}
			).explode('risk_group')
			totals = full_set.merge(
				totals,
				on=['condition_group','risk_group'],
				how='outer'
			)
			totals.loc['sum'] = totals.counts.sum()
			totals['percent'] = totals.counts.div(totals.groupby('condition_group')['counts'].transform('sum'))
		else:
			totals = pd.DataFrame(
				df.groupby('risk_group').member_id.nunique()
				).rename(columns={'member_id': 'counts'})
			totals.loc['sum'] = totals.counts.sum()
			totals['percent'] = totals/totals.loc['sum']
		return totals.fillna(0)
	
	def get_mh6_breakout(self, apply_exclusions=True):
		'''
		Prevalence counts of members with each MH6 subgrounping grouped by condition

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		chronic_conditions = code_mappings.icd__condition_group_expanded
		cc_mh6 = chronic_conditions[chronic_conditions.condition_group.isin([
			'Depression',
			'Anxiety',
			'Affective Psychosis',
			'Eating Disorders',
			'PTSD',
			'Substance Abuse',
			])
		]
		cm = self.df_medical__comorbidity()
		df = self.df_medical__diagnosis().copy()
		if apply_exclusions:
			cm = cm[~(cm.is_claim_excluded | cm.is_member_excluded)]
			df = df[~(df.is_claim_excluded | df.is_member_excluded)]
		cm = cm[[
			cm.member_id.name, 
			cm.condition_group.name
			]].drop_duplicates(keep='first')
		member_set = cm[cm.condition_group=='MH6'].member_id
		df = df[df.member_id.isin(member_set)]
		df = df[['member_id','icd_code']].merge(
			cc_mh6[['icd_code','condition_group']].rename(
				columns={'condition_group':'mh6_condition'}),
			on='icd_code',
			how='left',
		).dropna().drop_duplicates(subset=['member_id','mh6_condition'])
		#gets all instance of member condition that have been diagnosied with MH6 (can be more than 1)
		mh6_members = cm[cm.member_id.isin(member_set)]
		#creates a table of members with columns for CC and MH6 break out diagnoses 
		mh6_members = df[['member_id','mh6_condition']].merge(
				mh6_members,
				on='member_id',
				how='left',
			).drop_duplicates(keep='first')
		#Creats a crosstab table where each intersetion of the CC and MH6 break out diagnoses is counted 
		table_crosstab = pd.crosstab(
			index=mh6_members.condition_group,
			columns=mh6_members.mh6_condition,
			rownames=['Chronic Condition'],
			colnames=['Mental Health Condition'],
			).reindex(code_mappings.condition_group__rank.condition_group)
		table_crosstab['totals'] = table_crosstab.sum(axis =1)
		return table_crosstab

	def get_mh6_breakout_cost(self, apply_exclusions=True):
		'''
		Aggregates medical cost of MH6 Subgroupings 

		Keyword arguments:
		apply_exclusions -- Applies exclusions & stop loss (default True)
		'''
		med_df = self.df.medical.clean
		chronic_conditions = code_mappings.icd__condition_group_expanded
		cc_mh6 = chronic_conditions[chronic_conditions.condition_group.isin([
			'Depression',
			'Anxiety',
			'Affective Psychosis',
			'Eating Disorders',
			'PTSD',
			'Substance Abuse',
			])
		]
		#Provides Long format ICD codes for new MH6 Breakouts
		df = self.df_medical__diagnosis().copy()
		if apply_exclusions:
			df = df[~(df.is_claim_excluded | df.is_member_excluded)]
		df = df[['claim_id','member_id','icd_code']].merge(
			cc_mh6[['icd_code','condition_group']].rename(
				columns={'condition_group':'mh6_condition'}),
			on='icd_code',
			how='left',
		).dropna().drop_duplicates(subset=['claim_id','member_id','mh6_condition'])
		table_mh6 = pd.DataFrame(
			index = cc_mh6.condition_group.unique(),
			columns= ['cost_med']
		)
		for cc in table_mh6.index:
			claim_ids = df[df.mh6_condition==cc].claim_id
			claim_set = med_df[med_df.claim_id.isin(claim_ids)]
			table_mh6.loc[cc]= claim_set.amount_total.sum()
		return table_mh6

	# need to move this to sperate file (i.e. Utlilities)
	# needs to write directly into template
	def write_excel_report(self):
		''' Writes an excel document to 'reports\' for formating'''
		report_name = (f'{self.year}_{self.client_name}_') + str(datetime.now()).replace(' ', '_').replace(':', '_')	
		tables = Munch()
		# 5.1 OA HealthcareSpend Summary
		tables.get_summary = pd.Series(self.get_summary())
		tables.get_summary_w_exlusions = pd.Series(self.get_summary(apply_exclusions=True))
		# 5.2 OA Claims Util Hier
		tables.get_cc_costs = self.get_cc_costs()
		tables.get_cc_costs_exclusions = self.get_cc_costs(apply_exclusions=True)
		tables.get_cc_costs_ip_er_w_exclusions = self.get_cc_costs_ip_er(apply_exclusions=True)
		tables.get_ccuh_ip_er_visits_w_exclusions = self.get_ccuh_ip_er_visits(apply_exclusions=True)
		# 5.3 OA Member CondHier Matrix
		tables.get_medical__cc_matrix = self.get_medical__cc_matrix()
		# 5.? OA CC Prevelance Rate
		tables.get_cc__prevalence = self.get_cc__prevalence()
		# OA CC Cost in Primary ICD Slot
		tables.get_primary_icd_cost = self.get_primary_icd_cost()
		#5.? MH6 Breakout 
		tables.get_mh6_breakout = self.get_mh6_breakout()
		tables.get_mh6_breakout_cost = self.get_mh6_breakout_cost()
		# 5.4 OA Hier Cost Rpt
		tables.get_cost_per_comorbidity_count = self.get_cost_per_comorbidity_count()
		# 5.5 OA CoMobid Cost Rpt
		tables.get_cc_summary_enhanced = self.get_cc_summary_enhanced()
		tables.get_disease_risk_acuity_profile_no_filters = self.get_disease_risk_acuity_profile(cc_filter=False, cc_subgrouping=False, apply_exclusions=False)
		tables.get_disease_risk_acuity_profile_CC_subpop = self.get_disease_risk_acuity_profile(cc_filter=True,  cc_subgrouping=False, apply_exclusions=False)
		tables.get_disease_risk_acuity_profile_exclusions_applied = self.get_disease_risk_acuity_profile(cc_filter=True,  cc_subgrouping=False, apply_exclusions=True)
		tables.get_disease_risk_acuity_profile_CC_subgrouping = self.get_disease_risk_acuity_profile(cc_filter=True,  cc_subgrouping=True,  apply_exclusions=True)
		# excel output
		writer_excel(tables, report_name)
		return