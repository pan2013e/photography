'use strict';

var gulp = require('gulp');
var imageResize = require('gulp-image-resize');
var sass = require('gulp-sass')(require('sass'));
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var del = require('del');
var fs = require('fs');

gulp.task('delete', function () {
    return del(['images/*.*']);
});

gulp.task('rename-images', async function () {
    await gulp.src(`images_tmp/*.*`)
        .pipe(rename(function (path) {
            var stats = fs.statSync(`images_tmp/${path.basename}${path.extname}`);
            var timestamp = new Date(stats.mtime).getTime();
            var prefix = path.basename.split('-').slice(0, -1).join('-');
            path.basename = `${prefix}-${timestamp}`;
        }))
        .pipe(gulp.dest('images', {overwrite: true}));
    return Promise.resolve();
});

gulp.task('resize-images', function () {
    return gulp.src('images/*.*')
        .pipe(imageResize({
            width: 2048,
            imageMagick: true
        }))
        .pipe(gulp.dest('images/fulls', {overwrite: true}))
        .pipe(imageResize({
            width: 1024,
            imageMagick: true
        }))
        .pipe(gulp.dest('images/thumbs', { overwrite: true}));
});

// compile scss to css
gulp.task('sass', function () {
    return gulp.src('./assets/sass/main.scss')
        .pipe(sass({outputStyle: 'compressed'}).on('error', sass.logError))
        .pipe(rename({basename: 'main.min'}))
        .pipe(gulp.dest('./assets/css'));
});

// watch changes in scss files and run sass task
gulp.task('sass:watch', function () {
    gulp.watch('./assets/sass/**/*.scss', ['sass']);
});

// minify js
gulp.task('minify-js', function () {
    return gulp.src('./assets/js/main.js')
        .pipe(uglify())
        .pipe(rename({basename: 'main.min'}))
        .pipe(gulp.dest('./assets/js'));
});

// build task
gulp.task('build', gulp.series('sass', 'minify-js'));

// resize images
gulp.task('resize', gulp.series('rename-images', 'resize-images', 'delete'));

// default task
gulp.task('default', gulp.series('build', 'resize'));
