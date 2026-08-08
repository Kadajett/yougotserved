import { describe, expect, it } from 'vitest';
import {
  assertValidId,
  describeTool,
  isValidId,
  toolNameBudget,
  toolNameFor,
  AdapterNameError,
} from '../src/naming.js';

describe('id validation', () => {
  it('accepts lowercase underscore ids', () => {
    expect(isValidId('search_people')).toBe(true);
    expect(isValidId('list_pull_requests')).toBe(true);
    expect(isValidId('a1')).toBe(true);
  });

  it('rejects the shapes that break MCP clients', () => {
    expect(isValidId('search.people')).toBe(false);
    expect(isValidId('SearchPeople')).toBe(false);
    expect(isValidId('search-people')).toBe(false);
    expect(isValidId('1search')).toBe(false);
    expect(isValidId('')).toBe(false);
  });

  it('names the offending id in the error', () => {
    expect(() => assertValidId('flow.slug', 'tool')).toThrow(/flow\.slug/);
  });
});

describe('toolNameFor', () => {
  it('prefixes with the adapter id by default', () => {
    expect(toolNameFor('linkedin', 'search_people')).toBe('linkedin_search_people');
  });

  it('drops the prefix for a single-adapter server', () => {
    expect(toolNameFor('linkedin', 'search_people', { includeAdapterPrefix: false })).toBe(
      'search_people',
    );
  });

  it('reserves room for the host prefix', () => {
    // Claude Code turns this into mcp__ygs__<name>, so the budget is 64 - 7 - 3.
    expect(toolNameBudget('ygs')).toBe(54);
  });

  it('throws rather than truncating past the budget', () => {
    const long = 'get_unresolved_review_threads_for_repository';
    expect(() => toolNameFor('github', long, { serverName: 'yougotserved' })).toThrow(
      AdapterNameError,
    );
  });

  it('fits a realistic long name under a short server name', () => {
    expect(toolNameFor('github', 'get_unresolved_review_threads', { serverName: 'ygs' })).toBe(
      'github_get_unresolved_review_threads',
    );
  });
});

describe('describeTool', () => {
  it('keeps a read tool to its own sentence', () => {
    expect(describeTool({ description: 'Search people.', risk: 'read' })).toBe('Search people.');
  });

  it('flags writes, irreversibility and confirmation', () => {
    const text = describeTool({
      description: 'Send a connection request.',
      returns: 'the request id',
      risk: 'irreversible',
      confirm: true,
    });
    expect(text).toBe(
      'Send a connection request. Returns the request id. Irreversible. Requires confirm: true.',
    );
  });

  it('collapses whitespace so a template literal cannot bloat the schema', () => {
    expect(describeTool({ description: 'Search\n   people.', risk: 'read' })).toBe(
      'Search people.',
    );
  });
});
