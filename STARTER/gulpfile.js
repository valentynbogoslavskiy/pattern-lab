/**
 * SETUP
 */
const gulp = require('gulp');
const sourcemaps = require('gulp-sourcemaps');
const watch = require('gulp-watch');
const webpack = require('webpack');
const webpackStream = require('webpack-stream');
const gutil = require('gulp-util');
const glob = require('glob');
const path = require('path');
const plumber = require('gulp-plumber');
const through = require('through2');
// SASS
const sass = require('gulp-sass');
const sassLint = require('gulp-sass-lint');
const autoprefixer = require('gulp-autoprefixer');
const icomoonBuilder = require('gulp-icomoon-builder');
// JS
const eslint = require('gulp-eslint');


/**
 * CONFIGURATION
 */
const configs = require('./gulp-config.js');


/**
 * SCSS TASKS
 */

/**
 * SASS Lint.
 * @param {array} files The array of files paths to lint.
 */
const lintSass = (files) => {
  gulp.src(files)
    .pipe(sassLint({
      configFile: '.scss-lint.yml',
    }))
    .pipe(sassLint.format())
    .pipe(through.obj((file, encoding, cb) => {
      if (file.sassLint.length) {
        configs.notifier.sassLint(file.sassLint);
      }
      cb();
    }));
};

gulp.task('scss-lint', () => {
  lintSass(configs.sassFiles);
});

gulp.task('scss-compile', () => {
  gulp.src(configs.sassFiles)
    .pipe(plumber({
      errorHandler: (error) => {
        configs.notifier.errorHandler(error, 'SCSS Compile Error');
      },
    }))
    .pipe(sourcemaps.init())
    .pipe(sass({
      includePaths: configs.sassIncludePaths,
    }))
    .pipe(autoprefixer(configs.browsersSupport))
    .pipe(sourcemaps.write())
    .pipe(gulp.dest('./css/'));
});


/**
 * JS TASKS
 */

/**
 * JS Lint.
 * @param {array} files The array of files paths to lint.
 */
const lintJs = (files) => {
  gulp.src(files)
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(through.obj((file, encoding, cb) => {
      if (file.eslint) {
        configs.notifier.esLint(file.eslint);
      }
      cb();
    }))
    .pipe((configs.testEnv()) ? eslint.failAfterError() : gutil.noop());
};

gulp.task('js-lint', () => {
  lintJs(configs.allScripts);
});

/**
 * JS Standalone scripts compile.
 * @param {array} files The array of files paths to lint.
 * @return {boolean} false.
 */
const jsStandalone = (files) => {
  configs.webpack.standalone.entry = configs.webpack.standalone.entry || {};
  switch (typeof files) {
    case 'object': {
      files.map((entry) => {
        configs.webpack.standalone.entry[path.basename(entry)] = entry;
        return entry;
      });
      break;
    }
    case 'string': {
      configs.webpack.standalone.entry[path.basename(files)] = files;
      break;
    }
    default: {
      const error = 'Argument "files" in function "jsStandalone" should be string or object';
      configs.notifier.errorHandler(error, 'JS Standalone Compile Error');
      return false;
    }
  }

  gulp.src(configs.standaloneScripts)
    .pipe(plumber({
      errorHandler: (error) => {
        configs.notifier.errorHandler(error, 'JS Standalone Compile Error');
      },
    }))
    .pipe(webpackStream(configs.webpack.standalone), webpack)
    .pipe(gulp.dest(configs.scriptsDist));

  configs.webpack.standalone.entry = {};
};

gulp.task('js-bundle', () => {
  gulp.src('./js/bundle/draft.js')
    .pipe(plumber({
      errorHandler: (error) => {
        configs.notifier.errorHandler(error, 'JS Bundle Compile Error');
      },
    }))
    .pipe(webpackStream(configs.webpack.bundle, webpack))
    .pipe(gulp.dest(configs.scriptsDist));
});
gulp.task('js-standalone', (done) => {
  glob(configs.standaloneScripts, {}, (err, files) => {
    if (err) done(err);
    jsStandalone(files);
    done();
  });
});


/**
 * BUILD FONTS
 */
gulp.task('build-fonts', () => {
  gulp.src(configs.icomoon)
    .pipe(plumber({
      errorHandler: (error) => {
        configs.notifier.errorHandler(error, 'IcoMoon Builder Error');
      },
    }))
    .pipe(icomoonBuilder({
      templateType: 'map',
    }))
    .pipe(gulp.dest('scss/base'));
});


/**
 * TEST
 */
gulp.task('test', () => {
  //process.env.NODE_ENV = 'test';
  gulp.start('scss-lint');
  gulp.start('scss-compile');
  gulp.start('js-lint');
  gulp.start('js-bundle');
  gulp.start('js-standalone');
});


/**
 * WATCHER
 */
gulp.task('watch', () => {
  // SASS Watch
  const watchSass = watch(configs.sassFiles, () => {
    gulp.start('scss-compile');
  });
  watchSass.on('add', (p) => {
    lintSass(p);
  });
  watchSass.on('change', (p) => {
    lintSass(p);
  });

  // JS Watch
  const watchJs = watch(configs.allScripts);
  watchJs.on('add', (p) => {
    lintJs(p);
  });
  watchJs.on('change', (p) => {
    lintJs(p);
  });

  const watchStandaloneScripts = watch(configs.standaloneScripts);
  watchStandaloneScripts.on('add', (p) => {
    jsStandalone(p);
  });
  watchStandaloneScripts.on('change', (p) => {
    jsStandalone([p]);
  });

  watch(configs.bundleScripts, () => {
    gulp.start('js-bundle');
  });

  // Fonts Watch
  watch(configs.icomoon, () => {
    gulp.start('build-fonts');
  });
});


/**
 * DEFAULT
 */
gulp.task('default', ['watch']);
