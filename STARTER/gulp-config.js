const notifier = require('node-notifier');
const path = require('path');
const webpackConfigs = require('./webpack.config');
const eslint = require('gulp-eslint');

function _getShortPath(pathArray, folder) {
  const folders = [];
  let active = false;

  for (const pathEl of pathArray) {
    if (active) {
      folders.push(pathEl);
    }

    if (pathEl === folder) {
      active = true;
    }
  }

  return folders;
}

const gulpConfigs = {
  npmDir: './node_modules',
  browsersSupport: ['last 2 versions', '> 2%', 'ie 11'],

  sassFiles: ['./scss/**/*.scss'],

  allScripts: ['./js/bundle/**/*.js', './js/standalone/*.js'],
  standaloneScripts: './js/standalone/*.js',
  bundleScripts: './js/bundle/**/*.js',
  scriptsDist: './js/dist',

  icomoon: ['./fonts/icomoon/selection.json'],

  webpackFilename: {
    bundle: 'bundle.js',
    standalone: '[name]',
  },

  testEnv: () => {
    return !!(process.env.NODE_ENV && process.env.NODE_ENV.trim() === 'test');
  },
};

gulpConfigs.sassIncludePaths = [`${gulpConfigs.npmDir}/foundation-sites/scss`];

gulpConfigs.webpack = {
  bundle: webpackConfigs(gulpConfigs, 'bundle'),
  standalone: webpackConfigs(gulpConfigs, 'standalone'),
};

gulpConfigs.notifier = {
  sassLint: (sassLint) => {
    const lint = sassLint[0];
    if (!(lint.errorCount > 0 || lint.warningCount > 0)) return false;

    const errors = [];
    if (lint.errorCount > 0) {
      errors.push(`${lint.errorCount} ${(lint.errorCount > 1) ? 'errors' : 'error'}`);
    }
    if (lint.warningCount > 0) {
      errors.push(`${lint.warningCount} ${(lint.warningCount > 1) ? 'warnings' : 'warning'}`);
    }

    let message = `${lint.filePath}\r\n`;
    for (const mes of lint.messages) {
      message += `${mes.line}:${mes.column} ${mes.severity === 2 ? 'error' : 'warning'} ${mes.ruleId}\r\n`;
    }

    if (gulpConfigs.testEnv()) {
      process.exit(1);
    } else {
      notifier.notify({
        title: `SCSS (${errors.join(', ')})`,
        message,
        wait: true,
        sound: false,
      });

      notifier.on('click', () => false);
    }
  },
  esLint: (esLint) => {
    const lint = esLint;
    if (!(lint.errorCount > 0 || lint.warningCount > 0)) return false;
    const shortPath = _getShortPath(lint.filePath.split(path.sep), path.basename(__dirname));

    const errors = [];
    if (lint.errorCount > 0) {
      errors.push(`${lint.errorCount} ${(lint.errorCount > 1) ? 'errors' : 'error'}`);
    }
    if (lint.warningCount > 0) {
      errors.push(`${lint.warningCount} ${(lint.warningCount > 1) ? 'warnings' : 'warning'}`);
    }

    let message = `${shortPath.join(path.sep)}\r\n`;
    for (const mes of lint.messages) {
      message += `${mes.line}:${mes.column} ${mes.severity === 2 ? 'error' : 'warning'} ${mes.ruleId}\r\n`;
    }

    if (!gulpConfigs.testEnv()) {
      console.log(234234324);
      notifier.notify({
        title: `JS (${errors.join(', ')})`,
        message,
        wait: true,
        sound: false,
      });

      notifier.on('click', () => false);
    }
  },
  errorHandler: (error, notifyTitle = 'Error occurred') => {
    const err = (error.message) ? error.message : error;

    if (gulpConfigs.testEnv()) {
      console.error(`>>> ${error.name}\r\n${(error.messageFormatted) ? error.messageFormatted : err}`);
      process.exit(1);
    } else {
      notifier.notify({
        title: notifyTitle,
        message: err,
        wait: true,
        sound: false,
      });
    }
  },
};

module.exports = gulpConfigs;
