/**
 * @yougotserved/adapter-sdk
 *
 * Define compact, site-specific tools — `linkedin_search_people`,
 * `github_get_unresolved_review_threads` — that run against the browser the
 * user is already signed into.
 *
 *     import { defineSiteAdapter, defineTool, p } from '@yougotserved/adapter-sdk';
 *
 *     export default defineSiteAdapter({
 *       id: 'linkedin',
 *       name: 'LinkedIn',
 *       origins: ['https://www.linkedin.com'],
 *       tools: {
 *         search_people: defineTool({
 *           description: 'Search people on LinkedIn.',
 *           returns: 'name, headline and profile URL for each result',
 *           params: { query: p.string('Search terms') },
 *           handler: async (page, args) => {
 *             await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(args.query)}`);
 *             return page.extract({ each: 'main [role="listitem"]', fields: { ... } });
 *           },
 *         }),
 *       },
 *     });
 *
 * Wrap every tool in `defineTool` — inside a bare object literal TypeScript
 * cannot infer `args` from `params`, so `args.querry` compiles silently.
 */

export {
  defineSiteAdapter,
  defineSteps,
  defineTool,
  AdapterDefinitionError,
  TOOL_STEPS,
  type StepToolDefinition,
  type CompiledTool,
  type RiskLevel,
  type SiteAdapter,
  type SiteAdapterDefinition,
  type ToolDefinition,
  type ToolHandler,
} from './define.js';

export {
  p,
  Param,
  ParamError,
  paramsToJsonSchema,
  validateParams,
  type FileParamValue,
  type InferParams,
  type JsonSchemaNode,
  type ParamShape,
  type ValidationResult,
} from './schema.js';

export {
  runExtractSpec,
  validateExtractSpec,
  ExtractError,
  type ExtractSpec,
  type ExtractedRecord,
  type ExtractedValue,
  type FieldSpec,
  type FieldSpecObject,
} from './extract.js';

export {
  basename,
  classifyUploadPath,
  extensionOf,
  normaliseFileRef,
  normalisePath,
  UploadError,
  type FileRef,
  type UploadPolicy,
  type UploadVerdict,
} from './files.js';

export {
  createUrlGuard,
  parseOriginPattern,
  OriginError,
  type OriginRule,
  type UrlGuard,
} from './origins.js';

export {
  ok,
  err,
  toAdapterResult,
  AdapterFailure,
  type AdapterError,
  type AdapterErrorCode,
  type AdapterOk,
  type AdapterResult,
} from './result.js';

export {
  ALL_CAPABILITIES,
  MUTATING_CAPABILITIES,
  OPT_IN_CAPABILITIES,
  type BrowserSession,
  type Capability,
  type CapturedRequest,
  type ClickOptions,
  type FillOptions,
  type NavigateOptions,
  type NetworkAccess,
  type NetworkCapture,
  type PageSnapshot,
  type Screenshot,
  type ScrollOptions,
  type ToolContext,
  type UploadedFile,
  type UploadOptions,
  type UploadReceipt,
  type WaitOptions,
  type WaitTarget,
} from './session.js';

export {
  assertValidId,
  describeTool,
  isValidId,
  toolNameBudget,
  toolNameFor,
  AdapterNameError,
  HOST_PREFIX_OVERHEAD,
  MAX_TOOL_NAME,
  type ToolNameOptions,
} from './naming.js';

export {
  buildPack,
  canonicalJson,
  describePack,
  packDigest,
  validatePack,
  PackError,
  PACK_FORMAT,
  type BuildPackResult,
  type Pack,
  type PackTool,
} from './pack.js';

export {
  renderTemplate,
  templateRefs,
  validateSteps,
  StepError,
  MAX_REPEAT,
  MAX_STEPS,
  type Step,
  type Template,
} from './steps.js';

export { runSteps, type RunStepsOptions } from './interpreter.js';
