import sys
from collections import ChainMap
from pathlib import Path
import ipdb
import csv
import pandas as pd
from munch import Munch
import numpy as np
import inspect
import re

from etl.utils import normalize_column_names, parse_date_with_cache, determine_seperator

filler_values = [99999999]

class AbstractReader:
	file_type = None
	parser_config = {}

	def __init__(self, paths, config_dir=None):
		self.paths = paths
        # Automatically determine config directory based on caller
		caller_frame = inspect.stack()[1]
		caller_file = Path(caller_frame.filename)
		config_dir = caller_file.parent / 'config'
		config_path = config_dir / f'{self.file_type}.csv'
		if not config_path.exists():
			raise FileNotFoundError(
                f"Config file not found: {config_path}"
            )
		config = pd.read_csv(config_path)
		self.config_csv = config
		extra_config = Munch()
		self.column_mapping = dict(config[['column', 'column_uspm']].dropna().values)
		extra_config.dtype = dict(config.dropna(subset=['dtype'])[['column', 'dtype']].values)
		extra_config.usecols = config[(~pd.isnull(config.dtype) | config.parse_date)].column.values
		extra_config.parse_dates = [*config[config.parse_date].column.values]
		extra_config.date_parser = parse_date_with_cache
		self.extra_config = extra_config
	'''No names in data is causing problems, need to be able to use position when needed.
		May try to use and expect statement. 

		Also need to think about what to do if there are no files in the Pharmacy
	'''
	def read(self, data=None, normalize=True, remap=True, id_col='member_id'):
		logs = []
		print("=== Entering absract.read() ===", file=sys.stderr)
		print(f"self.paths: {self.paths}", file=sys.stderr)
		print(f"self.column_mapping exists: {'column_mapping' in self.__dict__}", file=sys.stderr)
		print(f"data type: {type(data)}", file=sys.stderr)
		if data is not None:
			# Accepts either a DataFrame or a list of dicts (from NDJSON)
			if isinstance(data, pd.DataFrame):
				df = data.copy()
			else:
				df = pd.DataFrame(data)
			print(f"DataFrame shape after creation: {df.shape}", file=sys.stderr)
			print(f"DataFrame columns: {df.columns.tolist()}", file=sys.stderr)
		else:
			df = pd.concat([
				self.csv_reader(file_path) for file_path in self.paths
			])
		if remap:
			df = df.rename(columns=self.column_mapping)
		if normalize:
			df = normalize_column_names(df)
		# --- String cleaning ---
		str_cols = df.select_dtypes(include='object').columns
		for col in str_cols:
			before = df[col].copy()
			df[col] = df[col].str.strip().str.lower()
			df[col] = df[col].str.replace(r"[\"';]", "", regex=True)  # Remove SQL-problematic chars
			changed = (before != df[col]).sum()
			if changed > 0:
				logs.append(f"Transformed {changed} values in column '{col}' (lowercase, strip, remove special chars).")

		# --- Date standardization ---
		for col in self.extra_config.parse_dates:
			if col in df.columns:
				before = df[col].copy()
				df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%dT%H:%M:%S')
				changed = (before != df[col]).sum()
				logs.append(f"Standardized {changed} values in date column '{col}' to ISO 8601.")

		# --- Other dtype casting ---
		for col, dtype in self.extra_config.dtype.items():
			if col in df.columns and col not in self.extra_config.parse_dates and dtype:
				if not str(df[col].dtype) == dtype:
					try:
						before = df[col].copy()
						df[col] = df[col].astype(dtype, errors='ignore')
						changed = (before != df[col]).sum()
						logs.append(f"Casted {changed} values in column '{col}' to dtype '{dtype}'.")
					except Exception:
						logs.append(f"Failed to cast column '{col}' to dtype '{dtype}'.")

		# --- Validate ID column ---
		if id_col in df.columns:
			missing_ids = df[id_col].isnull().sum()
			unique_ids = df[id_col].nunique()
			total_rows = len(df)
			logs.append(f"ID column '{id_col}': {missing_ids} missing, {unique_ids} unique out of {total_rows} rows.")
			df = df[df[id_col].notnull()]
			if unique_ids < total_rows:
				logs.append(f"Warning: ID column '{id_col}' is not unique for all rows.")
		else:
			logs.append(f"Warning: ID column '{id_col}' not found in DataFrame.")

		# --- Final cleanups ---
		df = df.replace(r'^\s*$', np.nan, regex=True)
		df.replace('', np.nan, inplace=True)
		df.dropna(thresh=2, inplace=True)
		df.drop_duplicates(inplace=True, keep='first')
		logs.append("Removed empty strings, whitespace, dropped NA and duplicates.")

		# --- Log all transformations ---
		for log in logs:
			print(f"[CLEAN LOG] {log}", file=sys.stderr)

		return df, logs
	
	def csv_reader(self, file_path):
		with open(file_path) as csvfile:
			has_header = csv.Sniffer().has_header(csvfile.read(3000)) #3000 works best so far
		#WBG Data isn't loading properly: find out why 
		if has_header:
			df = pd.read_csv(
					file_path,
					sep=determine_seperator(file_path),
					na_values=filler_values, #Common filler values added here in list
					**ChainMap(self.extra_config, self.parser_config),
				 )
		else:
			df = pd.read_csv(
					file_path,
					names=self.config_csv.column.to_list(),
					sep=determine_seperator(file_path),
					na_values=filler_values, #Common filler values added here in list
					**ChainMap(self.extra_config, self.parser_config),
				 )
		#removing whitespace in str columns.
		cols_str = (df.applymap(type) == str).all(0)
		cols = cols_str[cols_str == True].index
		df[cols] = df[cols].apply(lambda x: x.str.strip())
		df = df.replace(r'^\s*$', np.nan, regex=True)
		df.replace('', np.nan, inplace=True)
		return df


	def clean(self, df):
		pass


class AbstractEligibilityReader(AbstractReader):
	file_type = 'eligibility'


class AbstractMedicalReader(AbstractReader):
	file_type = 'medical'


class AbstractPharmacyReader(AbstractReader):
	file_type = 'pharmacy'
