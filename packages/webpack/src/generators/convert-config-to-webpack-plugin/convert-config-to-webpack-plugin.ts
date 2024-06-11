import {
  formatFiles,
  getProjects,
  stripIndents,
  Tree,
  joinPathFragments,
} from '@nx/devkit';
import { forEachExecutorOptions } from '@nx/devkit/src/generators/executor-options-utils';
import { WebpackExecutorOptions } from '@nx/webpack';
import { extractWebpackOptions } from './lib/extract-webpack-options';
import { parse } from 'path';
import { normalizePathOptions } from './lib/normalize-path-options';

interface Schema {
  project?: string;
  skipFormat?: boolean;
}

export async function convertConfigToWebpackPlugin(
  tree: Tree,
  options: Schema
) {
  let migrated = 0;

  const projects = getProjects(tree);
  forEachExecutorOptions<WebpackExecutorOptions>(
    tree,
    '@nx/webpack:webpack',
    (currentTargetOptions, projectName, _, configurationName) => {
      if (options.project && projectName !== options.project) {
        return;
      }
      if (!configurationName) {
        const project = projects.get(projectName);

        const webpackConfigPath = currentTargetOptions?.webpackConfig || '';

        if (webpackConfigPath && tree.exists(webpackConfigPath)) {
          let { withNxConfig: webpackOptions, withReactConfig } =
            extractWebpackOptions(tree, webpackConfigPath);

          if (webpackOptions) {
            webpackOptions = normalizePathOptions(project.root, webpackOptions);
          }

          const { dir, name, ext } = parse(webpackConfigPath);

          tree.rename(
            webpackConfigPath,
            `${joinPathFragments(dir, `${name}.old${ext}`)}`
          );

          tree.write(
            webpackConfigPath,
            stripIndents`
            const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
            const { NxReactWebpackPlugin } = require('@nx/react/webpack-plugin');
            
            // This file was migrated using @nx/webpack:convert-config-to-webpack-plugin
            
            module.exports = {
              plugins: [
                ${
                  webpackOptions
                    ? `new NxAppWebpackPlugin(${webpackOptions.getText()})`
                    : 'new NxAppWebpackPlugin()'
                },
                ${
                  withReactConfig
                    ? `new NxReactWebpackPlugin(${withReactConfig.getText()})`
                    : `new NxReactWebpackPlugin({
                  // Uncomment this line if you don't want to use SVGR
                  // See: https://react-svgr.com/
                  // svgr: false
                  }),`
                },
              ],
            };
          `
          );
          migrated++;
        }
      }
    }
  );
  if (migrated === 0) {
    throw new Error('Could not find any projects to migrate.');
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default convertConfigToWebpackPlugin;
