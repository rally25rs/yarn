/* @flow */

import type {Dependency} from '../../types.js';
import type {Reporter} from '../../reporters/index.js';
import type Config from '../../config.js';
import {Add} from './add.js';
import Lockfile from '../../lockfile/wrapper.js';
import PackageRequest from '../../package-request.js';
import {Install} from './install.js';

const basicSemverOperatorRegex = new RegExp('^(\\^|~|>|<=|>=)?[^ |&,]+$');
const validScopeRegex = /^@[a-zA-Z0-9-][a-zA-Z0-9_.-]*\/$/g;

export function setFlags(commander: Object) {
  // TODO: support some flags that install command has
  commander.usage('upgrade [flags]');
  commander.option('-S, --scope <scope>', 'upgrade packages under the specified scope');
  commander.option('--latest', 'list the latest version of packages, ignoring version ranges in package.json');
  commander.option('-E, --exact', 'install exact version. Only used when --latest is specified.');
  commander.option(
    '-T, --tilde',
    'install most recent release with the same minor version. Only used when --latest is specified.',
  );
  commander.option(
    '-C, --caret',
    'install most recent release with the same major version. Only used when --latest is specified.',
  );
}

export function hasWrapper(commander: Object, args: Array<string>): boolean {
  return true;
}

export const requireLockfile = true;

export async function run(config: Config, reporter: Reporter, flags: Object, args: Array<string>): Promise<void> {
  const lockfile = await Lockfile.fromDirectory(config.lockfileFolder);
  const deps = await getOutdated(config, reporter, flags, lockfile, args);

  // if specific versions were requested for packages, override what getOutdated reported as the latest to install
  args.forEach(requestedPattern => {
    const normalized = PackageRequest.normalizePattern(requestedPattern);
    const newPattern = `${normalized.name}@${normalized.range}`;
    let found = false;

    deps.forEach(dep => {
      if (normalized.hasVersion && dep.name === normalized.name) {
        found = true;
        dep.latestPattern = newPattern;
      }
    });

    if (normalized.hasVersion && !found) {
      deps.push({
        name: normalized.name,
        wanted: '',
        latest: '',
        url: '',
        hint: '',
        range: '',
        current: '',
        latestPattern: newPattern,
      });
    }
  });

  if (!deps.length) {
    reporter.success(reporter.lang('allDependenciesUpToDate'));
    return;
  }

  // remove deps being upgraded from the lockfile, or else Add will use the already-installed version
  // instead of the latest for the range.
  deps.forEach(dep => lockfile.removePattern(dep.latestPattern));

  const addFlags = Object.assign({}, flags, {force: true});
  const addArgs = deps.map(dep => dep.latestPattern);
  delete addFlags.latest;
  const add = new Add(addArgs, addFlags, config, reporter, lockfile);
  await add.init();
}

export async function getOutdated(
  config: Config,
  reporter: Reporter,
  flags: Object,
  lockfile: Lockfile,
  patterns: Array<string>,
): Promise<Array<Dependency>> {
  const install = new Install(flags, config, reporter, lockfile);
  const outdatedFieldName = flags.latest ? 'latest' : 'wanted';

  // this function attempts to determine the range operator on the semver range.
  // this will only handle the simple cases of a semver starting with '^', '~', '>', '>=', '<=', or an exact version.
  // "exotic" semver ranges will not be handled.
  const getRangeOperator = version => {
    const result = basicSemverOperatorRegex.exec(version);
    return result ? result[1] || '' : '^';
  };

  // Attempt to preserve the range operator from the package.json specified semver range.
  // If an explicit operator was specified using --exact, --tilde, --caret, then that will take precedence.
  const buildPatternToUpgradeTo = (dep, flags) => {
    const toLatest = flags.latest;
    const toVersion = toLatest ? dep.latest : dep.range;
    let rangeOperator = '';

    if (toLatest) {
      if (flags.caret) {
        rangeOperator = '^';
      } else if (flags.tilde) {
        rangeOperator = '~';
      } else if (flags.exact) {
        rangeOperator = '';
      } else {
        rangeOperator = getRangeOperator(dep.range);
      }
    }

    return `${dep.name}@${rangeOperator}${toVersion}`;
  };

  let deps = (await PackageRequest.getOutdatedPackages(lockfile, install, config, reporter, patterns)).filter(
    dep => dep.current != dep[outdatedFieldName],
  );

  if (flags.scope) {
    if (!flags.scope.startsWith('@')) {
      flags.scope = '@' + flags.scope;
    }

    if (!flags.scope.endsWith('/')) {
      flags.scope += '/';
    }

    if (validScopeRegex.test(flags.scope)) {
      deps = deps.filter(dep => dep.name.startsWith(flags.scope));
    }
  }

  if (!flags.latest) {
    // these flags only have an affect when --latest is used
    flags.tilde = false;
    flags.exact = false;
    flags.caret = false;
  }

  deps.forEach(dep => (dep.latestPattern = buildPatternToUpgradeTo(dep, flags)));

  return deps;
}
