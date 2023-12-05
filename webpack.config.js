const webpack = require('webpack');

const cloudSupportedBrowserslistConfig =
  'last 1 Chrome versions, last 1 Safari versions, last 1 Firefox versions, last 1 Edge versions';

/** @type {import('webpack').Configuration} */
const config = {
  target: 'web',

  devtool: false,

  mode: 'development',

  entry: './src/index.tsx',

  module: {
    rules: [
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: [
          /\bnode_modules\b/,
          // Otherwise core-js will polyfill itself with core-js and this doesn't work
          // for obvious reasons
          /\bcore-js\b/,
        ],
        use: {
          loader: 'babel-loader',
          options: {
            sourceType: 'unambiguous',
            compact: false,
            presets: [
              [
                require.resolve('@babel/preset-env'),
                {
                  targets: cloudSupportedBrowserslistConfig,
                  modules: 'auto',
                  useBuiltIns: 'usage',
                  corejs: { version: '3.12', proposals: true }
                }
              ],
              require.resolve('@babel/preset-react'),
              require.resolve('@babel/preset-typescript')
            ]
          }
        }
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ]
  },

  resolve: {
    alias: {
      'hadron-ipc': false,
      'react/jsx-runtime': require.resolve('react/jsx-runtime'),
      react: require.resolve('react'),
      'react-dom': require.resolve('react-dom'),
      bson: require.resolve('bson'),
    },
    fallback: {
      v8: false,
      fs: false,
      worker_threads: false,
      crypto: false,
      util: false,
      // path: false,
      // Not required, but this is what mms does
      path: require.resolve('path-browserify'),
      url: false,
      zlib: false,
      stream: require.resolve('stream-browserify'),
      vm: require.resolve('vm-browserify'),
      buffer: require.resolve('buffer')
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '...']
  },

  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    })
  ]
};

module.exports = config;