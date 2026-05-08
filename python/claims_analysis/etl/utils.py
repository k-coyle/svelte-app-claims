import warnings
from functools import lru_cache
from pathlib import Path
import ipdb
import pandas as pd
import stringcase
from detect_delimiter import detect
from dateutil.parser import parse as parse_date
from fuzzywuzzy import fuzz
from fuzzywuzzy.process import extractOne as extract_one
from munch import munchify
import csv
import re

uspm_color_palette = {
	'dark_blue':['#334661','51,70,97'],
	'blue':['#005F9B','0,95,155'],
	'light_blue':['#1890FF','24,144,255'],
	'grey':['#A2B2CA','162,178,202'],
	'light_green':['#B4D6C6','108,214,198'],
	'green':['#81C45C','129,196,92'],
	'yellow':['#F3BB3F','243,187,63'],
	'light_orange':['#F37A2C','243,122,44'],
	'orange':['#D55127','231,81,39'],
	'pink':['#F8BECE','248,190,206'],
	'light_brown':['#EE9E50','238,158,80'],
	'brown':['#AD6928','173,105,40'],
	'purple':['#823C96','130,60,150'],
	'darK_purple':['#641747','100,23,71']
}


def fix_faulty_csv(input_file, output_file):
	"""
    Reads a CSV file and rewrites text "," so they are not recognized as delimiters. "," followed
	by " " or r'^[a-z ]' are placed in "".
    Args:
		input_file (str): Path to CSV file to be fixed
		output_file (str): Path to fixed CSV file. 
    Returns:
        
    """
	fixed_rows = []
	with open(input_file, 'r', newline='', encoding='utf-8') as infile:
		lines = infile.readlines()
		
		# Read the header separately and store as-is
		header = lines[0].strip().split(',')
		fixed_rows.append(header) 
		
		# Process the rest of the rows
		for line in lines[1:]:
			# Split by comma but respect the rule: not followed by space or lowercase
			columns = re.split(r',(?![ a-z])', line.strip())
			fixed_row = []
			temp_value = ""

			for value in columns:
				# If the value starts with a space or a lowercase letter, merge it with the previous value
				if re.match(r'^[a-z ]', value) and temp_value:
					temp_value += "," + value  # Merge incorrectly split values
				else:
					if temp_value or temp_value == "":  # Check for both non-empty and empty strings
						fixed_row.append(temp_value)  # Store merged or empty value
					temp_value = value  # Start new value
			
			if temp_value or temp_value == "":  # Append last value
				fixed_row.append(temp_value)

			# **NEW**: Remove first column if it's blank
			if fixed_row and fixed_row[0] == "":
				fixed_row.pop(0)

			# Ensure the row has the same number of columns as the header
			while len(fixed_row) < len(header):
				fixed_row.append("")  # Add empty strings for any trailing empty columns

			fixed_rows.append(fixed_row)

	# Write the corrected CSV file
	with open(output_file, 'w', newline='', encoding='utf-8') as outfile:
		writer = csv.writer(outfile)
		writer.writerows(fixed_rows)

def read_jsonc(file_path):
    """
    Reads a .jsonc file and returns a dictionary after removing comments.
    Args:
        file_path (str): Path to the .jsonc file.
    Returns:
        dict: Parsed JSON content.
    """
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    # Remove single-line comments starting with // and multi-line comments
    content_no_comments = re.sub(r'\/\/.*?$|\/\*.*?\*\/', '', content, flags=re.MULTILINE | re.DOTALL)
    # Parse the cleaned JSON string
    return json.loads(content_no_comments)

def palette_hex(palette = uspm_color_palette):
	return [x[0] for x in palette.values()]

def palette_rbg(palette = uspm_color_palette):
	return [x[1] for x in palette.values()]

def str_rm_numbers(string):
	return ''.join((x for x in string if not x.isdigit()))

def str_capitalization(string):
	return " ".join([ word.capitalize() for word in string.split(" ")])

def graph_title(string):
	return str_capitalization(strip(str_rm_numbers(string.replace('_',' '))))

def writer_excel(df_list, report_name):
	''' Write contents of Munch list to an excel document in 'reports/' '''
	writer = pd.ExcelWriter(f'reports\{report_name}.xlsx', engine='xlsxwriter')
	workbook = writer.book
	worksheet = workbook.add_worksheet('analysis')
	writer.sheets['analysis'] = worksheet
	row = 0
	for dataframe in df_list.keys():
		worksheet.write_string(row, 0, dataframe)
		df_list[dataframe].to_excel(writer, sheet_name='analysis', startrow=row + 1, startcol=0)
		row = row + len(df_list[dataframe].index) + 2
	writer.save()

def normalize_column_names(df, inplace=False):
	''' Transforms column names to snakecase'''
	return df.rename(
		columns=lambda col: stringcase.snakecase(
			col.lower()
		),
		inplace=inplace
	)

# This may cause problems with the csv reader if file header contain mutiple occurances of special charaters ['_',',', ';', ':', '|', '\t']
def determine_seperator(file_path):
	with open(file_path) as myfile:
		firstline = myfile.readline(100)
	return detect(firstline)

@lru_cache
def parse_date_with_cache(date_string):
	''' Transforms string into date format'''
	if not isinstance(date_string, str):
		return None
	return parse_date(date_string).date()

def strip(text):
    try:
        return text.strip()
    except AttributeError:
        return text

@lru_cache
def get_pos_code(pos_name):
	''' Text match standardized POS field to CMS code structure'''
	if pos_name.isdigit():
		return int(pos_name)
	match, score = extract_one(pos_name, pos_names, scorer=fuzz.ratio)
	if score < 65:
		warnings.warn(f'{pos_name} has a low score of {score}.')
	match_condition = code_mappings.pos_codes['Place of Service Name'] == match
	return int(code_mappings.pos_codes[match_condition]['Place of Service Code(s)'])

@lru_cache
def is_trauma_diagnosis(icd_code):
	''' Identifies trauma claim based on ICD code'''
	try:
		icd_code_int = int(icd_code)
	except ValueError:
		x = icd_code[0] in ['S','T']
		return x
	else:
		return 800 <= icd_code_int <= 9999

code_mappings_files = [*Path('etl/code_mappings/').glob('*.csv')]
code_mappings = munchify({
	code_mapping_file.stem: pd.read_csv(code_mapping_file,
		converters = {'icd_code' : strip})
	for code_mapping_file in code_mappings_files
})

pos_codes = code_mappings.pos_codes
normalize_column_names(pos_codes)
pos_names = pos_names = code_mappings.pos_codes['Place of Service Name'].values