"use strict";

/************************
 * SETUP
 ************************/
const gulp = require('gulp');
const sourcemaps = require('gulp-sourcemaps');
const notify = require("gulp-notify");
const watch = require('gulp-watch');
const concat = require('gulp-concat');
const rename = require('gulp-rename');
const icomoonBuilder = require('gulp-icomoon-builder');
// SASS
const sass = require('gulp-sass');
const sassLint = require('gulp-sass-lint');
const cleanCss = require('gulp-clean-css');
const autoprefixer = require('gulp-autoprefixer');
// JS
const babel = require('gulp-babel');
const uglify = require('gulp-uglify');
const eslint = require('gulp-eslint');

/************************
 * CONFIGURATION
 ************************/

let paths = {
  bowerDir: './bower_components',
  npmDir: './node_modules',
};

let includePaths = [
  // Add paths to any sass @imports that you will use from bower_components here
  // Adding paths.bowerDir will allow you to target any bower package folder as an include path
  // for generically named assets
  paths.npmDir + '/foundation-sites/scss',
];

let sassdocSrc = [
  './scss/**/*.scss',
];

let scriptsSrc = [
  // add npm components scripts here
  paths.npmDir + '/svg-injector/svg-injector.js',
  paths.npmDir + '/foundation-sites/js/foundation.core.js',
  paths.npmDir + '/foundation-sites/js/foundation.util.mediaQuery.js',

  './js/src/*.js'
];

const configs = {
  icomoon: '/fonts/icomoon/selection.json',
}



/************************
 * TASKS
 ************************/

/************************
 * BUILD FONTS
 ************************/
gulp.task('build-fonts', () => {
  gulp.src(configs.icomoon)
    .pipe(icomoonBuilder({
      templateType: 'map',
    }))
    .on('error', function (error) {
      console.log(error);
      notify().write(error);
    })

    .pipe(gulp.dest('scss/base'))
    .on('error', function (error) {
      console.log(error);
      notify().write(error);
    });
});

// SCSS tasks
gulp.task('scss-lint', () => {
  gulp.src('scss/**/*.s+(a|c)ss')
    .pipe(sassLint())
    .pipe(sassLint.format())
});
gulp.task('styles', () => {
  gulp.src(sassdocSrc)
    .pipe(sourcemaps.init())
    .pipe(
      sass({
        includePaths: includePaths
      })
      // Catch any SCSS errors and prevent them from crashing gulp
      .on('error', function (error) {
        console.error('>>> ERROR', error);
        notify().write(error);
        this.emit('end');
      })
    )
    .pipe(autoprefixer(['last 2 versions', '> 1%', 'ie 11']))
    .pipe(sourcemaps.write())
    .pipe(concat('style.css'))
    .pipe(gulp.dest('./css/'))
    .pipe(cleanCss({
      compatibility: 'ie11'
    }))
    .pipe(rename({
      extname: '.min.css'
    }))
    .pipe(gulp.dest('./css/'))
});
gulp.task('wysiwyg', function() {
  gulp.src('./scss/wysiwyg.scss')
    .pipe(sass({
      includePaths: includePaths
    }))
    // Catch any SCSS errors and prevent them from crashing gulp
    .on('error', function (error) {
      console.error('>>> ERROR', error);
      notify().write(error);
      this.emit('end');
    })
    .pipe(autoprefixer(['last 2 versions']))
    .pipe(concat('wysiwyg.css'))
    .pipe(cleanCss({
      // turn off minifyCss sourcemaps so they don't conflict with gulp-sourcemaps and includePaths
      sourceMap: false
    }))
    .pipe(gulp.dest('./css/dist/'))
});


// JS tasks
gulp.task('js-lint', () => {
    // ESLint ignores files with "node_modules" paths.
    // So, it's best to have gulp ignore the directory as well.
    // Also, Be sure to return the stream from the task;
    // Otherwise, the task may end before the stream has finished.
    return gulp.src(['./js/src/*.js'])
        // eslint() attaches the lint output to the "eslint" property
        // of the file object so it can be used by other modules.
        .pipe(eslint())
        // eslint.format() outputs the lint results to the console.
        // Alternatively use eslint.formatEach() (see Docs).
        .pipe(eslint.format())
        .on('error', notify.onError({ message: 'There is a JS error, please look the console for details'}))
        // To have the process exit with an error code (1) on
        // lint error, return the stream and pipe to failAfterError last.
        .pipe(eslint.failAfterError());
});

gulp.task('scripts', () => {
  gulp.src(scriptsSrc)
    .pipe(sourcemaps.init())
    .pipe(babel({
      presets: ["es2015", "es2016", "es2017"]
    }))
    .on('error', function(error) {
      console.log('>>> ERROR', error);
      notify().write(error);
      this.emit('end');
    })
    .pipe(concat('draft.js'))
    .pipe(sourcemaps.write())
    .pipe(gulp.dest('./js/dist/'))
    .pipe(uglify())
    .pipe(rename({
      extname: '.min.js'
    }))
    .pipe(gulp.dest('./js/dist/'))
});


// Watcher
gulp.task('watch', () => {
  watch(sassdocSrc, () => {
    gulp.start('scss-lint');
    gulp.start('styles');
    gulp.start('wysiwyg');
  });

  watch(scriptsSrc, () => {
    gulp.start('js-lint');
    gulp.start('scripts');
  });
});

gulp.task('default', ['scss-lint', 'styles', 'js-lint', 'scripts']);
