module.exports = (configs, filename) => {
  return {
    output: {
      filename: configs.webpackFilename[filename],
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          loader: 'babel-loader',
          query: {
            presets: [
              ['env', {
                targets: {
                  browsers: configs.browsersSupport,
                },
              }],
            ],
          },
        },
      ],
    },
  };
};
