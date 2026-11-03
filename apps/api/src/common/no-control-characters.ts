import { ValidateBy, type ValidationOptions } from 'class-validator';
import { CONTROL_CHARACTERS } from '@sirat/shared';

/**
 * Refuses C0 control characters and DEL (tab and line feed stay), with the one pattern @sirat/shared exports for the
 * CSV import too. Postgres refuses U+0000 in text and jsonb, so without this a NUL would end as a 500, not a 400.
 * Strings only; other types are left to the field's own validators. On a string array, each element is checked.
 */
export function NoControlCharacters(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'noControlCharacters',
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !CONTROL_CHARACTERS.test(value),
        defaultMessage: () => '$property must not contain control characters',
      },
    },
    options,
  );
}
