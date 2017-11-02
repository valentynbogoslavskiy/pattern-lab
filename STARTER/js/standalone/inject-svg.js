/**
 * @file
 * Replaces references to SVG files with full SVG markup inline.
 */

import SVGInjector from 'svg-injector';

(function svgInjector($, Drupal, SvgInjector) {
  /**
   * Replaces images with src or data-src attribute with full SVG markup inline.
   *
   * There are a number of ways to use SVG on a page (object, embed, iframe,
   * img, CSS background-image) but to unlock the full potential of SVG,
   * including full element-level CSS styling and evaluation of embedded
   * JavaScript, the full SVG markup must be included directly in the DOM.
   *
   * Wrangling and maintaining a bunch of inline SVG on your pages isn't
   * anyone's idea of good time, so SVGInjector lets you work with simple img
   * tag elements (or other tag of your choosing) and does the heavy lifting of
   * swapping in the SVG markup inline for you.
   *
   * @type {Drupal~behavior}
   *
   * @prop {Drupal~behaviorAttach} attach
   *   Attaches the behavior for replacing images.
   */
  Drupal.behaviors.svgInjector = {
    attach(context) {
      const elements = $('img.svg-inject', context).once('svg-inject').get();
      SvgInjector(elements);
    },
  };
}(jQuery, Drupal, SVGInjector));
