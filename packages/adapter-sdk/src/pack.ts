/**
 * Packs — the publishable artifact.
 *
 * A pack is a JSON document describing an adapter completely: its origins, the
 * capabilities it needs, each tool's parameters, and each tool's steps. It
 * contains no code. Publishing means uploading this file; installing means
 * downloading it and handing it to the interpreter.
 *
 * Everything about the distribution model follows from that. The registry
 * serves immutable static files and never executes anything. A reviewer can
 * read a pack in a browser tab. Chrome Web Store policy on remotely-hosted
 * code is satisfied because nothing remote is code. And a hostile pack's worst
 * case is bounded by the origin fence and capability list the host enforces
 * against it, not by what the pack claims about itself.
 *
 * Tools written as JS handlers cannot be represented here. That is the point:
 * they stay local.
 */

import { assertValidId } from './naming.js';
import { validateExtractSpec } from './extract.js';
import { parseOriginPattern } from './origins.js';
import { validateSteps, templateRefs, type Step } from './steps.js';
import { ALL_CAPABILITIES, type Capability } from './session.js';
import type { JsonSchemaNode } from './schema.js';
import type { RiskLevel, SiteAdapter } from './define.js';
import type { UploadPolicy } from './files.js';

/** Bumped when the pack shape changes incompatibly. */
export const PACK_FORMAT = 1;

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

export interface PackTool {
  description: string;
  returns?: string;
  risk: RiskLevel;
  capabilities: Capability[];
  requiresConfirm: boolean;
  timeoutMs?: number;
  inputSchema: JsonSchemaNode;
  steps: Step[];
}

export interface Pack {
  format: number;
  id: string;
  name: string;
  description: string;
  version: string;
  homepage?: string;
  origins: string[];
  capabilities: Capability[];
  signInUrl?: string;
  uploads?: UploadPolicy;
  tools: Record<string, PackTool>;
}

/* ------------------------------------------------------------------ *
 * Canonical form and digest
 * ------------------------------------------------------------------ */

/**
 * Serialises with sorted keys so the same pack always hashes the same.
 *
 * Without this the digest depends on property insertion order, and a rebuild
 * that changed nothing would publish a "new" version.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * Content address for a pack: `sha256-<hex>`.
 *
 * Uses WebCrypto so the same function works in the host, the extension, and a
 * Worker on the registry side — all three need to agree on the digest or the
 * integrity check is theatre.
 */
