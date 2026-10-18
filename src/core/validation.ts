import type { ResumeData, ResumeRecord, ResumeWorkspace } from './types';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import schema from '../../schema/resume-data.schema.json' with { type: 'json' };
import { DETAIL_FIELDS } from './details';

/*
 * The schema is the one statement of what ResumeData may hold; this file only turns Ajv's findings into Chinese
 * paths and messages, and adds what a schema cannot say: ids that must be unique across the document.
 */

type Defs = Record<string, { type?: string; $ref?: string; pattern?: string }>;
const defs = schema.$defs as unknown as Defs;
const sectionTypes = schema.properties.sections.items.oneOf.map(({ $ref }) =>
  $ref.replace('#/$defs/', '').replace(/Section$/, ''),
);
// Typed as plain checks: Ajv's own type would narrow a failed value to never.
type Validator = { (data: unknown): boolean; errors?: ErrorObject[] | null };
// Compiled on first use so commands that never validate locally don't pay for it at startup.
let compiled: { root: Validator; sections: Map<string, Validator> } | undefined;
const validators = () => {
  if (compiled) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
  ajv.addSchema(schema);
  const section = (type: string) => ajv.getSchema(`${schema.$id}#/$defs/${type}Section`)!;
  compiled = { root: ajv.getSchema(schema.$id)!, sections: new Map(sectionTypes.map((type) => [type, section(type)])) };
  return compiled;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const typeNames: Record<string, string> = {
  string: '字符串',
  boolean: '布尔值',
  array: '数组',
  object: '对象',
  number: '数字',
  integer: '整数',
};
const typeOf = (property: { type?: string; $ref?: string } | undefined): string | undefined =>
  property?.$ref ? typeOf(defs[property.$ref.replace('#/$defs/', '')]) : property?.type;

// /sections/0/entries/1 → sections[0].entries[1]
const readable = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : path ? `${path}.${part}` : part), '') || 'root';

function describe(error: ErrorObject): string | undefined {
  const path = readable(error.instancePath);
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'type':
      return `${path} 必须是${typeNames[String(params.type)] ?? params.type}`;
    case 'required': {
      const missing = String(params.missingProperty);
      const properties = (error.parentSchema as { properties?: Defs } | undefined)?.properties;
      const type = typeOf(properties?.[missing]);
      const field = path === 'root' ? missing : `${path}.${missing}`;
      return type ? `${field} 缺失，应为${typeNames[type] ?? type}` : `${field} 缺失`;
    }
    case 'additionalProperties': {
      const field = `${path === 'root' ? '' : `${path}.`}${params.additionalProperty}`;
      // A field the editor does not show would also escape privacy mode, so unknown ones are refused.
      if (path === 'basics') return `${field} 不是可用的基本信息字段`;
      if (path.endsWith('.layout')) return `${field} 不是可用的栏目设置`;
      return `${field} 不是可用的字段`;
    }
    case 'const':
      return `${path} 必须是 ${JSON.stringify(params.allowedValue)}`;
    case 'enum': {
      const allowed = `${path} 只能是 ${(params.allowedValues as unknown[]).join('、')}`;
      return path.endsWith('.icon') ? `${allowed}；不写就按网址自动选` : allowed;
    }
    case 'maxLength': {
      // Ajv counts characters, not UTF-16 units, as the editor does.
      const detail = DETAIL_FIELDS.find((field) => path === `basics.${field.id}`);
      if (detail) return `${path}（${detail.label}）最多 ${params.limit} 个字`;
      return `${path} 最多 ${params.limit} ${path.endsWith('.url') ? '个字符' : '个字'}`;
    }
    case 'maxItems':
      // Only a summary's entries are capped at none: its text holds the content.
      return params.limit === 0 ? `${path} 必须是空数组，正文写在 text 里` : `${path} 最多 ${params.limit} 个`;
    case 'pattern':
      // A length-capped text may instead be one privacy placeholder; its maxLength finding already says what is wrong.
      if (error.schemaPath.includes('/anyOf/')) return undefined;
      return params.pattern === defs.nonEmptyId.pattern ? `${path} 不能为空` : `${path} 格式不对`;
    case 'anyOf':
      return undefined;
    default:
      return `${path} ${error.message ?? '不符合 schema'}`;
  }
}

