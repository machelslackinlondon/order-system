const ALLOWED_ACTIONS = new Set(['consume', 'publish', 'read', 'write']);
const RESOURCE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

const DEFAULT_POLICIES = {
  api: [
    { resource: 'database.products', actions: ['read'] },
    { resource: 'database.orders', actions: ['read', 'write'] },
    { resource: 'queue.order-created', actions: ['publish'] },
  ],
  worker: [
    { resource: 'queue.order-created', actions: ['consume'] },
    { resource: 'database.products', actions: ['read', 'write'] },
    { resource: 'database.orders', actions: ['read', 'write'] },
    { resource: 'database.message-claims', actions: ['write'] },
    { resource: 'events.order-completed', actions: ['publish'] },
  ],
  'analytics-consumer': [
    { resource: 'events.order-created', actions: ['consume'] },
    { resource: 'analytics.orders', actions: ['write'] },
  ],
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidRule(rule) {
  return (
    rule !== null &&
    typeof rule === 'object' &&
    RESOURCE_PATTERN.test(rule.resource) &&
    Array.isArray(rule.actions) &&
    rule.actions.length > 0 &&
    rule.actions.every((action) => ALLOWED_ACTIONS.has(action))
  );
}

function capabilityKey(resource, action) {
  return `${resource}:${action}`;
}

export class InvalidLocalAccessPolicyError extends TypeError {
  constructor() {
    super('Invalid local access policy');
    this.name = 'InvalidLocalAccessPolicyError';
    this.code = 'INVALID_LOCAL_ACCESS_POLICY';
  }
}

export function createLocalAuthorizer(policies = DEFAULT_POLICIES) {
  if (policies === null || typeof policies !== 'object' || Array.isArray(policies)) {
    throw new InvalidLocalAccessPolicyError();
  }

  const grantsByWorkload = new Map();

  for (const [workload, rules] of Object.entries(policies)) {
    if (!isNonEmptyString(workload) || !Array.isArray(rules) || !rules.every(isValidRule)) {
      throw new InvalidLocalAccessPolicyError();
    }

    const grants = new Set();
    for (const rule of rules) {
      for (const action of rule.actions) {
        grants.add(capabilityKey(rule.resource, action));
      }
    }
    grantsByWorkload.set(workload, grants);
  }

  return {
    isAllowed({ workload, resource, action }) {
      return grantsByWorkload.get(workload)?.has(capabilityKey(resource, action)) ?? false;
    },
  };
}
