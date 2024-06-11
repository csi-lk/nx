import { Tree } from '@nx/devkit';

export function extractWebpackOptions(tree: Tree, webpackConfigPath: string) {
  const { tsquery } = require('@phenomnomnominal/tsquery');

  const source = tree.read(webpackConfigPath).toString('utf-8');
  const ast = tsquery.ast(source);

  const withNxCall = tsquery(
    ast,
    'CallExpression:has(Identifier[name="withNx"])'
  );
  const withReactCall = tsquery(
    ast,
    'CallExpression:has(Identifier[name="withReact"])'
  );

  let withNxConfig, withReactConfig;

  withNxCall.forEach((node) => {
    const argument = node.arguments[0]; // assuming the first argument is the config object
    withNxConfig = argument;
  });

  withReactCall.forEach((node) => {
    const argument = node.arguments[0];
    withReactConfig = argument;
  });

  return { withNxConfig, withReactConfig };
}
