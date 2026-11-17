export const ACTIVE_PAGE_METADATA_IS_UNAVAILABLE_OR_AMBIGUOUS =
    'Active page metadata is unavailable or ambiguous';
export const CANNOT_READ_JSON_FILE_EXPECTED_A_REGULAR_FILE =
    'Cannot read JSON file; expected a regular file containing valid JSON';

export const PACKAGE_VERSION_IS_MISSING = 'Package version is missing';

export const JOURNAL_PERSISTENCE_FAILED =
    'Journal persistence failed; browser actions must not be repeated';

export const INVALID_IMAGE_GEOMETRY = 'Image dimensions or highlight geometry are invalid';
export const INVALID_RASTER_IMAGE = 'Expected a bounded, unrotated, single-frame PNG or JPEG image';

export const SCHEMA_ISSUE_REASONS: Record<string, string> = {
    invalid_type: 'incorrect value type or missing required field',
    invalid_value: 'unsupported value',
    too_big: 'value exceeds the allowed limit',
    too_small: 'value is below the allowed limit',
    invalid_format: 'invalid format',
    not_multiple_of: 'invalid numeric value',
    unrecognized_keys: 'unsupported fields',
    invalid_union: 'choose one supported representation',
    invalid_key: 'invalid field name',
    invalid_element: 'invalid element',
    custom: 'conflicting or invalid settings',
};
