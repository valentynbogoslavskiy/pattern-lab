/**
 * @file inject-svg.js
 *
 * Use svg-injector.js to replace an svg <img> tag with the inline svg.
 */

(function($, document){
  "use strict";

  $(() => {
    // Elements to inject
    let mySVGsToInject = document.querySelectorAll('img.inject-me');

    // Do the injection
    /* global SVGInjector */
    new SVGInjector(mySVGsToInject);
  });

})(jQuery, document);

