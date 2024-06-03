import type { Config } from '@jest/types';
import {
  createProjectGraphAsync,
  formatFiles,
  workspaceRoot,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import { migrateExecutorToPlugin } from '@nx/devkit/src/generators/plugin-migrations/executor-to-plugin-migrator';
import {
  processTargetOutputs,
  toProjectRelativePath,
} from '@nx/devkit/src/generators/plugin-migrations/plugin-migration-utils';
import { readConfig } from 'jest-config';
import { join, normalize } from 'node:path/posix';
import { createNodesV2, type JestPluginOptions } from '../../plugins/plugin';
import { jestConfigExtensions } from '../../utils/config/config-file';

interface Schema {
  project?: string;
  skipFormat?: boolean;
}

export async function convertToInferred(tree: Tree, options: Schema) {
  const projectGraph = await createProjectGraphAsync();
  const migratedProjectsModern =
    await migrateExecutorToPlugin<JestPluginOptions>(
      tree,
      projectGraph,
      '@nx/jest:jest',
      '@nx/jest/plugin',
      (targetName) => ({ targetName }),
      postTargetTransformer,
      createNodesV2,
      options.project
    );

  const migratedProjectsLegacy =
    await migrateExecutorToPlugin<JestPluginOptions>(
      tree,
      projectGraph,
      '@nrwl/jest:jest',
      '@nx/jest/plugin',
      (targetName) => ({ targetName }),
      postTargetTransformer,
      createNodesV2,
      options.project
    );

  const migratedProjects =
    migratedProjectsModern.size + migratedProjectsLegacy.size;

  if (migratedProjects === 0) {
    throw new Error('Could not find any targets to migrate.');
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

async function postTargetTransformer(
  target: TargetConfiguration,
  tree: Tree,
  projectDetails: { projectName: string; root: string },
  inferredTarget: TargetConfiguration
): Promise<TargetConfiguration> {
  let jestConfigPath = jestConfigExtensions
    .map((ext) => `jest.config.${ext}`)
    .find((configFileName) =>
      tree.exists(join(projectDetails.root, configFileName))
    );

  if (target.options) {
    await updateOptions(target.options, projectDetails.root, jestConfigPath);
  }

  if (target.configurations) {
    for (const [configName, config] of Object.entries(target.configurations)) {
      await updateOptions(config, projectDetails.root, jestConfigPath);

      if (!Object.keys(config).length) {
        delete target.configurations[configName];
      }
    }

    if (!Object.keys(target.configurations).length) {
      delete target.defaultConfiguration;
      delete target.configurations;
    }

    if (
      'defaultConfiguration' in target &&
      !target.configurations?.[target.defaultConfiguration]
    ) {
      delete target.defaultConfiguration;
    }
  }

  if (target.outputs) {
    processTargetOutputs(target, [], inferredTarget, {
      projectName: projectDetails.projectName,
      projectRoot: projectDetails.root,
    });
  }

  return target;
}

export default convertToInferred;

async function updateOptions(
  targetOptions: any,
  projectRoot: string,
  defaultJestConfigPath: string | undefined
) {
  const jestConfigPath = targetOptions.jestConfig ?? defaultJestConfigPath;
  // inferred targets are only identified after known files that Jest would
  // pick up, so we can safely remove the config options
  delete targetOptions.jestConfig;
  delete targetOptions.config;

  // deprecated and unused
  delete targetOptions.tsConfig;

  if ('codeCoverage' in targetOptions) {
    targetOptions.coverage = targetOptions.codeCoverage;
    delete targetOptions.codeCoverage;
  }

  if ('testFile' in targetOptions) {
    targetOptions.args ??= [];
    targetOptions.args.push(
      toProjectRelativeRegexPath(targetOptions.testFile, projectRoot)
    );
    delete targetOptions.testFile;
  }

  if ('runTestsByPath' in targetOptions) {
    targetOptions.runTestsByPath = targetOptions.runTestsByPath.map(
      (path: string) => toProjectRelativePath(path, projectRoot)
    );
  }

  if ('findRelatedTests' in targetOptions) {
    // the executor accepts a comma-separated string, while jest accepts a space-separated string
    const parsedTests = targetOptions.findRelatedTests
      .split(',')
      .map((s: string) => toProjectRelativePath(s.trim(), projectRoot));
    targetOptions.findRelatedTests = parsedTests.join(' ');
  }

  if ('setupFile' in targetOptions) {
    // the jest executor merges the setupFile with the setupFilesAfterEnv, so
    // to keep the task working as before we resolve the setupFilesAfterEnv
    // from the options or the jest config and add the setupFile to it
    // https://github.com/nrwl/nx/blob/bdd3375256613340899f649eb800d22abcc9f507/packages/jest/src/executors/jest/jest.impl.ts#L107-L113
    let setupFilesAfterEnv = targetOptions.setupFilesAfterEnv;
    if (!setupFilesAfterEnv && jestConfigPath) {
      const jestConfig = await readConfig(
        <Config.Argv>{},
        join(workspaceRoot, jestConfigPath)
      );
      setupFilesAfterEnv = (
        jestConfig.projectConfig.setupFilesAfterEnv ?? []
      ).map((file: string) => toProjectRelativePath(file, projectRoot));
    }

    const mergedSetupFiles = [
      ...setupFilesAfterEnv,
      toProjectRelativePath(targetOptions.setupFile, projectRoot),
    ];
    targetOptions.setupFilesAfterEnv = dedupeSetupFiles(
      mergedSetupFiles,
      projectRoot
    );
    delete targetOptions.setupFile;
  }

  if ('testPathPattern' in targetOptions) {
    targetOptions.testPathPattern = targetOptions.testPathPattern.map(
      (pattern: string) => toProjectRelativeRegexPath(pattern, projectRoot)
    );
  }

  if ('testPathIgnorePatterns' in targetOptions) {
    targetOptions.testPathIgnorePatterns =
      targetOptions.testPathIgnorePatterns.map((pattern: string) =>
        toProjectRelativeRegexPath(pattern, projectRoot)
      );
  }

  if ('outputFile' in targetOptions) {
    // update the output file to be relative to the project root
    targetOptions.outputFile = toProjectRelativePath(
      targetOptions.outputFile,
      projectRoot
    );
  }
  if ('coverageDirectory' in targetOptions) {
    // update the coverage directory to be relative to the project root
    targetOptions.coverageDirectory = toProjectRelativePath(
      targetOptions.coverageDirectory,
      projectRoot
    );
  }
}

function toProjectRelativeRegexPath(path: string, projectRoot: string): string {
  if (projectRoot === '.') {
    // workspace and project root are the same, keep the path as is
    return path;
  }

  const normalizedRoot = normalize(projectRoot);
  if (new RegExp(`^(?:\\.\\/)?${normalizedRoot}(?:\\/)?$`).test(path)) {
    // path includes everything inside project root
    return '.*';
  }

  const normalizedPath = normalize(path);

  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.replace(new RegExp(`^${normalizedRoot}/`), '')
    : path;
}

function dedupeSetupFiles(setupFiles: string[], projectRoot: string): string[] {
  const files: string[] = [];
  const normalizedFiles = new Set<string>();

  for (const file of setupFiles) {
    const normalizedFile = file.startsWith('<rootDir>')
      ? join(workspaceRoot, projectRoot, file.slice('<rootDir>'.length))
      : join(workspaceRoot, projectRoot, file);
    if (!normalizedFiles.has(normalizedFile)) {
      files.push(file);
      normalizedFiles.add(normalizedFile);
    }
  }

  return files;
}