export async function packDigest(pack: Pack): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(pack));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256-${hex}`;
}

/* ------------------------------------------------------------------ *
 * Validation
 *
 * A pack arriving from a registry is untrusted input. Every field is checked
 * here before anything looks at it, including fields the publisher's own build
 * already validated — the build ran on their machine, not ours.
 * ------------------------------------------------------------------ */

export function validatePack(value: unknown): Pack {
  if (!value || typeof value !== 'object') throw new PackError('A pack must be a JSON object.');
  const pack = value as Partial<Pack>;

  if (pack.format !== PACK_FORMAT) {
    throw new PackError(
      `Unsupported pack format ${String(pack.format)}; this build reads format ${PACK_FORMAT}.`,
    );
  }

  assertValidId(String(pack.id ?? ''), 'adapter');
  if (!pack.name?.trim()) throw new PackError(`Pack "${pack.id}" has no name.`);
  if (!/^\d+\.\d+\.\d+/.test(pack.version ?? '')) {
    throw new PackError(`Pack "${pack.id}" needs a semver version, got ${String(pack.version)}.`);
  }

  if (!Array.isArray(pack.origins) || pack.origins.length === 0) {
    throw new PackError(`Pack "${pack.id}" declares no origins.`);
  }
  pack.origins.forEach((origin) => parseOriginPattern(origin));

  const capabilities = pack.capabilities ?? [];
  if (!Array.isArray(capabilities)) throw new PackError('capabilities must be an array.');
  for (const capability of capabilities) {
    if (!ALL_CAPABILITIES.includes(capability)) {
      throw new PackError(`Pack "${pack.id}" declares unknown capability "${capability}".`);
    }
  }

  if (!pack.tools || typeof pack.tools !== 'object' || Object.keys(pack.tools).length === 0) {
    throw new PackError(`Pack "${pack.id}" has no tools.`);
  }

  for (const [toolId, tool] of Object.entries(pack.tools)) {
    const where = `${pack.id}.${toolId}`;
    assertValidId(toolId, 'tool');

    if (!tool?.description?.trim()) throw new PackError(`${where} has no description.`);
    if (!['read', 'write', 'irreversible'].includes(tool.risk)) {
      throw new PackError(`${where} has invalid risk "${tool.risk}".`);
    }

    // A tool may not need something the adapter did not declare. Checked here
    // because the capability list is what a user is shown at install time, and
    // it has to be the truth about the whole pack.
    for (const capability of tool.capabilities ?? []) {
      if (!capabilities.includes(capability)) {
        throw new PackError(
          `${where} needs "${capability}", which the pack does not declare. Refusing to load.`,
        );
      }
    }

    validateSteps(tool.steps, `${where}.steps`);

    // Walks into repeat and forEach. A nested extract used to go unchecked,
    // which meant a pack could hide a bad spec one level down.
    const checkExtracts = (list: readonly Step[], at: string): void => {
      for (const [index, step] of list.entries()) {
        const here = `${at}[${index}]`;
        if ('extract' in step) validateExtractSpec(step.extract, `${here}.extract`);
        else if ('repeat' in step) checkExtracts(step.repeat.steps, `${here}.repeat.steps`);
        else if ('forEach' in step) checkExtracts(step.steps, `${here}.forEach.steps`);
      }
    };
    checkExtracts(tool.steps, `${where}.steps`);

    const declared = new Set(Object.keys(tool.inputSchema?.properties ?? {}));
    for (const reference of templateRefs(tool.steps)) {
      if (!declared.has(reference)) {
        throw new PackError(
          `${where} references "{{${reference}}}" but declares no such parameter.`,
        );
      }
    }
  }

  return pack as Pack;
}

/**
 * Everything a user should see before installing, in the order that matters.
 *
 * Origins first: it is the only line that bounds what the adapter can reach.
 */
/**
 * Renders a step tree as readable lines.
 *
 * Every other field in a pack is prose its author wrote, so a pack can describe
 * itself as "read the front page" while its steps go somewhere else. The steps
 * are the only part that says what will actually happen, which makes this the
 * one description worth trusting.
 */
export function describeSteps(steps: readonly Step[], indent = '  '): string[] {
  const lines: string[] = [];

  for (const step of steps) {
    if ('goto' in step) lines.push(`${indent}go to ${step.goto}`);
    else if ('waitFor' in step) lines.push(`${indent}wait`);
    else if ('click' in step) {
      lines.push(`${indent}click ${step.click}${step.optional ? ' (if present)' : ''}`);
    } else if ('fill' in step) {
      lines.push(
        `${indent}type ${step.value} into ${step.fill}${step.optional ? ' (if present)' : ''}`,
      );
    } else if ('select' in step) {
      lines.push(`${indent}choose ${step.value} in ${step.select}`);
    } else if ('press' in step) lines.push(`${indent}press ${step.press}`);
    else if ('scroll' in step) lines.push(`${indent}scroll`);
    else if ('upload' in step) {
      lines.push(
        `${indent}attach ${step.upload.file} to ${step.upload.selector ?? step.upload.trigger}`,
      );
    } else if ('extract' in step) {
      const fields = Object.keys(step.extract.fields ?? {}).join(', ');
      lines.push(`${indent}read ${step.extract.each ?? 'the page'}${fields ? `: ${fields}` : ''}`);
    } else if ('assert' in step) {
      lines.push(`${indent}stop unless the page looks right (${step.assert.code})`);
    } else if ('repeat' in step) {
      lines.push(`${indent}repeat up to ${step.repeat.times} times:`);
      lines.push(...describeSteps(step.repeat.steps, `${indent}  `));
    } else if ('forEach' in step) {
      lines.push(`${indent}for each ${step.forEach}:`);
      lines.push(...describeSteps(step.steps, `${indent}  `));
    }
  }

  return lines;
}

export interface DescribeOptions {
  /** Include the steps. Off by default, because the summary is often enough. */
  steps?: boolean;
}

export function describePack(pack: Pack, options: DescribeOptions = {}): string {
  const lines = [
    `${pack.name} (${pack.id}@${pack.version})`,
    pack.description,
    '',
    `Origins:      ${pack.origins.join(', ')}`,
    `Capabilities: ${pack.capabilities.join(', ') || 'none'}`,
  ];

  if (pack.uploads?.allowedExtensions?.length) {
    lines.push(`Uploads:      ${pack.uploads.allowedExtensions.join(', ')} only`);
  }

  lines.push('', 'Tools:');
  for (const [toolId, tool] of Object.entries(pack.tools)) {
    const flags = [tool.risk !== 'read' ? tool.risk : null, tool.requiresConfirm ? 'confirm' : null]
      .filter(Boolean)
      .join(', ');
    lines.push(`  ${toolId}${flags ? ` [${flags}]` : ''} — ${tool.description}`);

    // The description above is the author's claim. This is what it does.
    if (options.steps) lines.push(...describeSteps(tool.steps, '      '));
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Compilation
 * ------------------------------------------------------------------ */

export interface BuildPackResult {
  pack: Pack;
  /**
   * Tools left out because they are JS handlers.
   *
   * Not an error: an adapter may reasonably keep a hard tool local and publish
   * the rest. But it must be reported loudly, because the difference between
   * "published four tools" and "published two and silently dropped two" is the
   * kind of thing you discover from a bug report.
   */
  skipped: { id: string; reason: string }[];
}

/**
 * Compiles a {@link SiteAdapter} into a publishable pack.
 *
 * Only step-defined tools survive. A JS handler cannot be serialised, and
 * emitting a pack that silently omits it — or worse, embeds its source — would
 * defeat the whole model.
 */
export function buildPack(adapter: SiteAdapter): BuildPackResult {
  const tools: Record<string, PackTool> = {};
  const skipped: { id: string; reason: string }[] = [];

  for (const tool of adapter.tools) {
    if (!tool.steps) {
      skipped.push({
        id: tool.id,
        reason: 'written as a JS handler; rewrite with defineSteps() to publish it',
      });
      continue;
    }

    tools[tool.id] = {
      description: tool.description,
      risk: tool.risk,
      capabilities: [...tool.capabilities],
      requiresConfirm: tool.requiresConfirm,
      timeoutMs: tool.timeoutMs,
      inputSchema: tool.inputSchema(),
      steps: [...tool.steps],
    };
  }

  if (Object.keys(tools).length === 0) {
    throw new PackError(
      `Adapter "${adapter.id}" has no publishable tools. ` +
        `Packs contain steps, not code — rewrite at least one tool with defineSteps().`,
    );
  }

  const pack: Pack = {
    format: PACK_FORMAT,
    id: adapter.id,
    name: adapter.name,
    description: adapter.description,
    version: adapter.version,
    homepage: adapter.homepage,
    origins: [...adapter.origins],
    // Narrowed to what the published tools actually use, so installing a pack
    // never asks for a capability only a withheld local tool needed.
    capabilities: ALL_CAPABILITIES.filter((capability) =>
      Object.values(tools).some((tool) => tool.capabilities.includes(capability)),
    ),
    signInUrl: adapter.signInUrl,
    uploads: Object.keys(adapter.uploads).length ? adapter.uploads : undefined,
    tools,
  };

  return { pack: validatePack(JSON.parse(canonicalJson(pack))), skipped };
}
