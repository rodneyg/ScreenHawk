const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    popup: './src/popup.ts',
    background: './src/background.ts',
    content: './src/content.ts',
    options: './src/options.ts',
    'interaction-viewer': './src/interaction-viewer.ts',
  },
  module: {
    rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
  },
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  plugins: [new CopyPlugin({ patterns: [{ from: 'public', to: '.' }] })],
};
