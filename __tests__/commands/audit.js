/* @flow */

import {NoopReporter} from '../../src/reporters/index.js';
import {run as buildRun} from './_helpers.js';
import {run as audit} from '../../src/cli/commands/audit.js';

const path = require('path');

const fixturesLoc = path.join(__dirname, '..', 'fixtures', 'audit');

const setupMockRequestManager = function(config) {
  const apiResponse = getAuditResponse(config);
  // $FlowFixMe
  config.requestManager.request = jest.fn();
  config.requestManager.request.mockReturnValue(
    new Promise(resolve => {
      resolve(apiResponse);
    }),
  );
};

const setupMockReporter = function(reporter) {
  // $FlowFixMe
  reporter.auditAdvisory = jest.fn();
  // $FlowFixMe
  reporter.auditAction = jest.fn();
  // $FlowFixMe
  reporter.auditSummary = jest.fn();
};

const getAuditResponse = function(config): Object {
  // $FlowFixMe
  return require(path.join(config.cwd, 'audit-api-response.json'));
};

const runAudit = buildRun.bind(
  null,
  NoopReporter,
  fixturesLoc,
  async (args, flags, config, reporter, lockfile, getStdout): Promise<string> => {
    setupMockRequestManager(config);
    setupMockReporter(reporter);
    await audit(config, reporter, flags, args);
    return getStdout();
  },
);

test.concurrent('sends correct dependency map to audit api for single dependency.', () => {
  const expectedApiPost = {
    name: 'yarn-test',
    install: [],
    remove: [],
    metadata: {},
    requires: {
      minimatch: '^3.0.0',
    },
    dependencies: {
      minimatch: {
        version: '3.0.0',
        integrity: 'sha1-UjYVelHk8ATBd/s8Un/33Xjw74M=',
        requires: {
          'brace-expansion': '^1.0.0',
        },
        dependencies: {},
      },
      'brace-expansion': {
        version: '1.1.11',
        integrity: 'sha512-iCuPHDFgrHX7H2vEI/5xpz07zSHB00TpugqhmYtVmMO6518mCuRMoOYFldEBl0g187ufozdaHgWKcYFb61qGiA==',
        requires: {
          'balanced-match': '^1.0.0',
          'concat-map': '0.0.1',
        },
        dependencies: {},
      },
      'balanced-match': {
        version: '1.0.0',
        integrity: 'sha1-ibTRmasr7kneFk6gK4nORi1xt2c=',
        requires: {},
        dependencies: {},
      },
      'concat-map': {
        version: '0.0.1',
        integrity: 'sha1-2Klr13/Wjfd5OnMDajug1UBdR3s=',
        requires: {},
        dependencies: {},
      },
    },
    version: '0.0.0',
  };

  return runAudit([], {}, 'single-vulnerable-dep-installed', config => {
    expect(config.requestManager.request).toBeCalledWith(
      expect.objectContaining({
        body: expectedApiPost,
      }),
    );
  });
});

test('calls reporter auditAdvisory with correct data', () => {
  return runAudit([], {}, 'single-vulnerable-dep-installed', (config, reporter) => {
    const apiResponse = getAuditResponse(config);
    expect(reporter.auditAdvisory).toBeCalledWith(apiResponse.actions[0].resolves[0], apiResponse.advisories['118']);
  });
});

test('calls reporter auditAction with correct data', () => {
  return runAudit([], {}, 'single-vulnerable-dep-installed', (config, reporter) => {
    const apiResponse = getAuditResponse(config);
    expect(reporter.auditAction).toBeCalledWith({
      cmd: 'yarn upgrade minimatch@3.0.4',
      isBreaking: false,
      action: apiResponse.actions[0],
    });
  });
});

test('calls reporter auditSummary with correct data', () => {
  return runAudit([], {}, 'single-vulnerable-dep-installed', (config, reporter) => {
    const apiResponse = getAuditResponse(config);
    expect(reporter.auditSummary).toBeCalledWith(apiResponse.metadata);
  });
});
