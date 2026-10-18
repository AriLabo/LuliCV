import { expect, it } from 'vitest';
import schema from '../../schema/resume-data.schema.json' with { type: 'json' };
import { DETAIL_FIELDS, DETAIL_MAX_LENGTH } from './details';
import { LINK_LIMITS } from './limits';
import { LINK_ICON_OPTIONS, LINK_SHOW_OPTIONS } from './links';
import { PRIVATE_TOKEN } from './privacy';

// The schema is what validation checks and what agents read; the editor builds its fields from these constants.
it('states the same limits and choices as the editor', () => {
  const { basics, link, contactUrl, detailText } = schema.$defs;
  expect(basics.properties.links.maxItems).toBe(LINK_LIMITS.count);
  expect(link.properties.label.maxLength).toBe(LINK_LIMITS.label);
  expect(contactUrl.anyOf[0].maxLength).toBe(LINK_LIMITS.url);
  expect(detailText.anyOf[0].maxLength).toBe(DETAIL_MAX_LENGTH);
  expect(link.properties.show.enum).toEqual(LINK_SHOW_OPTIONS.map((option) => option.id));
  expect(link.properties.icon.enum).toEqual(LINK_ICON_OPTIONS.map((option) => option.id));
  const details = Object.entries(basics.properties)
    .filter(([, property]) => '$ref' in property && property.$ref === '#/$defs/detailText')
    .map(([key]) => key);
  expect(details).toEqual(DETAIL_FIELDS.map((field) => field.id));
  expect(contactUrl.anyOf[1].pattern).toBe(PRIVATE_TOKEN.source);
  expect(detailText.anyOf[1].pattern).toBe(PRIVATE_TOKEN.source);
});
