import { describe, expect, it } from '@jest/globals';

import * as accessControl from '../../src/index.js';

function localAuthorizer(policies) {
  expect(accessControl.createLocalAuthorizer).toEqual(expect.any(Function));
  return accessControl.createLocalAuthorizer(policies);
}

function isAllowed(authorizer, workload, resource, action) {
  return authorizer.isAllowed({ workload, resource, action });
}

describe('local workload access control', () => {
  it('grants the API only the capabilities needed to accept orders', () => {
    const authorizer = localAuthorizer();

    expect(isAllowed(authorizer, 'api', 'database.products', 'read')).toBe(true);
    expect(isAllowed(authorizer, 'api', 'database.orders', 'read')).toBe(true);
    expect(isAllowed(authorizer, 'api', 'database.orders', 'write')).toBe(true);
    expect(isAllowed(authorizer, 'api', 'queue.order-created', 'publish')).toBe(true);
    expect(isAllowed(authorizer, 'api', 'queue.order-created', 'consume')).toBe(false);
    expect(isAllowed(authorizer, 'api', 'database.products', 'write')).toBe(false);
  });

  it('grants the worker only the capabilities needed to process orders', () => {
    const authorizer = localAuthorizer();

    expect(isAllowed(authorizer, 'worker', 'queue.order-created', 'consume')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'database.products', 'read')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'database.products', 'write')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'database.orders', 'read')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'database.orders', 'write')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'database.message-claims', 'write')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'events.order-completed', 'publish')).toBe(true);
    expect(isAllowed(authorizer, 'worker', 'queue.order-created', 'publish')).toBe(false);
    expect(isAllowed(authorizer, 'worker', 'analytics.orders', 'write')).toBe(false);
  });

  it('limits the analytics consumer to its event and destination', () => {
    const authorizer = localAuthorizer();

    expect(isAllowed(authorizer, 'analytics-consumer', 'events.order-created', 'consume')).toBe(
      true,
    );
    expect(isAllowed(authorizer, 'analytics-consumer', 'analytics.orders', 'write')).toBe(true);
    expect(isAllowed(authorizer, 'analytics-consumer', 'database.orders', 'write')).toBe(false);
    expect(isAllowed(authorizer, 'analytics-consumer', 'events.order-completed', 'consume')).toBe(
      false,
    );
  });

  it('denies unknown workloads and unlisted capabilities', () => {
    const authorizer = localAuthorizer();

    expect(isAllowed(authorizer, 'unknown', 'database.orders', 'read')).toBe(false);
    expect(isAllowed(authorizer, 'api', 'unknown.resource', 'read')).toBe(false);
    expect(isAllowed(authorizer, 'api', 'database.orders', 'delete')).toBe(false);
  });

  it.each([
    ['a wildcard resource', { service: [{ resource: '*', actions: ['read'] }] }],
    ['a wildcard action', { service: [{ resource: 'database.orders', actions: ['*'] }] }],
    [
      'an administrative action',
      { service: [{ resource: 'database.orders', actions: ['admin'] }] },
    ],
  ])('rejects %s', (_case, policies) => {
    expect(() => localAuthorizer(policies)).toThrow(
      expect.objectContaining({ code: 'INVALID_LOCAL_ACCESS_POLICY' }),
    );
  });
});
