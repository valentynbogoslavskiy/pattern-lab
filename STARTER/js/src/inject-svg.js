/**
 * @file inject-svg.js
 *
 * Use svg-injector.js to replace an svg <img> tag with the inline svg.
 */

(function ($, document) {
  $(() => {
    // Elements to inject.
    const mySVGsToInject = document.querySelectorAll('img.inject-me');

    // Do the injection.
    SVGInjector(mySVGsToInject);
  });
}(jQuery, document));