const describeAll = (errors: ErrorObject[] | null | undefined, prefix = '') =>
  (errors ?? []).flatMap((error) => describe({ ...error, instancePath: prefix + error.instancePath }) ?? []);

function duplicateIds(items: unknown[], path: (index: number) => string, kind: string, seen: Set<string>) {
  return items.flatMap((item, index) => {
    const id = isObject(item) ? item.id : undefined;
    if (typeof id !== 'string' || !id.trim()) return [];
    if (seen.has(id)) return [`${path(index)}.id 与其他${kind}重复：${id}`];
    seen.add(id);
    return [];
  });
}

/** Returns human-readable paths for every ResumeData v1 validation problem. */
export function validateResumeData(value: unknown): string[] {
  const { root, sections: sectionValidators } = validators();
  if (root(value)) return uniqueIds(value);
  // A section is checked against the shape its type names, so a mistake in one entry reads as that mistake, not as
  // a failed match against all six section shapes.
  const errors = describeAll(root.errors?.filter((error) => !/^\/sections\/\d/.test(error.instancePath)));
  if (isObject(value) && Array.isArray(value.sections)) {
    value.sections.forEach((section, index) => {
      const path = `sections[${index}]`;
      const validate = isObject(section) ? sectionValidators.get(String(section.type)) : undefined;
      if (!isObject(section)) errors.push(`${path} 必须是对象`);
      else if (!validate) errors.push(`${path}.type 必须是 ${sectionTypes.join('、')}`);
      else if (!validate(section)) errors.push(...describeAll(validate.errors, `/sections/${index}`));
    });
  }
  errors.push(...uniqueIds(value));
  return [...new Set(errors)];
}

// Stable ids are what patches and the editor address; sections, entries (across all sections) and links each need
// their own to be unique.
function uniqueIds(value: unknown): string[] {
  if (!isObject(value)) return [];
  const links = isObject(value.basics) && Array.isArray(value.basics.links) ? value.basics.links : [];
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const entries = new Set<string>();
  return [
    ...duplicateIds(links, (index) => `basics.links[${index}]`, '链接', new Set()),
    ...duplicateIds(sections, (index) => `sections[${index}]`, '栏目', new Set()),
    ...sections.flatMap((section, index) =>
      isObject(section) && Array.isArray(section.entries)
        ? duplicateIds(section.entries, (entry) => `sections[${index}].entries[${entry}]`, '条目', entries)
        : [],
    ),
  ];
}

export function isResumeData(value: unknown): value is ResumeData {
  return validateResumeData(value).length === 0;
}

export function isAppearance(value: unknown): boolean {
  if (
    !isObject(value) ||
    typeof value.themeId !== 'string' ||
    !['comfortable', 'balanced', 'dense'].includes(String(value.density)) ||
    !isObject(value.layout)
  )
    return false;
  const layout = value.layout;
  return (
    ['pageMarginMm', 'baseFontPt', 'lineHeight', 'sectionSpacingPt'].every((key) => typeof layout[key] === 'number') &&
    typeof layout.accentColor === 'string' &&
    typeof layout.photoEnabled === 'boolean'
  );
}

export function isResumeRecord(value: unknown): value is ResumeRecord {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    isResumeData(value.data) &&
    isAppearance(value.appearance)
  );
}

export function isWorkspace(value: unknown): value is ResumeWorkspace {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.activeId === 'string' &&
    Array.isArray(value.resumes) &&
    value.resumes.length > 0 &&
    value.resumes.every(isResumeRecord) &&
    value.resumes.some((resume) => resume.id === value.activeId)
  );
}
