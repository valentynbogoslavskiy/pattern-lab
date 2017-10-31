'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

/**
 * SVGInjector v1.1.3 - Fast, caching, dynamic inline SVG DOM injection library
 * https://github.com/iconic/SVGInjector
 *
 * Copyright (c) 2014-2015 Waybury <hello@waybury.com>
 * @license MIT
 */

(function (window, document) {

  'use strict';

  // Environment

  var isLocal = window.location.protocol === 'file:';
  var hasSvgSupport = document.implementation.hasFeature('http://www.w3.org/TR/SVG11/feature#BasicStructure', '1.1');

  function uniqueClasses(list) {
    list = list.split(' ');

    var hash = {};
    var i = list.length;
    var out = [];

    while (i--) {
      if (!hash.hasOwnProperty(list[i])) {
        hash[list[i]] = 1;
        out.unshift(list[i]);
      }
    }

    return out.join(' ');
  }

  /**
   * cache (or polyfill for <= IE8) Array.forEach()
   * source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
   */
  var forEach = Array.prototype.forEach || function (fn, scope) {
    if (this === void 0 || this === null || typeof fn !== 'function') {
      throw new TypeError();
    }

    /* jshint bitwise: false */
    var i,
        len = this.length >>> 0;
    /* jshint bitwise: true */

    for (i = 0; i < len; ++i) {
      if (i in this) {
        fn.call(scope, this[i], i, this);
      }
    }
  };

  // SVG Cache
  var svgCache = {};

  var injectCount = 0;
  var injectedElements = [];

  // Request Queue
  var requestQueue = [];

  // Script running status
  var ranScripts = {};

  var cloneSvg = function cloneSvg(sourceSvg) {
    return sourceSvg.cloneNode(true);
  };

  var queueRequest = function queueRequest(url, callback) {
    requestQueue[url] = requestQueue[url] || [];
    requestQueue[url].push(callback);
  };

  var processRequestQueue = function processRequestQueue(url) {
    for (var i = 0, len = requestQueue[url].length; i < len; i++) {
      // Make these calls async so we avoid blocking the page/renderer
      /* jshint loopfunc: true */
      (function (index) {
        setTimeout(function () {
          requestQueue[url][index](cloneSvg(svgCache[url]));
        }, 0);
      })(i);
      /* jshint loopfunc: false */
    }
  };

  var loadSvg = function loadSvg(url, callback) {
    if (svgCache[url] !== undefined) {
      if (svgCache[url] instanceof SVGSVGElement) {
        // We already have it in cache, so use it
        callback(cloneSvg(svgCache[url]));
      } else {
        // We don't have it in cache yet, but we are loading it, so queue this request
        queueRequest(url, callback);
      }
    } else {

      if (!window.XMLHttpRequest) {
        callback('Browser does not support XMLHttpRequest');
        return false;
      }

      // Seed the cache to indicate we are loading this URL already
      svgCache[url] = {};
      queueRequest(url, callback);

      var httpRequest = new XMLHttpRequest();

      httpRequest.onreadystatechange = function () {
        // readyState 4 = complete
        if (httpRequest.readyState === 4) {

          // Handle status
          if (httpRequest.status === 404 || httpRequest.responseXML === null) {
            callback('Unable to load SVG file: ' + url);

            if (isLocal) callback('Note: SVG injection ajax calls do not work locally without adjusting security setting in your browser. Or consider using a local webserver.');

            callback();
            return false;
          }

          // 200 success from server, or 0 when using file:// protocol locally
          if (httpRequest.status === 200 || isLocal && httpRequest.status === 0) {

            /* globals Document */
            if (httpRequest.responseXML instanceof Document) {
              // Cache it
              svgCache[url] = httpRequest.responseXML.documentElement;
            }
            /* globals -Document */

            // IE9 doesn't create a responseXML Document object from loaded SVG,
            // and throws a "DOM Exception: HIERARCHY_REQUEST_ERR (3)" error when injected.
            //
            // So, we'll just create our own manually via the DOMParser using
            // the the raw XML responseText.
            //
            // :NOTE: IE8 and older doesn't have DOMParser, but they can't do SVG either, so...
            else if (DOMParser && DOMParser instanceof Function) {
                var xmlDoc;
                try {
                  var parser = new DOMParser();
                  xmlDoc = parser.parseFromString(httpRequest.responseText, 'text/xml');
                } catch (e) {
                  xmlDoc = undefined;
                }

                if (!xmlDoc || xmlDoc.getElementsByTagName('parsererror').length) {
                  callback('Unable to parse SVG file: ' + url);
                  return false;
                } else {
                  // Cache it
                  svgCache[url] = xmlDoc.documentElement;
                }
              }

            // We've loaded a new asset, so process any requests waiting for it
            processRequestQueue(url);
          } else {
            callback('There was a problem injecting the SVG: ' + httpRequest.status + ' ' + httpRequest.statusText);
            return false;
          }
        }
      };

      httpRequest.open('GET', url);

      // Treat and parse the response as XML, even if the
      // server sends us a different mimetype
      if (httpRequest.overrideMimeType) httpRequest.overrideMimeType('text/xml');

      httpRequest.send();
    }
  };

  // Inject a single element
  var injectElement = function injectElement(el, evalScripts, pngFallback, callback) {

    // Grab the src or data-src attribute
    var imgUrl = el.getAttribute('data-src') || el.getAttribute('src');

    // We can only inject SVG
    if (!/\.svg/i.test(imgUrl)) {
      callback('Attempted to inject a file with a non-svg extension: ' + imgUrl);
      return;
    }

    // If we don't have SVG support try to fall back to a png,
    // either defined per-element via data-fallback or data-png,
    // or globally via the pngFallback directory setting
    if (!hasSvgSupport) {
      var perElementFallback = el.getAttribute('data-fallback') || el.getAttribute('data-png');

      // Per-element specific PNG fallback defined, so use that
      if (perElementFallback) {
        el.setAttribute('src', perElementFallback);
        callback(null);
      }
      // Global PNG fallback directoriy defined, use the same-named PNG
      else if (pngFallback) {
          el.setAttribute('src', pngFallback + '/' + imgUrl.split('/').pop().replace('.svg', '.png'));
          callback(null);
        }
        // um...
        else {
            callback('This browser does not support SVG and no PNG fallback was defined.');
          }

      return;
    }

    // Make sure we aren't already in the process of injecting this element to
    // avoid a race condition if multiple injections for the same element are run.
    // :NOTE: Using indexOf() only _after_ we check for SVG support and bail,
    // so no need for IE8 indexOf() polyfill
    if (injectedElements.indexOf(el) !== -1) {
      return;
    }

    // Remember the request to inject this element, in case other injection
    // calls are also trying to replace this element before we finish
    injectedElements.push(el);

    // Try to avoid loading the orginal image src if possible.
    el.setAttribute('src', '');

    // Load it up
    loadSvg(imgUrl, function (svg) {

      if (typeof svg === 'undefined' || typeof svg === 'string') {
        callback(svg);
        return false;
      }

      var imgId = el.getAttribute('id');
      if (imgId) {
        svg.setAttribute('id', imgId);
      }

      var imgTitle = el.getAttribute('title');
      if (imgTitle) {
        svg.setAttribute('title', imgTitle);
      }

      // Concat the SVG classes + 'injected-svg' + the img classes
      var classMerge = [].concat(svg.getAttribute('class') || [], 'injected-svg', el.getAttribute('class') || []).join(' ');
      svg.setAttribute('class', uniqueClasses(classMerge));

      var imgStyle = el.getAttribute('style');
      if (imgStyle) {
        svg.setAttribute('style', imgStyle);
      }

      // Copy all the data elements to the svg
      var imgData = [].filter.call(el.attributes, function (at) {
        return (/^data-\w[\w\-]*$/.test(at.name)
        );
      });
      forEach.call(imgData, function (dataAttr) {
        if (dataAttr.name && dataAttr.value) {
          svg.setAttribute(dataAttr.name, dataAttr.value);
        }
      });

      // Make sure any internally referenced clipPath ids and their
      // clip-path references are unique.
      //
      // This addresses the issue of having multiple instances of the
      // same SVG on a page and only the first clipPath id is referenced.
      //
      // Browsers often shortcut the SVG Spec and don't use clipPaths
      // contained in parent elements that are hidden, so if you hide the first
      // SVG instance on the page, then all other instances lose their clipping.
      // Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=376027

      // Handle all defs elements that have iri capable attributes as defined by w3c: http://www.w3.org/TR/SVG/linking.html#processingIRI
      // Mapping IRI addressable elements to the properties that can reference them:
      var iriElementsAndProperties = {
        'clipPath': ['clip-path'],
        'color-profile': ['color-profile'],
        'cursor': ['cursor'],
        'filter': ['filter'],
        'linearGradient': ['fill', 'stroke'],
        'marker': ['marker', 'marker-start', 'marker-mid', 'marker-end'],
        'mask': ['mask'],
        'pattern': ['fill', 'stroke'],
        'radialGradient': ['fill', 'stroke']
      };

      var element, elementDefs, properties, currentId, newId;
      Object.keys(iriElementsAndProperties).forEach(function (key) {
        element = key;
        properties = iriElementsAndProperties[key];

        elementDefs = svg.querySelectorAll('defs ' + element + '[id]');
        for (var i = 0, elementsLen = elementDefs.length; i < elementsLen; i++) {
          currentId = elementDefs[i].id;
          newId = currentId + '-' + injectCount;

          // All of the properties that can reference this element type
          var referencingElements;
          forEach.call(properties, function (property) {
            // :NOTE: using a substring match attr selector here to deal with IE "adding extra quotes in url() attrs"
            referencingElements = svg.querySelectorAll('[' + property + '*="' + currentId + '"]');
            for (var j = 0, referencingElementLen = referencingElements.length; j < referencingElementLen; j++) {
              referencingElements[j].setAttribute(property, 'url(#' + newId + ')');
            }
          });

          elementDefs[i].id = newId;
        }
      });

      // Remove any unwanted/invalid namespaces that might have been added by SVG editing tools
      svg.removeAttribute('xmlns:a');

      // Post page load injected SVGs don't automatically have their script
      // elements run, so we'll need to make that happen, if requested

      // Find then prune the scripts
      var scripts = svg.querySelectorAll('script');
      var scriptsToEval = [];
      var script, scriptType;

      for (var k = 0, scriptsLen = scripts.length; k < scriptsLen; k++) {
        scriptType = scripts[k].getAttribute('type');

        // Only process javascript types.
        // SVG defaults to 'application/ecmascript' for unset types
        if (!scriptType || scriptType === 'application/ecmascript' || scriptType === 'application/javascript') {

          // innerText for IE, textContent for other browsers
          script = scripts[k].innerText || scripts[k].textContent;

          // Stash
          scriptsToEval.push(script);

          // Tidy up and remove the script element since we don't need it anymore
          svg.removeChild(scripts[k]);
        }
      }

      // Run/Eval the scripts if needed
      if (scriptsToEval.length > 0 && (evalScripts === 'always' || evalScripts === 'once' && !ranScripts[imgUrl])) {
        for (var l = 0, scriptsToEvalLen = scriptsToEval.length; l < scriptsToEvalLen; l++) {

          // :NOTE: Yup, this is a form of eval, but it is being used to eval code
          // the caller has explictely asked to be loaded, and the code is in a caller
          // defined SVG file... not raw user input.
          //
          // Also, the code is evaluated in a closure and not in the global scope.
          // If you need to put something in global scope, use 'window'
          new Function(scriptsToEval[l])(window); // jshint ignore:line
        }

        // Remember we already ran scripts for this svg
        ranScripts[imgUrl] = true;
      }

      // :WORKAROUND:
      // IE doesn't evaluate <style> tags in SVGs that are dynamically added to the page.
      // This trick will trigger IE to read and use any existing SVG <style> tags.
      //
      // Reference: https://github.com/iconic/SVGInjector/issues/23
      var styleTags = svg.querySelectorAll('style');
      forEach.call(styleTags, function (styleTag) {
        styleTag.textContent += '';
      });

      // Replace the image with the svg
      el.parentNode.replaceChild(svg, el);

      // Now that we no longer need it, drop references
      // to the original element so it can be GC'd
      delete injectedElements[injectedElements.indexOf(el)];
      el = null;

      // Increment the injected count
      injectCount++;

      callback(svg);
    });
  };

  /**
   * SVGInjector
   *
   * Replace the given elements with their full inline SVG DOM elements.
   *
   * :NOTE: We are using get/setAttribute with SVG because the SVG DOM spec differs from HTML DOM and
   * can return other unexpected object types when trying to directly access svg properties.
   * ex: "className" returns a SVGAnimatedString with the class value found in the "baseVal" property,
   * instead of simple string like with HTML Elements.
   *
   * @param {mixes} Array of or single DOM element
   * @param {object} options
   * @param {function} callback
   * @return {object} Instance of SVGInjector
   */
  var SVGInjector = function SVGInjector(elements, options, done) {

    // Options & defaults
    options = options || {};

    // Should we run the scripts blocks found in the SVG
    // 'always' - Run them every time
    // 'once' - Only run scripts once for each SVG
    // [false|'never'] - Ignore scripts
    var evalScripts = options.evalScripts || 'always';

    // Location of fallback pngs, if desired
    var pngFallback = options.pngFallback || false;

    // Callback to run during each SVG injection, returning the SVG injected
    var eachCallback = options.each;

    // Do the injection...
    if (elements.length !== undefined) {
      var elementsLoaded = 0;
      forEach.call(elements, function (element) {
        injectElement(element, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done && elements.length === ++elementsLoaded) done(elementsLoaded);
        });
      });
    } else {
      if (elements) {
        injectElement(elements, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done) done(1);
          elements = null;
        });
      } else {
        if (done) done(0);
      }
    }
  };

  /* global module, exports: true, define */
  // Node.js or CommonJS
  if ((typeof module === 'undefined' ? 'undefined' : _typeof(module)) === 'object' && _typeof(module.exports) === 'object') {
    module.exports = exports = SVGInjector;
  }
  // AMD support
  else if (typeof define === 'function' && define.amd) {
      define(function () {
        return SVGInjector;
      });
    }
    // Otherwise, attach to window as global
    else if ((typeof window === 'undefined' ? 'undefined' : _typeof(window)) === 'object') {
        window.SVGInjector = SVGInjector;
      }
  /* global -module, -exports, -define */
})(window, document);
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Foundation = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _jquery = require('jquery');

var _jquery2 = _interopRequireDefault(_jquery);

var _foundationUtil = require('./foundation.util.core');

var _foundationUtil2 = require('./foundation.util.mediaQuery');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var FOUNDATION_VERSION = '6.4.1';

// Global Foundation object
// This is attached to the window, or used as a module for AMD/Browserify
var Foundation = {
  version: FOUNDATION_VERSION,

  /**
   * Stores initialized plugins.
   */
  _plugins: {},

  /**
   * Stores generated unique ids for plugin instances
   */
  _uuids: [],

  /**
   * Defines a Foundation plugin, adding it to the `Foundation` namespace and the list of plugins to initialize when reflowing.
   * @param {Object} plugin - The constructor of the plugin.
   */
  plugin: function plugin(_plugin, name) {
    // Object key to use when adding to global Foundation object
    // Examples: Foundation.Reveal, Foundation.OffCanvas
    var className = name || functionName(_plugin);
    // Object key to use when storing the plugin, also used to create the identifying data attribute for the plugin
    // Examples: data-reveal, data-off-canvas
    var attrName = hyphenate(className);

    // Add to the Foundation object and the plugins list (for reflowing)
    this._plugins[attrName] = this[className] = _plugin;
  },
  /**
   * @function
   * Populates the _uuids array with pointers to each individual plugin instance.
   * Adds the `zfPlugin` data-attribute to programmatically created plugins to allow use of $(selector).foundation(method) calls.
   * Also fires the initialization event for each plugin, consolidating repetitive code.
   * @param {Object} plugin - an instance of a plugin, usually `this` in context.
   * @param {String} name - the name of the plugin, passed as a camelCased string.
   * @fires Plugin#init
   */
  registerPlugin: function registerPlugin(plugin, name) {
    var pluginName = name ? hyphenate(name) : functionName(plugin.constructor).toLowerCase();
    plugin.uuid = (0, _foundationUtil.GetYoDigits)(6, pluginName);

    if (!plugin.$element.attr('data-' + pluginName)) {
      plugin.$element.attr('data-' + pluginName, plugin.uuid);
    }
    if (!plugin.$element.data('zfPlugin')) {
      plugin.$element.data('zfPlugin', plugin);
    }
    /**
     * Fires when the plugin has initialized.
     * @event Plugin#init
     */
    plugin.$element.trigger('init.zf.' + pluginName);

    this._uuids.push(plugin.uuid);

    return;
  },
  /**
   * @function
   * Removes the plugins uuid from the _uuids array.
   * Removes the zfPlugin data attribute, as well as the data-plugin-name attribute.
   * Also fires the destroyed event for the plugin, consolidating repetitive code.
   * @param {Object} plugin - an instance of a plugin, usually `this` in context.
   * @fires Plugin#destroyed
   */
  unregisterPlugin: function unregisterPlugin(plugin) {
    var pluginName = hyphenate(functionName(plugin.$element.data('zfPlugin').constructor));

    this._uuids.splice(this._uuids.indexOf(plugin.uuid), 1);
    plugin.$element.removeAttr('data-' + pluginName).removeData('zfPlugin')
    /**
     * Fires when the plugin has been destroyed.
     * @event Plugin#destroyed
     */
    .trigger('destroyed.zf.' + pluginName);
    for (var prop in plugin) {
      plugin[prop] = null; //clean up script to prep for garbage collection.
    }
    return;
  },

  /**
   * @function
   * Causes one or more active plugins to re-initialize, resetting event listeners, recalculating positions, etc.
   * @param {String} plugins - optional string of an individual plugin key, attained by calling `$(element).data('pluginName')`, or string of a plugin class i.e. `'dropdown'`
   * @default If no argument is passed, reflow all currently active plugins.
   */
  reInit: function reInit(plugins) {
    var isJQ = plugins instanceof _jquery2.default;
    try {
      if (isJQ) {
        plugins.each(function () {
          (0, _jquery2.default)(this).data('zfPlugin')._init();
        });
      } else {
        var type = typeof plugins === 'undefined' ? 'undefined' : _typeof(plugins),
            _this = this,
            fns = {
          'object': function object(plgs) {
            plgs.forEach(function (p) {
              p = hyphenate(p);
              (0, _jquery2.default)('[data-' + p + ']').foundation('_init');
            });
          },
          'string': function string() {
            plugins = hyphenate(plugins);
            (0, _jquery2.default)('[data-' + plugins + ']').foundation('_init');
          },
          'undefined': function undefined() {
            this['object'](Object.keys(_this._plugins));
          }
        };
        fns[type](plugins);
      }
    } catch (err) {
      console.error(err);
    } finally {
      return plugins;
    }
  },

  /**
   * Initialize plugins on any elements within `elem` (and `elem` itself) that aren't already initialized.
   * @param {Object} elem - jQuery object containing the element to check inside. Also checks the element itself, unless it's the `document` object.
   * @param {String|Array} plugins - A list of plugins to initialize. Leave this out to initialize everything.
   */
  reflow: function reflow(elem, plugins) {

    // If plugins is undefined, just grab everything
    if (typeof plugins === 'undefined') {
      plugins = Object.keys(this._plugins);
    }
    // If plugins is a string, convert it to an array with one item
    else if (typeof plugins === 'string') {
        plugins = [plugins];
      }

    var _this = this;

    // Iterate through each plugin
    _jquery2.default.each(plugins, function (i, name) {
      // Get the current plugin
      var plugin = _this._plugins[name];

      // Localize the search to all elements inside elem, as well as elem itself, unless elem === document
      var $elem = (0, _jquery2.default)(elem).find('[data-' + name + ']').addBack('[data-' + name + ']');

      // For each plugin found, initialize it
      $elem.each(function () {
        var $el = (0, _jquery2.default)(this),
            opts = {};
        // Don't double-dip on plugins
        if ($el.data('zfPlugin')) {
          console.warn("Tried to initialize " + name + " on an element that already has a Foundation plugin.");
          return;
        }

        if ($el.attr('data-options')) {
          var thing = $el.attr('data-options').split(';').forEach(function (e, i) {
            var opt = e.split(':').map(function (el) {
              return el.trim();
            });
            if (opt[0]) opts[opt[0]] = parseValue(opt[1]);
          });
        }
        try {
          $el.data('zfPlugin', new plugin((0, _jquery2.default)(this), opts));
        } catch (er) {
          console.error(er);
        } finally {
          return;
        }
      });
    });
  },
  getFnName: functionName,

  addToJquery: function addToJquery($) {
    // TODO: consider not making this a jQuery function
    // TODO: need way to reflow vs. re-initialize
    /**
     * The Foundation jQuery method.
     * @param {String|Array} method - An action to perform on the current jQuery object.
     */
    var foundation = function foundation(method) {
      var type = typeof method === 'undefined' ? 'undefined' : _typeof(method),
          $noJS = $('.no-js');

      if ($noJS.length) {
        $noJS.removeClass('no-js');
      }

      if (type === 'undefined') {
        //needs to initialize the Foundation object, or an individual plugin.
        _foundationUtil2.MediaQuery._init();
        Foundation.reflow(this);
      } else if (type === 'string') {
        //an individual method to invoke on a plugin or group of plugins
        var args = Array.prototype.slice.call(arguments, 1); //collect all the arguments, if necessary
        var plugClass = this.data('zfPlugin'); //determine the class of plugin

        if (plugClass !== undefined && plugClass[method] !== undefined) {
          //make sure both the class and method exist
          if (this.length === 1) {
            //if there's only one, call it directly.
            plugClass[method].apply(plugClass, args);
          } else {
            this.each(function (i, el) {
              //otherwise loop through the jQuery collection and invoke the method on each
              plugClass[method].apply($(el).data('zfPlugin'), args);
            });
          }
        } else {
          //error for no class or no method
          throw new ReferenceError("We're sorry, '" + method + "' is not an available method for " + (plugClass ? functionName(plugClass) : 'this element') + '.');
        }
      } else {
        //error for invalid argument type
        throw new TypeError('We\'re sorry, ' + type + ' is not a valid parameter. You must use a string representing the method you wish to invoke.');
      }
      return this;
    };
    $.fn.foundation = foundation;
    return $;
  }
};

Foundation.util = {
  /**
   * Function for applying a debounce effect to a function call.
   * @function
   * @param {Function} func - Function to be called at end of timeout.
   * @param {Number} delay - Time in ms to delay the call of `func`.
   * @returns function
   */
  throttle: function throttle(func, delay) {
    var timer = null;

    return function () {
      var context = this,
          args = arguments;

      if (timer === null) {
        timer = setTimeout(function () {
          func.apply(context, args);
          timer = null;
        }, delay);
      }
    };
  }
};

window.Foundation = Foundation;

// Polyfill for requestAnimationFrame
(function () {
  if (!Date.now || !window.Date.now) window.Date.now = Date.now = function () {
    return new Date().getTime();
  };

  var vendors = ['webkit', 'moz'];
  for (var i = 0; i < vendors.length && !window.requestAnimationFrame; ++i) {
    var vp = vendors[i];
    window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
    window.cancelAnimationFrame = window[vp + 'CancelAnimationFrame'] || window[vp + 'CancelRequestAnimationFrame'];
  }
  if (/iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent) || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
    var lastTime = 0;
    window.requestAnimationFrame = function (callback) {
      var now = Date.now();
      var nextTime = Math.max(lastTime + 16, now);
      return setTimeout(function () {
        callback(lastTime = nextTime);
      }, nextTime - now);
    };
    window.cancelAnimationFrame = clearTimeout;
  }
  /**
   * Polyfill for performance.now, required by rAF
   */
  if (!window.performance || !window.performance.now) {
    window.performance = {
      start: Date.now(),
      now: function now() {
        return Date.now() - this.start;
      }
    };
  }
})();
if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }

    var aArgs = Array.prototype.slice.call(arguments, 1),
        fToBind = this,
        fNOP = function fNOP() {},
        fBound = function fBound() {
      return fToBind.apply(this instanceof fNOP ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
    };

    if (this.prototype) {
      // native functions don't have a prototype
      fNOP.prototype = this.prototype;
    }
    fBound.prototype = new fNOP();

    return fBound;
  };
}
// Polyfill to get the name of a function in IE9
function functionName(fn) {
  if (Function.prototype.name === undefined) {
    var funcNameRegex = /function\s([^(]{1,})\(/;
    var results = funcNameRegex.exec(fn.toString());
    return results && results.length > 1 ? results[1].trim() : "";
  } else if (fn.prototype === undefined) {
    return fn.constructor.name;
  } else {
    return fn.prototype.constructor.name;
  }
}
function parseValue(str) {
  if ('true' === str) return true;else if ('false' === str) return false;else if (!isNaN(str * 1)) return parseFloat(str);
  return str;
}
// Convert PascalCase to kebab-case
// Thank you: http://stackoverflow.com/a/8955580
function hyphenate(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

exports.Foundation = Foundation;
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MediaQuery = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _jquery = require('jquery');

var _jquery2 = _interopRequireDefault(_jquery);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// Default set of media queries
var defaultQueries = {
  'default': 'only screen',
  landscape: 'only screen and (orientation: landscape)',
  portrait: 'only screen and (orientation: portrait)',
  retina: 'only screen and (-webkit-min-device-pixel-ratio: 2),' + 'only screen and (min--moz-device-pixel-ratio: 2),' + 'only screen and (-o-min-device-pixel-ratio: 2/1),' + 'only screen and (min-device-pixel-ratio: 2),' + 'only screen and (min-resolution: 192dpi),' + 'only screen and (min-resolution: 2dppx)'
};

// matchMedia() polyfill - Test a CSS media type/query in JS.
// Authors & copyright (c) 2012: Scott Jehl, Paul Irish, Nicholas Zakas, David Knight. Dual MIT/BSD license
var matchMedia = window.matchMedia || function () {
  'use strict';

  // For browsers that support matchMedium api such as IE 9 and webkit

  var styleMedia = window.styleMedia || window.media;

  // For those that don't support matchMedium
  if (!styleMedia) {
    var style = document.createElement('style'),
        script = document.getElementsByTagName('script')[0],
        info = null;

    style.type = 'text/css';
    style.id = 'matchmediajs-test';

    script && script.parentNode && script.parentNode.insertBefore(style, script);

    // 'style.currentStyle' is used by IE <= 8 and 'window.getComputedStyle' for all other browsers
    info = 'getComputedStyle' in window && window.getComputedStyle(style, null) || style.currentStyle;

    styleMedia = {
      matchMedium: function matchMedium(media) {
        var text = '@media ' + media + '{ #matchmediajs-test { width: 1px; } }';

        // 'style.styleSheet' is used by IE <= 8 and 'style.textContent' for all other browsers
        if (style.styleSheet) {
          style.styleSheet.cssText = text;
        } else {
          style.textContent = text;
        }

        // Test if media query is true or false
        return info.width === '1px';
      }
    };
  }

  return function (media) {
    return {
      matches: styleMedia.matchMedium(media || 'all'),
      media: media || 'all'
    };
  };
}();

var MediaQuery = {
  queries: [],

  current: '',

  /**
   * Initializes the media query helper, by extracting the breakpoint list from the CSS and activating the breakpoint watcher.
   * @function
   * @private
   */
  _init: function _init() {
    var self = this;
    var $meta = (0, _jquery2.default)('meta.foundation-mq');
    if (!$meta.length) {
      (0, _jquery2.default)('<meta class="foundation-mq">').appendTo(document.head);
    }

    var extractedStyles = (0, _jquery2.default)('.foundation-mq').css('font-family');
    var namedQueries;

    namedQueries = parseStyleToObject(extractedStyles);

    for (var key in namedQueries) {
      if (namedQueries.hasOwnProperty(key)) {
        self.queries.push({
          name: key,
          value: 'only screen and (min-width: ' + namedQueries[key] + ')'
        });
      }
    }

    this.current = this._getCurrentSize();

    this._watcher();
  },


  /**
   * Checks if the screen is at least as wide as a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to check.
   * @returns {Boolean} `true` if the breakpoint matches, `false` if it's smaller.
   */
  atLeast: function atLeast(size) {
    var query = this.get(size);

    if (query) {
      return matchMedia(query).matches;
    }

    return false;
  },


  /**
   * Checks if the screen matches to a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to check, either 'small only' or 'small'. Omitting 'only' falls back to using atLeast() method.
   * @returns {Boolean} `true` if the breakpoint matches, `false` if it does not.
   */
  is: function is(size) {
    size = size.trim().split(' ');
    if (size.length > 1 && size[1] === 'only') {
      if (size[0] === this._getCurrentSize()) return true;
    } else {
      return this.atLeast(size[0]);
    }
    return false;
  },


  /**
   * Gets the media query of a breakpoint.
   * @function
   * @param {String} size - Name of the breakpoint to get.
   * @returns {String|null} - The media query of the breakpoint, or `null` if the breakpoint doesn't exist.
   */
  get: function get(size) {
    for (var i in this.queries) {
      if (this.queries.hasOwnProperty(i)) {
        var query = this.queries[i];
        if (size === query.name) return query.value;
      }
    }

    return null;
  },


  /**
   * Gets the current breakpoint name by testing every breakpoint and returning the last one to match (the biggest one).
   * @function
   * @private
   * @returns {String} Name of the current breakpoint.
   */
  _getCurrentSize: function _getCurrentSize() {
    var matched;

    for (var i = 0; i < this.queries.length; i++) {
      var query = this.queries[i];

      if (matchMedia(query.value).matches) {
        matched = query;
      }
    }

    if ((typeof matched === 'undefined' ? 'undefined' : _typeof(matched)) === 'object') {
      return matched.name;
    } else {
      return matched;
    }
  },


  /**
   * Activates the breakpoint watcher, which fires an event on the window whenever the breakpoint changes.
   * @function
   * @private
   */
  _watcher: function _watcher() {
    var _this = this;

    (0, _jquery2.default)(window).off('resize.zf.mediaquery').on('resize.zf.mediaquery', function () {
      var newSize = _this._getCurrentSize(),
          currentSize = _this.current;

      if (newSize !== currentSize) {
        // Change the current media query
        _this.current = newSize;

        // Broadcast the media query change on the window
        (0, _jquery2.default)(window).trigger('changed.zf.mediaquery', [newSize, currentSize]);
      }
    });
  }
};

// Thank you: https://github.com/sindresorhus/query-string
function parseStyleToObject(str) {
  var styleObject = {};

  if (typeof str !== 'string') {
    return styleObject;
  }

  str = str.trim().slice(1, -1); // browsers re-quote string style values

  if (!str) {
    return styleObject;
  }

  styleObject = str.split('&').reduce(function (ret, param) {
    var parts = param.replace(/\+/g, ' ').split('=');
    var key = parts[0];
    var val = parts[1];
    key = decodeURIComponent(key);

    // missing `=` should be `null`:
    // http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
    val = val === undefined ? null : decodeURIComponent(val);

    if (!ret.hasOwnProperty(key)) {
      ret[key] = val;
    } else if (Array.isArray(ret[key])) {
      ret[key].push(val);
    } else {
      ret[key] = [ret[key], val];
    }
    return ret;
  }, {});

  return styleObject;
}

exports.MediaQuery = MediaQuery;
'use strict';

/**
 * @file
 * Replaces references to SVG files with full SVG markup inline.
 */

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
    attach: function attach(context) {
      var elements = $('img.svg-inject', context).once('svg-inject').get();
      SvgInjector(elements);
    }
  };
})(jQuery, Drupal, SVGInjector);
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInN2Zy1pbmplY3Rvci5qcyIsImZvdW5kYXRpb24uY29yZS5qcyIsImZvdW5kYXRpb24udXRpbC5tZWRpYVF1ZXJ5LmpzIiwiaW5qZWN0LXN2Zy5qcyJdLCJuYW1lcyI6WyJ3aW5kb3ciLCJkb2N1bWVudCIsImlzTG9jYWwiLCJsb2NhdGlvbiIsInByb3RvY29sIiwiaGFzU3ZnU3VwcG9ydCIsImltcGxlbWVudGF0aW9uIiwiaGFzRmVhdHVyZSIsInVuaXF1ZUNsYXNzZXMiLCJsaXN0Iiwic3BsaXQiLCJoYXNoIiwiaSIsImxlbmd0aCIsIm91dCIsImhhc093blByb3BlcnR5IiwidW5zaGlmdCIsImpvaW4iLCJmb3JFYWNoIiwiQXJyYXkiLCJwcm90b3R5cGUiLCJmbiIsInNjb3BlIiwiVHlwZUVycm9yIiwibGVuIiwiY2FsbCIsInN2Z0NhY2hlIiwiaW5qZWN0Q291bnQiLCJpbmplY3RlZEVsZW1lbnRzIiwicmVxdWVzdFF1ZXVlIiwicmFuU2NyaXB0cyIsImNsb25lU3ZnIiwic291cmNlU3ZnIiwiY2xvbmVOb2RlIiwicXVldWVSZXF1ZXN0IiwidXJsIiwiY2FsbGJhY2siLCJwdXNoIiwicHJvY2Vzc1JlcXVlc3RRdWV1ZSIsImluZGV4Iiwic2V0VGltZW91dCIsImxvYWRTdmciLCJ1bmRlZmluZWQiLCJTVkdTVkdFbGVtZW50IiwiWE1MSHR0cFJlcXVlc3QiLCJodHRwUmVxdWVzdCIsIm9ucmVhZHlzdGF0ZWNoYW5nZSIsInJlYWR5U3RhdGUiLCJzdGF0dXMiLCJyZXNwb25zZVhNTCIsIkRvY3VtZW50IiwiZG9jdW1lbnRFbGVtZW50IiwiRE9NUGFyc2VyIiwiRnVuY3Rpb24iLCJ4bWxEb2MiLCJwYXJzZXIiLCJwYXJzZUZyb21TdHJpbmciLCJyZXNwb25zZVRleHQiLCJlIiwiZ2V0RWxlbWVudHNCeVRhZ05hbWUiLCJzdGF0dXNUZXh0Iiwib3BlbiIsIm92ZXJyaWRlTWltZVR5cGUiLCJzZW5kIiwiaW5qZWN0RWxlbWVudCIsImVsIiwiZXZhbFNjcmlwdHMiLCJwbmdGYWxsYmFjayIsImltZ1VybCIsImdldEF0dHJpYnV0ZSIsInRlc3QiLCJwZXJFbGVtZW50RmFsbGJhY2siLCJzZXRBdHRyaWJ1dGUiLCJwb3AiLCJyZXBsYWNlIiwiaW5kZXhPZiIsInN2ZyIsImltZ0lkIiwiaW1nVGl0bGUiLCJjbGFzc01lcmdlIiwiY29uY2F0IiwiaW1nU3R5bGUiLCJpbWdEYXRhIiwiZmlsdGVyIiwiYXR0cmlidXRlcyIsImF0IiwibmFtZSIsImRhdGFBdHRyIiwidmFsdWUiLCJpcmlFbGVtZW50c0FuZFByb3BlcnRpZXMiLCJlbGVtZW50IiwiZWxlbWVudERlZnMiLCJwcm9wZXJ0aWVzIiwiY3VycmVudElkIiwibmV3SWQiLCJPYmplY3QiLCJrZXlzIiwia2V5IiwicXVlcnlTZWxlY3RvckFsbCIsImVsZW1lbnRzTGVuIiwiaWQiLCJyZWZlcmVuY2luZ0VsZW1lbnRzIiwicHJvcGVydHkiLCJqIiwicmVmZXJlbmNpbmdFbGVtZW50TGVuIiwicmVtb3ZlQXR0cmlidXRlIiwic2NyaXB0cyIsInNjcmlwdHNUb0V2YWwiLCJzY3JpcHQiLCJzY3JpcHRUeXBlIiwiayIsInNjcmlwdHNMZW4iLCJpbm5lclRleHQiLCJ0ZXh0Q29udGVudCIsInJlbW92ZUNoaWxkIiwibCIsInNjcmlwdHNUb0V2YWxMZW4iLCJzdHlsZVRhZ3MiLCJzdHlsZVRhZyIsInBhcmVudE5vZGUiLCJyZXBsYWNlQ2hpbGQiLCJTVkdJbmplY3RvciIsImVsZW1lbnRzIiwib3B0aW9ucyIsImRvbmUiLCJlYWNoQ2FsbGJhY2siLCJlYWNoIiwiZWxlbWVudHNMb2FkZWQiLCJtb2R1bGUiLCJleHBvcnRzIiwiZGVmaW5lIiwiYW1kIiwiRk9VTkRBVElPTl9WRVJTSU9OIiwiRm91bmRhdGlvbiIsInZlcnNpb24iLCJfcGx1Z2lucyIsIl91dWlkcyIsInBsdWdpbiIsImNsYXNzTmFtZSIsImZ1bmN0aW9uTmFtZSIsImF0dHJOYW1lIiwiaHlwaGVuYXRlIiwicmVnaXN0ZXJQbHVnaW4iLCJwbHVnaW5OYW1lIiwiY29uc3RydWN0b3IiLCJ0b0xvd2VyQ2FzZSIsInV1aWQiLCIkZWxlbWVudCIsImF0dHIiLCJkYXRhIiwidHJpZ2dlciIsInVucmVnaXN0ZXJQbHVnaW4iLCJzcGxpY2UiLCJyZW1vdmVBdHRyIiwicmVtb3ZlRGF0YSIsInByb3AiLCJyZUluaXQiLCJwbHVnaW5zIiwiaXNKUSIsIl9pbml0IiwidHlwZSIsIl90aGlzIiwiZm5zIiwicGxncyIsInAiLCJmb3VuZGF0aW9uIiwiZXJyIiwiY29uc29sZSIsImVycm9yIiwicmVmbG93IiwiZWxlbSIsIiRlbGVtIiwiZmluZCIsImFkZEJhY2siLCIkZWwiLCJvcHRzIiwid2FybiIsInRoaW5nIiwib3B0IiwibWFwIiwidHJpbSIsInBhcnNlVmFsdWUiLCJlciIsImdldEZuTmFtZSIsImFkZFRvSnF1ZXJ5IiwiJCIsIm1ldGhvZCIsIiRub0pTIiwicmVtb3ZlQ2xhc3MiLCJhcmdzIiwic2xpY2UiLCJhcmd1bWVudHMiLCJwbHVnQ2xhc3MiLCJhcHBseSIsIlJlZmVyZW5jZUVycm9yIiwidXRpbCIsInRocm90dGxlIiwiZnVuYyIsImRlbGF5IiwidGltZXIiLCJjb250ZXh0IiwiRGF0ZSIsIm5vdyIsImdldFRpbWUiLCJ2ZW5kb3JzIiwicmVxdWVzdEFuaW1hdGlvbkZyYW1lIiwidnAiLCJjYW5jZWxBbmltYXRpb25GcmFtZSIsIm5hdmlnYXRvciIsInVzZXJBZ2VudCIsImxhc3RUaW1lIiwibmV4dFRpbWUiLCJNYXRoIiwibWF4IiwiY2xlYXJUaW1lb3V0IiwicGVyZm9ybWFuY2UiLCJzdGFydCIsImJpbmQiLCJvVGhpcyIsImFBcmdzIiwiZlRvQmluZCIsImZOT1AiLCJmQm91bmQiLCJmdW5jTmFtZVJlZ2V4IiwicmVzdWx0cyIsImV4ZWMiLCJ0b1N0cmluZyIsInN0ciIsImlzTmFOIiwicGFyc2VGbG9hdCIsImRlZmF1bHRRdWVyaWVzIiwibGFuZHNjYXBlIiwicG9ydHJhaXQiLCJyZXRpbmEiLCJtYXRjaE1lZGlhIiwic3R5bGVNZWRpYSIsIm1lZGlhIiwic3R5bGUiLCJjcmVhdGVFbGVtZW50IiwiaW5mbyIsImluc2VydEJlZm9yZSIsImdldENvbXB1dGVkU3R5bGUiLCJjdXJyZW50U3R5bGUiLCJtYXRjaE1lZGl1bSIsInRleHQiLCJzdHlsZVNoZWV0IiwiY3NzVGV4dCIsIndpZHRoIiwibWF0Y2hlcyIsIk1lZGlhUXVlcnkiLCJxdWVyaWVzIiwiY3VycmVudCIsInNlbGYiLCIkbWV0YSIsImFwcGVuZFRvIiwiaGVhZCIsImV4dHJhY3RlZFN0eWxlcyIsImNzcyIsIm5hbWVkUXVlcmllcyIsInBhcnNlU3R5bGVUb09iamVjdCIsIl9nZXRDdXJyZW50U2l6ZSIsIl93YXRjaGVyIiwiYXRMZWFzdCIsInNpemUiLCJxdWVyeSIsImdldCIsImlzIiwibWF0Y2hlZCIsIm9mZiIsIm9uIiwibmV3U2l6ZSIsImN1cnJlbnRTaXplIiwic3R5bGVPYmplY3QiLCJyZWR1Y2UiLCJyZXQiLCJwYXJhbSIsInBhcnRzIiwidmFsIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwiaXNBcnJheSIsInN2Z0luamVjdG9yIiwiRHJ1cGFsIiwiU3ZnSW5qZWN0b3IiLCJiZWhhdmlvcnMiLCJhdHRhY2giLCJvbmNlIiwialF1ZXJ5Il0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7Ozs7Ozs7O0FBUUMsV0FBVUEsTUFBVixFQUFrQkMsUUFBbEIsRUFBNEI7O0FBRTNCOztBQUVBOztBQUNBLE1BQUlDLFVBQVVGLE9BQU9HLFFBQVAsQ0FBZ0JDLFFBQWhCLEtBQTZCLE9BQTNDO0FBQ0EsTUFBSUMsZ0JBQWdCSixTQUFTSyxjQUFULENBQXdCQyxVQUF4QixDQUFtQyxtREFBbkMsRUFBd0YsS0FBeEYsQ0FBcEI7O0FBRUEsV0FBU0MsYUFBVCxDQUF1QkMsSUFBdkIsRUFBNkI7QUFDM0JBLFdBQU9BLEtBQUtDLEtBQUwsQ0FBVyxHQUFYLENBQVA7O0FBRUEsUUFBSUMsT0FBTyxFQUFYO0FBQ0EsUUFBSUMsSUFBSUgsS0FBS0ksTUFBYjtBQUNBLFFBQUlDLE1BQU0sRUFBVjs7QUFFQSxXQUFPRixH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LEdBbEJhLEVBa0JYLEVBbEJXLENBQWQ7O0FBb0JBLFNBQU9GLFdBQVA7QUFDRDs7UUFFT3ZCLGFBQUFBOzs7QUN6T1I7Ozs7O0FBS0MsVUFBUytCLFdBQVQsQ0FBcUIvRixDQUFyQixFQUF3QmdHLE1BQXhCLEVBQWdDQyxXQUFoQyxFQUE2QztBQUM1Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBa0JBRCxTQUFPRSxTQUFQLENBQWlCSCxXQUFqQixHQUErQjtBQUM3QkksVUFENkIsa0JBQ3RCcEYsT0FEc0IsRUFDYjtBQUNkLFVBQU05RSxXQUFXK0QsRUFBRSxnQkFBRixFQUFvQmUsT0FBcEIsRUFBNkJxRixJQUE3QixDQUFrQyxZQUFsQyxFQUFnRHBCLEdBQWhELEVBQWpCO0FBQ0FpQixrQkFBWWhLLFFBQVo7QUFDRDtBQUo0QixHQUEvQjtBQU1ELENBekJBLEVBeUJDb0ssTUF6QkQsRUF5QlNMLE1BekJULEVBeUJpQmhLLFdBekJqQixDQUFEIiwiZmlsZSI6ImRyYWZ0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTVkdJbmplY3RvciB2MS4xLjMgLSBGYXN0LCBjYWNoaW5nLCBkeW5hbWljIGlubGluZSBTVkcgRE9NIGluamVjdGlvbiBsaWJyYXJ5XG4gKiBodHRwczovL2dpdGh1Yi5jb20vaWNvbmljL1NWR0luamVjdG9yXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LTIwMTUgV2F5YnVyeSA8aGVsbG9Ad2F5YnVyeS5jb20+XG4gKiBAbGljZW5zZSBNSVRcbiAqL1xuXG4oZnVuY3Rpb24gKHdpbmRvdywgZG9jdW1lbnQpIHtcblxuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gRW52aXJvbm1lbnRcbiAgdmFyIGlzTG9jYWwgPSB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wgPT09ICdmaWxlOic7XG4gIHZhciBoYXNTdmdTdXBwb3J0ID0gZG9jdW1lbnQuaW1wbGVtZW50YXRpb24uaGFzRmVhdHVyZSgnaHR0cDovL3d3dy53My5vcmcvVFIvU1ZHMTEvZmVhdHVyZSNCYXNpY1N0cnVjdHVyZScsICcxLjEnKTtcblxuICBmdW5jdGlvbiB1bmlxdWVDbGFzc2VzKGxpc3QpIHtcbiAgICBsaXN0ID0gbGlzdC5zcGxpdCgnICcpO1xuXG4gICAgdmFyIGhhc2ggPSB7fTtcbiAgICB2YXIgaSA9IGxpc3QubGVuZ3RoO1xuICAgIHZhciBvdXQgPSBbXTtcblxuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgIGlmICghaGFzaC5oYXNPd25Qcm9wZXJ0eShsaXN0W2ldKSkge1xuICAgICAgICBoYXNoW2xpc3RbaV1dID0gMTtcbiAgICAgICAgb3V0LnVuc2hpZnQobGlzdFtpXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG91dC5qb2luKCcgJyk7XG4gIH1cblxuICAvKipcbiAgICogY2FjaGUgKG9yIHBvbHlmaWxsIGZvciA8PSBJRTgpIEFycmF5LmZvckVhY2goKVxuICAgKiBzb3VyY2U6IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0FycmF5L2ZvckVhY2hcbiAgICovXG4gIHZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2ggfHwgZnVuY3Rpb24gKGZuLCBzY29wZSkge1xuICAgIGlmICh0aGlzID09PSB2b2lkIDAgfHwgdGhpcyA9PT0gbnVsbCB8fCB0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoKTtcbiAgICB9XG5cbiAgICAvKiBqc2hpbnQgYml0d2lzZTogZmFsc2UgKi9cbiAgICB2YXIgaSwgbGVuID0gdGhpcy5sZW5ndGggPj4+IDA7XG4gICAgLyoganNoaW50IGJpdHdpc2U6IHRydWUgKi9cblxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgICAgaWYgKGkgaW4gdGhpcykge1xuICAgICAgICBmbi5jYWxsKHNjb3BlLCB0aGlzW2ldLCBpLCB0aGlzKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gU1ZHIENhY2hlXG4gIHZhciBzdmdDYWNoZSA9IHt9O1xuXG4gIHZhciBpbmplY3RDb3VudCA9IDA7XG4gIHZhciBpbmplY3RlZEVsZW1lbnRzID0gW107XG5cbiAgLy8gUmVxdWVzdCBRdWV1ZVxuICB2YXIgcmVxdWVzdFF1ZXVlID0gW107XG5cbiAgLy8gU2NyaXB0IHJ1bm5pbmcgc3RhdHVzXG4gIHZhciByYW5TY3JpcHRzID0ge307XG5cbiAgdmFyIGNsb25lU3ZnID0gZnVuY3Rpb24gKHNvdXJjZVN2Zykge1xuICAgIHJldHVybiBzb3VyY2VTdmcuY2xvbmVOb2RlKHRydWUpO1xuICB9O1xuXG4gIHZhciBxdWV1ZVJlcXVlc3QgPSBmdW5jdGlvbiAodXJsLCBjYWxsYmFjaykge1xuICAgIHJlcXVlc3RRdWV1ZVt1cmxdID0gcmVxdWVzdFF1ZXVlW3VybF0gfHwgW107XG4gICAgcmVxdWVzdFF1ZXVlW3VybF0ucHVzaChjYWxsYmFjayk7XG4gIH07XG5cbiAgdmFyIHByb2Nlc3NSZXF1ZXN0UXVldWUgPSBmdW5jdGlvbiAodXJsKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHJlcXVlc3RRdWV1ZVt1cmxdLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAvLyBNYWtlIHRoZXNlIGNhbGxzIGFzeW5jIHNvIHdlIGF2b2lkIGJsb2NraW5nIHRoZSBwYWdlL3JlbmRlcmVyXG4gICAgICAvKiBqc2hpbnQgbG9vcGZ1bmM6IHRydWUgKi9cbiAgICAgIChmdW5jdGlvbiAoaW5kZXgpIHtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmVxdWVzdFF1ZXVlW3VybF1baW5kZXhdKGNsb25lU3ZnKHN2Z0NhY2hlW3VybF0pKTtcbiAgICAgICAgfSwgMCk7XG4gICAgICB9KShpKTtcbiAgICAgIC8qIGpzaGludCBsb29wZnVuYzogZmFsc2UgKi9cbiAgICB9XG4gIH07XG5cbiAgdmFyIGxvYWRTdmcgPSBmdW5jdGlvbiAodXJsLCBjYWxsYmFjaykge1xuICAgIGlmIChzdmdDYWNoZVt1cmxdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChzdmdDYWNoZVt1cmxdIGluc3RhbmNlb2YgU1ZHU1ZHRWxlbWVudCkge1xuICAgICAgICAvLyBXZSBhbHJlYWR5IGhhdmUgaXQgaW4gY2FjaGUsIHNvIHVzZSBpdFxuICAgICAgICBjYWxsYmFjayhjbG9uZVN2ZyhzdmdDYWNoZVt1cmxdKSk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgLy8gV2UgZG9uJ3QgaGF2ZSBpdCBpbiBjYWNoZSB5ZXQsIGJ1dCB3ZSBhcmUgbG9hZGluZyBpdCwgc28gcXVldWUgdGhpcyByZXF1ZXN0XG4gICAgICAgIHF1ZXVlUmVxdWVzdCh1cmwsIGNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG5cbiAgICAgIGlmICghd2luZG93LlhNTEh0dHBSZXF1ZXN0KSB7XG4gICAgICAgIGNhbGxiYWNrKCdCcm93c2VyIGRvZXMgbm90IHN1cHBvcnQgWE1MSHR0cFJlcXVlc3QnKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICAvLyBTZWVkIHRoZSBjYWNoZSB0byBpbmRpY2F0ZSB3ZSBhcmUgbG9hZGluZyB0aGlzIFVSTCBhbHJlYWR5XG4gICAgICBzdmdDYWNoZVt1cmxdID0ge307XG4gICAgICBxdWV1ZVJlcXVlc3QodXJsLCBjYWxsYmFjayk7XG5cbiAgICAgIHZhciBodHRwUmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXG4gICAgICBodHRwUmVxdWVzdC5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJlYWR5U3RhdGUgNCA9IGNvbXBsZXRlXG4gICAgICAgIGlmIChodHRwUmVxdWVzdC5yZWFkeVN0YXRlID09PSA0KSB7XG5cbiAgICAgICAgICAvLyBIYW5kbGUgc3RhdHVzXG4gICAgICAgICAgaWYgKGh0dHBSZXF1ZXN0LnN0YXR1cyA9PT0gNDA0IHx8IGh0dHBSZXF1ZXN0LnJlc3BvbnNlWE1MID09PSBudWxsKSB7XG4gICAgICAgICAgICBjYWxsYmFjaygnVW5hYmxlIHRvIGxvYWQgU1ZHIGZpbGU6ICcgKyB1cmwpO1xuXG4gICAgICAgICAgICBpZiAoaXNMb2NhbCkgY2FsbGJhY2soJ05vdGU6IFNWRyBpbmplY3Rpb24gYWpheCBjYWxscyBkbyBub3Qgd29yayBsb2NhbGx5IHdpdGhvdXQgYWRqdXN0aW5nIHNlY3VyaXR5IHNldHRpbmcgaW4geW91ciBicm93c2VyLiBPciBjb25zaWRlciB1c2luZyBhIGxvY2FsIHdlYnNlcnZlci4nKTtcblxuICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyAyMDAgc3VjY2VzcyBmcm9tIHNlcnZlciwgb3IgMCB3aGVuIHVzaW5nIGZpbGU6Ly8gcHJvdG9jb2wgbG9jYWxseVxuICAgICAgICAgIGlmIChodHRwUmVxdWVzdC5zdGF0dXMgPT09IDIwMCB8fCAoaXNMb2NhbCAmJiBodHRwUmVxdWVzdC5zdGF0dXMgPT09IDApKSB7XG5cbiAgICAgICAgICAgIC8qIGdsb2JhbHMgRG9jdW1lbnQgKi9cbiAgICAgICAgICAgIGlmIChodHRwUmVxdWVzdC5yZXNwb25zZVhNTCBpbnN0YW5jZW9mIERvY3VtZW50KSB7XG4gICAgICAgICAgICAgIC8vIENhY2hlIGl0XG4gICAgICAgICAgICAgIHN2Z0NhY2hlW3VybF0gPSBodHRwUmVxdWVzdC5yZXNwb25zZVhNTC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvKiBnbG9iYWxzIC1Eb2N1bWVudCAqL1xuXG4gICAgICAgICAgICAvLyBJRTkgZG9lc24ndCBjcmVhdGUgYSByZXNwb25zZVhNTCBEb2N1bWVudCBvYmplY3QgZnJvbSBsb2FkZWQgU1ZHLFxuICAgICAgICAgICAgLy8gYW5kIHRocm93cyBhIFwiRE9NIEV4Y2VwdGlvbjogSElFUkFSQ0hZX1JFUVVFU1RfRVJSICgzKVwiIGVycm9yIHdoZW4gaW5qZWN0ZWQuXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gU28sIHdlJ2xsIGp1c3QgY3JlYXRlIG91ciBvd24gbWFudWFsbHkgdmlhIHRoZSBET01QYXJzZXIgdXNpbmdcbiAgICAgICAgICAgIC8vIHRoZSB0aGUgcmF3IFhNTCByZXNwb25zZVRleHQuXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gOk5PVEU6IElFOCBhbmQgb2xkZXIgZG9lc24ndCBoYXZlIERPTVBhcnNlciwgYnV0IHRoZXkgY2FuJ3QgZG8gU1ZHIGVpdGhlciwgc28uLi5cbiAgICAgICAgICAgIGVsc2UgaWYgKERPTVBhcnNlciAmJiAoRE9NUGFyc2VyIGluc3RhbmNlb2YgRnVuY3Rpb24pKSB7XG4gICAgICAgICAgICAgIHZhciB4bWxEb2M7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcnNlciA9IG5ldyBET01QYXJzZXIoKTtcbiAgICAgICAgICAgICAgICB4bWxEb2MgPSBwYXJzZXIucGFyc2VGcm9tU3RyaW5nKGh0dHBSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgJ3RleHQveG1sJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB4bWxEb2MgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAoIXhtbERvYyB8fCB4bWxEb2MuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3BhcnNlcmVycm9yJykubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soJ1VuYWJsZSB0byBwYXJzZSBTVkcgZmlsZTogJyArIHVybCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIENhY2hlIGl0XG4gICAgICAgICAgICAgICAgc3ZnQ2FjaGVbdXJsXSA9IHhtbERvYy5kb2N1bWVudEVsZW1lbnQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gV2UndmUgbG9hZGVkIGEgbmV3IGFzc2V0LCBzbyBwcm9jZXNzIGFueSByZXF1ZXN0cyB3YWl0aW5nIGZvciBpdFxuICAgICAgICAgICAgcHJvY2Vzc1JlcXVlc3RRdWV1ZSh1cmwpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKCdUaGVyZSB3YXMgYSBwcm9ibGVtIGluamVjdGluZyB0aGUgU1ZHOiAnICsgaHR0cFJlcXVlc3Quc3RhdHVzICsgJyAnICsgaHR0cFJlcXVlc3Quc3RhdHVzVGV4dCk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBodHRwUmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwpO1xuXG4gICAgICAvLyBUcmVhdCBhbmQgcGFyc2UgdGhlIHJlc3BvbnNlIGFzIFhNTCwgZXZlbiBpZiB0aGVcbiAgICAgIC8vIHNlcnZlciBzZW5kcyB1cyBhIGRpZmZlcmVudCBtaW1ldHlwZVxuICAgICAgaWYgKGh0dHBSZXF1ZXN0Lm92ZXJyaWRlTWltZVR5cGUpIGh0dHBSZXF1ZXN0Lm92ZXJyaWRlTWltZVR5cGUoJ3RleHQveG1sJyk7XG5cbiAgICAgIGh0dHBSZXF1ZXN0LnNlbmQoKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gSW5qZWN0IGEgc2luZ2xlIGVsZW1lbnRcbiAgdmFyIGluamVjdEVsZW1lbnQgPSBmdW5jdGlvbiAoZWwsIGV2YWxTY3JpcHRzLCBwbmdGYWxsYmFjaywgY2FsbGJhY2spIHtcblxuICAgIC8vIEdyYWIgdGhlIHNyYyBvciBkYXRhLXNyYyBhdHRyaWJ1dGVcbiAgICB2YXIgaW1nVXJsID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLXNyYycpIHx8IGVsLmdldEF0dHJpYnV0ZSgnc3JjJyk7XG5cbiAgICAvLyBXZSBjYW4gb25seSBpbmplY3QgU1ZHXG4gICAgaWYgKCEoL1xcLnN2Zy9pKS50ZXN0KGltZ1VybCkpIHtcbiAgICAgIGNhbGxiYWNrKCdBdHRlbXB0ZWQgdG8gaW5qZWN0IGEgZmlsZSB3aXRoIGEgbm9uLXN2ZyBleHRlbnNpb246ICcgKyBpbWdVcmwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIHdlIGRvbid0IGhhdmUgU1ZHIHN1cHBvcnQgdHJ5IHRvIGZhbGwgYmFjayB0byBhIHBuZyxcbiAgICAvLyBlaXRoZXIgZGVmaW5lZCBwZXItZWxlbWVudCB2aWEgZGF0YS1mYWxsYmFjayBvciBkYXRhLXBuZyxcbiAgICAvLyBvciBnbG9iYWxseSB2aWEgdGhlIHBuZ0ZhbGxiYWNrIGRpcmVjdG9yeSBzZXR0aW5nXG4gICAgaWYgKCFoYXNTdmdTdXBwb3J0KSB7XG4gICAgICB2YXIgcGVyRWxlbWVudEZhbGxiYWNrID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZhbGxiYWNrJykgfHwgZWwuZ2V0QXR0cmlidXRlKCdkYXRhLXBuZycpO1xuXG4gICAgICAvLyBQZXItZWxlbWVudCBzcGVjaWZpYyBQTkcgZmFsbGJhY2sgZGVmaW5lZCwgc28gdXNlIHRoYXRcbiAgICAgIGlmIChwZXJFbGVtZW50RmFsbGJhY2spIHtcbiAgICAgICAgZWwuc2V0QXR0cmlidXRlKCdzcmMnLCBwZXJFbGVtZW50RmFsbGJhY2spO1xuICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgIH1cbiAgICAgIC8vIEdsb2JhbCBQTkcgZmFsbGJhY2sgZGlyZWN0b3JpeSBkZWZpbmVkLCB1c2UgdGhlIHNhbWUtbmFtZWQgUE5HXG4gICAgICBlbHNlIGlmIChwbmdGYWxsYmFjaykge1xuICAgICAgICBlbC5zZXRBdHRyaWJ1dGUoJ3NyYycsIHBuZ0ZhbGxiYWNrICsgJy8nICsgaW1nVXJsLnNwbGl0KCcvJykucG9wKCkucmVwbGFjZSgnLnN2ZycsICcucG5nJykpO1xuICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgIH1cbiAgICAgIC8vIHVtLi4uXG4gICAgICBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soJ1RoaXMgYnJvd3NlciBkb2VzIG5vdCBzdXBwb3J0IFNWRyBhbmQgbm8gUE5HIGZhbGxiYWNrIHdhcyBkZWZpbmVkLicpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTWFrZSBzdXJlIHdlIGFyZW4ndCBhbHJlYWR5IGluIHRoZSBwcm9jZXNzIG9mIGluamVjdGluZyB0aGlzIGVsZW1lbnQgdG9cbiAgICAvLyBhdm9pZCBhIHJhY2UgY29uZGl0aW9uIGlmIG11bHRpcGxlIGluamVjdGlvbnMgZm9yIHRoZSBzYW1lIGVsZW1lbnQgYXJlIHJ1bi5cbiAgICAvLyA6Tk9URTogVXNpbmcgaW5kZXhPZigpIG9ubHkgX2FmdGVyXyB3ZSBjaGVjayBmb3IgU1ZHIHN1cHBvcnQgYW5kIGJhaWwsXG4gICAgLy8gc28gbm8gbmVlZCBmb3IgSUU4IGluZGV4T2YoKSBwb2x5ZmlsbFxuICAgIGlmIChpbmplY3RlZEVsZW1lbnRzLmluZGV4T2YoZWwpICE9PSAtMSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFJlbWVtYmVyIHRoZSByZXF1ZXN0IHRvIGluamVjdCB0aGlzIGVsZW1lbnQsIGluIGNhc2Ugb3RoZXIgaW5qZWN0aW9uXG4gICAgLy8gY2FsbHMgYXJlIGFsc28gdHJ5aW5nIHRvIHJlcGxhY2UgdGhpcyBlbGVtZW50IGJlZm9yZSB3ZSBmaW5pc2hcbiAgICBpbmplY3RlZEVsZW1lbnRzLnB1c2goZWwpO1xuXG4gICAgLy8gVHJ5IHRvIGF2b2lkIGxvYWRpbmcgdGhlIG9yZ2luYWwgaW1hZ2Ugc3JjIGlmIHBvc3NpYmxlLlxuICAgIGVsLnNldEF0dHJpYnV0ZSgnc3JjJywgJycpO1xuXG4gICAgLy8gTG9hZCBpdCB1cFxuICAgIGxvYWRTdmcoaW1nVXJsLCBmdW5jdGlvbiAoc3ZnKSB7XG5cbiAgICAgIGlmICh0eXBlb2Ygc3ZnID09PSAndW5kZWZpbmVkJyB8fCB0eXBlb2Ygc3ZnID09PSAnc3RyaW5nJykge1xuICAgICAgICBjYWxsYmFjayhzdmcpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIHZhciBpbWdJZCA9IGVsLmdldEF0dHJpYnV0ZSgnaWQnKTtcbiAgICAgIGlmIChpbWdJZCkge1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKCdpZCcsIGltZ0lkKTtcbiAgICAgIH1cblxuICAgICAgdmFyIGltZ1RpdGxlID0gZWwuZ2V0QXR0cmlidXRlKCd0aXRsZScpO1xuICAgICAgaWYgKGltZ1RpdGxlKSB7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoJ3RpdGxlJywgaW1nVGl0bGUpO1xuICAgICAgfVxuXG4gICAgICAvLyBDb25jYXQgdGhlIFNWRyBjbGFzc2VzICsgJ2luamVjdGVkLXN2ZycgKyB0aGUgaW1nIGNsYXNzZXNcbiAgICAgIHZhciBjbGFzc01lcmdlID0gW10uY29uY2F0KHN2Zy5nZXRBdHRyaWJ1dGUoJ2NsYXNzJykgfHwgW10sICdpbmplY3RlZC1zdmcnLCBlbC5nZXRBdHRyaWJ1dGUoJ2NsYXNzJykgfHwgW10pLmpvaW4oJyAnKTtcbiAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgdW5pcXVlQ2xhc3NlcyhjbGFzc01lcmdlKSk7XG5cbiAgICAgIHZhciBpbWdTdHlsZSA9IGVsLmdldEF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgIGlmIChpbWdTdHlsZSkge1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKCdzdHlsZScsIGltZ1N0eWxlKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29weSBhbGwgdGhlIGRhdGEgZWxlbWVudHMgdG8gdGhlIHN2Z1xuICAgICAgdmFyIGltZ0RhdGEgPSBbXS5maWx0ZXIuY2FsbChlbC5hdHRyaWJ1dGVzLCBmdW5jdGlvbiAoYXQpIHtcbiAgICAgICAgcmV0dXJuICgvXmRhdGEtXFx3W1xcd1xcLV0qJC8pLnRlc3QoYXQubmFtZSk7XG4gICAgICB9KTtcbiAgICAgIGZvckVhY2guY2FsbChpbWdEYXRhLCBmdW5jdGlvbiAoZGF0YUF0dHIpIHtcbiAgICAgICAgaWYgKGRhdGFBdHRyLm5hbWUgJiYgZGF0YUF0dHIudmFsdWUpIHtcbiAgICAgICAgICBzdmcuc2V0QXR0cmlidXRlKGRhdGFBdHRyLm5hbWUsIGRhdGFBdHRyLnZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIE1ha2Ugc3VyZSBhbnkgaW50ZXJuYWxseSByZWZlcmVuY2VkIGNsaXBQYXRoIGlkcyBhbmQgdGhlaXJcbiAgICAgIC8vIGNsaXAtcGF0aCByZWZlcmVuY2VzIGFyZSB1bmlxdWUuXG4gICAgICAvL1xuICAgICAgLy8gVGhpcyBhZGRyZXNzZXMgdGhlIGlzc3VlIG9mIGhhdmluZyBtdWx0aXBsZSBpbnN0YW5jZXMgb2YgdGhlXG4gICAgICAvLyBzYW1lIFNWRyBvbiBhIHBhZ2UgYW5kIG9ubHkgdGhlIGZpcnN0IGNsaXBQYXRoIGlkIGlzIHJlZmVyZW5jZWQuXG4gICAgICAvL1xuICAgICAgLy8gQnJvd3NlcnMgb2Z0ZW4gc2hvcnRjdXQgdGhlIFNWRyBTcGVjIGFuZCBkb24ndCB1c2UgY2xpcFBhdGhzXG4gICAgICAvLyBjb250YWluZWQgaW4gcGFyZW50IGVsZW1lbnRzIHRoYXQgYXJlIGhpZGRlbiwgc28gaWYgeW91IGhpZGUgdGhlIGZpcnN0XG4gICAgICAvLyBTVkcgaW5zdGFuY2Ugb24gdGhlIHBhZ2UsIHRoZW4gYWxsIG90aGVyIGluc3RhbmNlcyBsb3NlIHRoZWlyIGNsaXBwaW5nLlxuICAgICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0zNzYwMjdcblxuICAgICAgLy8gSGFuZGxlIGFsbCBkZWZzIGVsZW1lbnRzIHRoYXQgaGF2ZSBpcmkgY2FwYWJsZSBhdHRyaWJ1dGVzIGFzIGRlZmluZWQgYnkgdzNjOiBodHRwOi8vd3d3LnczLm9yZy9UUi9TVkcvbGlua2luZy5odG1sI3Byb2Nlc3NpbmdJUklcbiAgICAgIC8vIE1hcHBpbmcgSVJJIGFkZHJlc3NhYmxlIGVsZW1lbnRzIHRvIHRoZSBwcm9wZXJ0aWVzIHRoYXQgY2FuIHJlZmVyZW5jZSB0aGVtOlxuICAgICAgdmFyIGlyaUVsZW1lbnRzQW5kUHJvcGVydGllcyA9IHtcbiAgICAgICAgJ2NsaXBQYXRoJzogWydjbGlwLXBhdGgnXSxcbiAgICAgICAgJ2NvbG9yLXByb2ZpbGUnOiBbJ2NvbG9yLXByb2ZpbGUnXSxcbiAgICAgICAgJ2N1cnNvcic6IFsnY3Vyc29yJ10sXG4gICAgICAgICdmaWx0ZXInOiBbJ2ZpbHRlciddLFxuICAgICAgICAnbGluZWFyR3JhZGllbnQnOiBbJ2ZpbGwnLCAnc3Ryb2tlJ10sXG4gICAgICAgICdtYXJrZXInOiBbJ21hcmtlcicsICdtYXJrZXItc3RhcnQnLCAnbWFya2VyLW1pZCcsICdtYXJrZXItZW5kJ10sXG4gICAgICAgICdtYXNrJzogWydtYXNrJ10sXG4gICAgICAgICdwYXR0ZXJuJzogWydmaWxsJywgJ3N0cm9rZSddLFxuICAgICAgICAncmFkaWFsR3JhZGllbnQnOiBbJ2ZpbGwnLCAnc3Ryb2tlJ11cbiAgICAgIH07XG5cbiAgICAgIHZhciBlbGVtZW50LCBlbGVtZW50RGVmcywgcHJvcGVydGllcywgY3VycmVudElkLCBuZXdJZDtcbiAgICAgIE9iamVjdC5rZXlzKGlyaUVsZW1lbnRzQW5kUHJvcGVydGllcykuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIGVsZW1lbnQgPSBrZXk7XG4gICAgICAgIHByb3BlcnRpZXMgPSBpcmlFbGVtZW50c0FuZFByb3BlcnRpZXNba2V5XTtcblxuICAgICAgICBlbGVtZW50RGVmcyA9IHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCdkZWZzICcgKyBlbGVtZW50ICsgJ1tpZF0nKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGVsZW1lbnRzTGVuID0gZWxlbWVudERlZnMubGVuZ3RoOyBpIDwgZWxlbWVudHNMZW47IGkrKykge1xuICAgICAgICAgIGN1cnJlbnRJZCA9IGVsZW1lbnREZWZzW2ldLmlkO1xuICAgICAgICAgIG5ld0lkID0gY3VycmVudElkICsgJy0nICsgaW5qZWN0Q291bnQ7XG5cbiAgICAgICAgICAvLyBBbGwgb2YgdGhlIHByb3BlcnRpZXMgdGhhdCBjYW4gcmVmZXJlbmNlIHRoaXMgZWxlbWVudCB0eXBlXG4gICAgICAgICAgdmFyIHJlZmVyZW5jaW5nRWxlbWVudHM7XG4gICAgICAgICAgZm9yRWFjaC5jYWxsKHByb3BlcnRpZXMsIGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgLy8gOk5PVEU6IHVzaW5nIGEgc3Vic3RyaW5nIG1hdGNoIGF0dHIgc2VsZWN0b3IgaGVyZSB0byBkZWFsIHdpdGggSUUgXCJhZGRpbmcgZXh0cmEgcXVvdGVzIGluIHVybCgpIGF0dHJzXCJcbiAgICAgICAgICAgIHJlZmVyZW5jaW5nRWxlbWVudHMgPSBzdmcucXVlcnlTZWxlY3RvckFsbCgnWycgKyBwcm9wZXJ0eSArICcqPVwiJyArIGN1cnJlbnRJZCArICdcIl0nKTtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwLCByZWZlcmVuY2luZ0VsZW1lbnRMZW4gPSByZWZlcmVuY2luZ0VsZW1lbnRzLmxlbmd0aDsgaiA8IHJlZmVyZW5jaW5nRWxlbWVudExlbjsgaisrKSB7XG4gICAgICAgICAgICAgIHJlZmVyZW5jaW5nRWxlbWVudHNbal0uc2V0QXR0cmlidXRlKHByb3BlcnR5LCAndXJsKCMnICsgbmV3SWQgKyAnKScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgZWxlbWVudERlZnNbaV0uaWQgPSBuZXdJZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlbW92ZSBhbnkgdW53YW50ZWQvaW52YWxpZCBuYW1lc3BhY2VzIHRoYXQgbWlnaHQgaGF2ZSBiZWVuIGFkZGVkIGJ5IFNWRyBlZGl0aW5nIHRvb2xzXG4gICAgICBzdmcucmVtb3ZlQXR0cmlidXRlKCd4bWxuczphJyk7XG5cbiAgICAgIC8vIFBvc3QgcGFnZSBsb2FkIGluamVjdGVkIFNWR3MgZG9uJ3QgYXV0b21hdGljYWxseSBoYXZlIHRoZWlyIHNjcmlwdFxuICAgICAgLy8gZWxlbWVudHMgcnVuLCBzbyB3ZSdsbCBuZWVkIHRvIG1ha2UgdGhhdCBoYXBwZW4sIGlmIHJlcXVlc3RlZFxuXG4gICAgICAvLyBGaW5kIHRoZW4gcHJ1bmUgdGhlIHNjcmlwdHNcbiAgICAgIHZhciBzY3JpcHRzID0gc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJ3NjcmlwdCcpO1xuICAgICAgdmFyIHNjcmlwdHNUb0V2YWwgPSBbXTtcbiAgICAgIHZhciBzY3JpcHQsIHNjcmlwdFR5cGU7XG5cbiAgICAgIGZvciAodmFyIGsgPSAwLCBzY3JpcHRzTGVuID0gc2NyaXB0cy5sZW5ndGg7IGsgPCBzY3JpcHRzTGVuOyBrKyspIHtcbiAgICAgICAgc2NyaXB0VHlwZSA9IHNjcmlwdHNba10uZ2V0QXR0cmlidXRlKCd0eXBlJyk7XG5cbiAgICAgICAgLy8gT25seSBwcm9jZXNzIGphdmFzY3JpcHQgdHlwZXMuXG4gICAgICAgIC8vIFNWRyBkZWZhdWx0cyB0byAnYXBwbGljYXRpb24vZWNtYXNjcmlwdCcgZm9yIHVuc2V0IHR5cGVzXG4gICAgICAgIGlmICghc2NyaXB0VHlwZSB8fCBzY3JpcHRUeXBlID09PSAnYXBwbGljYXRpb24vZWNtYXNjcmlwdCcgfHwgc2NyaXB0VHlwZSA9PT0gJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnKSB7XG5cbiAgICAgICAgICAvLyBpbm5lclRleHQgZm9yIElFLCB0ZXh0Q29udGVudCBmb3Igb3RoZXIgYnJvd3NlcnNcbiAgICAgICAgICBzY3JpcHQgPSBzY3JpcHRzW2tdLmlubmVyVGV4dCB8fCBzY3JpcHRzW2tdLnRleHRDb250ZW50O1xuXG4gICAgICAgICAgLy8gU3Rhc2hcbiAgICAgICAgICBzY3JpcHRzVG9FdmFsLnB1c2goc2NyaXB0KTtcblxuICAgICAgICAgIC8vIFRpZHkgdXAgYW5kIHJlbW92ZSB0aGUgc2NyaXB0IGVsZW1lbnQgc2luY2Ugd2UgZG9uJ3QgbmVlZCBpdCBhbnltb3JlXG4gICAgICAgICAgc3ZnLnJlbW92ZUNoaWxkKHNjcmlwdHNba10pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFJ1bi9FdmFsIHRoZSBzY3JpcHRzIGlmIG5lZWRlZFxuICAgICAgaWYgKHNjcmlwdHNUb0V2YWwubGVuZ3RoID4gMCAmJiAoZXZhbFNjcmlwdHMgPT09ICdhbHdheXMnIHx8IChldmFsU2NyaXB0cyA9PT0gJ29uY2UnICYmICFyYW5TY3JpcHRzW2ltZ1VybF0pKSkge1xuICAgICAgICBmb3IgKHZhciBsID0gMCwgc2NyaXB0c1RvRXZhbExlbiA9IHNjcmlwdHNUb0V2YWwubGVuZ3RoOyBsIDwgc2NyaXB0c1RvRXZhbExlbjsgbCsrKSB7XG5cbiAgICAgICAgICAvLyA6Tk9URTogWXVwLCB0aGlzIGlzIGEgZm9ybSBvZiBldmFsLCBidXQgaXQgaXMgYmVpbmcgdXNlZCB0byBldmFsIGNvZGVcbiAgICAgICAgICAvLyB0aGUgY2FsbGVyIGhhcyBleHBsaWN0ZWx5IGFza2VkIHRvIGJlIGxvYWRlZCwgYW5kIHRoZSBjb2RlIGlzIGluIGEgY2FsbGVyXG4gICAgICAgICAgLy8gZGVmaW5lZCBTVkcgZmlsZS4uLiBub3QgcmF3IHVzZXIgaW5wdXQuXG4gICAgICAgICAgLy9cbiAgICAgICAgICAvLyBBbHNvLCB0aGUgY29kZSBpcyBldmFsdWF0ZWQgaW4gYSBjbG9zdXJlIGFuZCBub3QgaW4gdGhlIGdsb2JhbCBzY29wZS5cbiAgICAgICAgICAvLyBJZiB5b3UgbmVlZCB0byBwdXQgc29tZXRoaW5nIGluIGdsb2JhbCBzY29wZSwgdXNlICd3aW5kb3cnXG4gICAgICAgICAgbmV3IEZ1bmN0aW9uKHNjcmlwdHNUb0V2YWxbbF0pKHdpbmRvdyk7IC8vIGpzaGludCBpZ25vcmU6bGluZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVtZW1iZXIgd2UgYWxyZWFkeSByYW4gc2NyaXB0cyBmb3IgdGhpcyBzdmdcbiAgICAgICAgcmFuU2NyaXB0c1tpbWdVcmxdID0gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgLy8gOldPUktBUk9VTkQ6XG4gICAgICAvLyBJRSBkb2Vzbid0IGV2YWx1YXRlIDxzdHlsZT4gdGFncyBpbiBTVkdzIHRoYXQgYXJlIGR5bmFtaWNhbGx5IGFkZGVkIHRvIHRoZSBwYWdlLlxuICAgICAgLy8gVGhpcyB0cmljayB3aWxsIHRyaWdnZXIgSUUgdG8gcmVhZCBhbmQgdXNlIGFueSBleGlzdGluZyBTVkcgPHN0eWxlPiB0YWdzLlxuICAgICAgLy9cbiAgICAgIC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9naXRodWIuY29tL2ljb25pYy9TVkdJbmplY3Rvci9pc3N1ZXMvMjNcbiAgICAgIHZhciBzdHlsZVRhZ3MgPSBzdmcucXVlcnlTZWxlY3RvckFsbCgnc3R5bGUnKTtcbiAgICAgIGZvckVhY2guY2FsbChzdHlsZVRhZ3MsIGZ1bmN0aW9uIChzdHlsZVRhZykge1xuICAgICAgICBzdHlsZVRhZy50ZXh0Q29udGVudCArPSAnJztcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZXBsYWNlIHRoZSBpbWFnZSB3aXRoIHRoZSBzdmdcbiAgICAgIGVsLnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKHN2ZywgZWwpO1xuXG4gICAgICAvLyBOb3cgdGhhdCB3ZSBubyBsb25nZXIgbmVlZCBpdCwgZHJvcCByZWZlcmVuY2VzXG4gICAgICAvLyB0byB0aGUgb3JpZ2luYWwgZWxlbWVudCBzbyBpdCBjYW4gYmUgR0MnZFxuICAgICAgZGVsZXRlIGluamVjdGVkRWxlbWVudHNbaW5qZWN0ZWRFbGVtZW50cy5pbmRleE9mKGVsKV07XG4gICAgICBlbCA9IG51bGw7XG5cbiAgICAgIC8vIEluY3JlbWVudCB0aGUgaW5qZWN0ZWQgY291bnRcbiAgICAgIGluamVjdENvdW50Kys7XG5cbiAgICAgIGNhbGxiYWNrKHN2Zyk7XG4gICAgfSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFNWR0luamVjdG9yXG4gICAqXG4gICAqIFJlcGxhY2UgdGhlIGdpdmVuIGVsZW1lbnRzIHdpdGggdGhlaXIgZnVsbCBpbmxpbmUgU1ZHIERPTSBlbGVtZW50cy5cbiAgICpcbiAgICogOk5PVEU6IFdlIGFyZSB1c2luZyBnZXQvc2V0QXR0cmlidXRlIHdpdGggU1ZHIGJlY2F1c2UgdGhlIFNWRyBET00gc3BlYyBkaWZmZXJzIGZyb20gSFRNTCBET00gYW5kXG4gICAqIGNhbiByZXR1cm4gb3RoZXIgdW5leHBlY3RlZCBvYmplY3QgdHlwZXMgd2hlbiB0cnlpbmcgdG8gZGlyZWN0bHkgYWNjZXNzIHN2ZyBwcm9wZXJ0aWVzLlxuICAgKiBleDogXCJjbGFzc05hbWVcIiByZXR1cm5zIGEgU1ZHQW5pbWF0ZWRTdHJpbmcgd2l0aCB0aGUgY2xhc3MgdmFsdWUgZm91bmQgaW4gdGhlIFwiYmFzZVZhbFwiIHByb3BlcnR5LFxuICAgKiBpbnN0ZWFkIG9mIHNpbXBsZSBzdHJpbmcgbGlrZSB3aXRoIEhUTUwgRWxlbWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSB7bWl4ZXN9IEFycmF5IG9mIG9yIHNpbmdsZSBET00gZWxlbWVudFxuICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9uc1xuICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFja1xuICAgKiBAcmV0dXJuIHtvYmplY3R9IEluc3RhbmNlIG9mIFNWR0luamVjdG9yXG4gICAqL1xuICB2YXIgU1ZHSW5qZWN0b3IgPSBmdW5jdGlvbiAoZWxlbWVudHMsIG9wdGlvbnMsIGRvbmUpIHtcblxuICAgIC8vIE9wdGlvbnMgJiBkZWZhdWx0c1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgLy8gU2hvdWxkIHdlIHJ1biB0aGUgc2NyaXB0cyBibG9ja3MgZm91bmQgaW4gdGhlIFNWR1xuICAgIC8vICdhbHdheXMnIC0gUnVuIHRoZW0gZXZlcnkgdGltZVxuICAgIC8vICdvbmNlJyAtIE9ubHkgcnVuIHNjcmlwdHMgb25jZSBmb3IgZWFjaCBTVkdcbiAgICAvLyBbZmFsc2V8J25ldmVyJ10gLSBJZ25vcmUgc2NyaXB0c1xuICAgIHZhciBldmFsU2NyaXB0cyA9IG9wdGlvbnMuZXZhbFNjcmlwdHMgfHwgJ2Fsd2F5cyc7XG5cbiAgICAvLyBMb2NhdGlvbiBvZiBmYWxsYmFjayBwbmdzLCBpZiBkZXNpcmVkXG4gICAgdmFyIHBuZ0ZhbGxiYWNrID0gb3B0aW9ucy5wbmdGYWxsYmFjayB8fCBmYWxzZTtcblxuICAgIC8vIENhbGxiYWNrIHRvIHJ1biBkdXJpbmcgZWFjaCBTVkcgaW5qZWN0aW9uLCByZXR1cm5pbmcgdGhlIFNWRyBpbmplY3RlZFxuICAgIHZhciBlYWNoQ2FsbGJhY2sgPSBvcHRpb25zLmVhY2g7XG5cbiAgICAvLyBEbyB0aGUgaW5qZWN0aW9uLi4uXG4gICAgaWYgKGVsZW1lbnRzLmxlbmd0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB2YXIgZWxlbWVudHNMb2FkZWQgPSAwO1xuICAgICAgZm9yRWFjaC5jYWxsKGVsZW1lbnRzLCBmdW5jdGlvbiAoZWxlbWVudCkge1xuICAgICAgICBpbmplY3RFbGVtZW50KGVsZW1lbnQsIGV2YWxTY3JpcHRzLCBwbmdGYWxsYmFjaywgZnVuY3Rpb24gKHN2Zykge1xuICAgICAgICAgIGlmIChlYWNoQ2FsbGJhY2sgJiYgdHlwZW9mIGVhY2hDYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgZWFjaENhbGxiYWNrKHN2Zyk7XG4gICAgICAgICAgaWYgKGRvbmUgJiYgZWxlbWVudHMubGVuZ3RoID09PSArK2VsZW1lbnRzTG9hZGVkKSBkb25lKGVsZW1lbnRzTG9hZGVkKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBpZiAoZWxlbWVudHMpIHtcbiAgICAgICAgaW5qZWN0RWxlbWVudChlbGVtZW50cywgZXZhbFNjcmlwdHMsIHBuZ0ZhbGxiYWNrLCBmdW5jdGlvbiAoc3ZnKSB7XG4gICAgICAgICAgaWYgKGVhY2hDYWxsYmFjayAmJiB0eXBlb2YgZWFjaENhbGxiYWNrID09PSAnZnVuY3Rpb24nKSBlYWNoQ2FsbGJhY2soc3ZnKTtcbiAgICAgICAgICBpZiAoZG9uZSkgZG9uZSgxKTtcbiAgICAgICAgICBlbGVtZW50cyA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGlmIChkb25lKSBkb25lKDApO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICAvKiBnbG9iYWwgbW9kdWxlLCBleHBvcnRzOiB0cnVlLCBkZWZpbmUgKi9cbiAgLy8gTm9kZS5qcyBvciBDb21tb25KU1xuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0Jykge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IFNWR0luamVjdG9yO1xuICB9XG4gIC8vIEFNRCBzdXBwb3J0XG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZShmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gU1ZHSW5qZWN0b3I7XG4gICAgfSk7XG4gIH1cbiAgLy8gT3RoZXJ3aXNlLCBhdHRhY2ggdG8gd2luZG93IGFzIGdsb2JhbFxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0Jykge1xuICAgIHdpbmRvdy5TVkdJbmplY3RvciA9IFNWR0luamVjdG9yO1xuICB9XG4gIC8qIGdsb2JhbCAtbW9kdWxlLCAtZXhwb3J0cywgLWRlZmluZSAqL1xuXG59KHdpbmRvdywgZG9jdW1lbnQpKTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG5pbXBvcnQgJCBmcm9tICdqcXVlcnknO1xuaW1wb3J0IHsgR2V0WW9EaWdpdHMgfSBmcm9tICcuL2ZvdW5kYXRpb24udXRpbC5jb3JlJztcbmltcG9ydCB7IE1lZGlhUXVlcnkgfSBmcm9tICcuL2ZvdW5kYXRpb24udXRpbC5tZWRpYVF1ZXJ5JztcblxudmFyIEZPVU5EQVRJT05fVkVSU0lPTiA9ICc2LjQuMSc7XG5cbi8vIEdsb2JhbCBGb3VuZGF0aW9uIG9iamVjdFxuLy8gVGhpcyBpcyBhdHRhY2hlZCB0byB0aGUgd2luZG93LCBvciB1c2VkIGFzIGEgbW9kdWxlIGZvciBBTUQvQnJvd3NlcmlmeVxudmFyIEZvdW5kYXRpb24gPSB7XG4gIHZlcnNpb246IEZPVU5EQVRJT05fVkVSU0lPTixcblxuICAvKipcbiAgICogU3RvcmVzIGluaXRpYWxpemVkIHBsdWdpbnMuXG4gICAqL1xuICBfcGx1Z2luczoge30sXG5cbiAgLyoqXG4gICAqIFN0b3JlcyBnZW5lcmF0ZWQgdW5pcXVlIGlkcyBmb3IgcGx1Z2luIGluc3RhbmNlc1xuICAgKi9cbiAgX3V1aWRzOiBbXSxcblxuICAvKipcbiAgICogRGVmaW5lcyBhIEZvdW5kYXRpb24gcGx1Z2luLCBhZGRpbmcgaXQgdG8gdGhlIGBGb3VuZGF0aW9uYCBuYW1lc3BhY2UgYW5kIHRoZSBsaXN0IG9mIHBsdWdpbnMgdG8gaW5pdGlhbGl6ZSB3aGVuIHJlZmxvd2luZy5cbiAgICogQHBhcmFtIHtPYmplY3R9IHBsdWdpbiAtIFRoZSBjb25zdHJ1Y3RvciBvZiB0aGUgcGx1Z2luLlxuICAgKi9cbiAgcGx1Z2luOiBmdW5jdGlvbihwbHVnaW4sIG5hbWUpIHtcbiAgICAvLyBPYmplY3Qga2V5IHRvIHVzZSB3aGVuIGFkZGluZyB0byBnbG9iYWwgRm91bmRhdGlvbiBvYmplY3RcbiAgICAvLyBFeGFtcGxlczogRm91bmRhdGlvbi5SZXZlYWwsIEZvdW5kYXRpb24uT2ZmQ2FudmFzXG4gICAgdmFyIGNsYXNzTmFtZSA9IChuYW1lIHx8IGZ1bmN0aW9uTmFtZShwbHVnaW4pKTtcbiAgICAvLyBPYmplY3Qga2V5IHRvIHVzZSB3aGVuIHN0b3JpbmcgdGhlIHBsdWdpbiwgYWxzbyB1c2VkIHRvIGNyZWF0ZSB0aGUgaWRlbnRpZnlpbmcgZGF0YSBhdHRyaWJ1dGUgZm9yIHRoZSBwbHVnaW5cbiAgICAvLyBFeGFtcGxlczogZGF0YS1yZXZlYWwsIGRhdGEtb2ZmLWNhbnZhc1xuICAgIHZhciBhdHRyTmFtZSAgPSBoeXBoZW5hdGUoY2xhc3NOYW1lKTtcblxuICAgIC8vIEFkZCB0byB0aGUgRm91bmRhdGlvbiBvYmplY3QgYW5kIHRoZSBwbHVnaW5zIGxpc3QgKGZvciByZWZsb3dpbmcpXG4gICAgdGhpcy5fcGx1Z2luc1thdHRyTmFtZV0gPSB0aGlzW2NsYXNzTmFtZV0gPSBwbHVnaW47XG4gIH0sXG4gIC8qKlxuICAgKiBAZnVuY3Rpb25cbiAgICogUG9wdWxhdGVzIHRoZSBfdXVpZHMgYXJyYXkgd2l0aCBwb2ludGVycyB0byBlYWNoIGluZGl2aWR1YWwgcGx1Z2luIGluc3RhbmNlLlxuICAgKiBBZGRzIHRoZSBgemZQbHVnaW5gIGRhdGEtYXR0cmlidXRlIHRvIHByb2dyYW1tYXRpY2FsbHkgY3JlYXRlZCBwbHVnaW5zIHRvIGFsbG93IHVzZSBvZiAkKHNlbGVjdG9yKS5mb3VuZGF0aW9uKG1ldGhvZCkgY2FsbHMuXG4gICAqIEFsc28gZmlyZXMgdGhlIGluaXRpYWxpemF0aW9uIGV2ZW50IGZvciBlYWNoIHBsdWdpbiwgY29uc29saWRhdGluZyByZXBldGl0aXZlIGNvZGUuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwbHVnaW4gLSBhbiBpbnN0YW5jZSBvZiBhIHBsdWdpbiwgdXN1YWxseSBgdGhpc2AgaW4gY29udGV4dC5cbiAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgLSB0aGUgbmFtZSBvZiB0aGUgcGx1Z2luLCBwYXNzZWQgYXMgYSBjYW1lbENhc2VkIHN0cmluZy5cbiAgICogQGZpcmVzIFBsdWdpbiNpbml0XG4gICAqL1xuICByZWdpc3RlclBsdWdpbjogZnVuY3Rpb24ocGx1Z2luLCBuYW1lKXtcbiAgICB2YXIgcGx1Z2luTmFtZSA9IG5hbWUgPyBoeXBoZW5hdGUobmFtZSkgOiBmdW5jdGlvbk5hbWUocGx1Z2luLmNvbnN0cnVjdG9yKS50b0xvd2VyQ2FzZSgpO1xuICAgIHBsdWdpbi51dWlkID0gR2V0WW9EaWdpdHMoNiwgcGx1Z2luTmFtZSk7XG5cbiAgICBpZighcGx1Z2luLiRlbGVtZW50LmF0dHIoYGRhdGEtJHtwbHVnaW5OYW1lfWApKXsgcGx1Z2luLiRlbGVtZW50LmF0dHIoYGRhdGEtJHtwbHVnaW5OYW1lfWAsIHBsdWdpbi51dWlkKTsgfVxuICAgIGlmKCFwbHVnaW4uJGVsZW1lbnQuZGF0YSgnemZQbHVnaW4nKSl7IHBsdWdpbi4kZWxlbWVudC5kYXRhKCd6ZlBsdWdpbicsIHBsdWdpbik7IH1cbiAgICAgICAgICAvKipcbiAgICAgICAgICAgKiBGaXJlcyB3aGVuIHRoZSBwbHVnaW4gaGFzIGluaXRpYWxpemVkLlxuICAgICAgICAgICAqIEBldmVudCBQbHVnaW4jaW5pdFxuICAgICAgICAgICAqL1xuICAgIHBsdWdpbi4kZWxlbWVudC50cmlnZ2VyKGBpbml0LnpmLiR7cGx1Z2luTmFtZX1gKTtcblxuICAgIHRoaXMuX3V1aWRzLnB1c2gocGx1Z2luLnV1aWQpO1xuXG4gICAgcmV0dXJuO1xuICB9LFxuICAvKipcbiAgICogQGZ1bmN0aW9uXG4gICAqIFJlbW92ZXMgdGhlIHBsdWdpbnMgdXVpZCBmcm9tIHRoZSBfdXVpZHMgYXJyYXkuXG4gICAqIFJlbW92ZXMgdGhlIHpmUGx1Z2luIGRhdGEgYXR0cmlidXRlLCBhcyB3ZWxsIGFzIHRoZSBkYXRhLXBsdWdpbi1uYW1lIGF0dHJpYnV0ZS5cbiAgICogQWxzbyBmaXJlcyB0aGUgZGVzdHJveWVkIGV2ZW50IGZvciB0aGUgcGx1Z2luLCBjb25zb2xpZGF0aW5nIHJlcGV0aXRpdmUgY29kZS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHBsdWdpbiAtIGFuIGluc3RhbmNlIG9mIGEgcGx1Z2luLCB1c3VhbGx5IGB0aGlzYCBpbiBjb250ZXh0LlxuICAgKiBAZmlyZXMgUGx1Z2luI2Rlc3Ryb3llZFxuICAgKi9cbiAgdW5yZWdpc3RlclBsdWdpbjogZnVuY3Rpb24ocGx1Z2luKXtcbiAgICB2YXIgcGx1Z2luTmFtZSA9IGh5cGhlbmF0ZShmdW5jdGlvbk5hbWUocGx1Z2luLiRlbGVtZW50LmRhdGEoJ3pmUGx1Z2luJykuY29uc3RydWN0b3IpKTtcblxuICAgIHRoaXMuX3V1aWRzLnNwbGljZSh0aGlzLl91dWlkcy5pbmRleE9mKHBsdWdpbi51dWlkKSwgMSk7XG4gICAgcGx1Z2luLiRlbGVtZW50LnJlbW92ZUF0dHIoYGRhdGEtJHtwbHVnaW5OYW1lfWApLnJlbW92ZURhdGEoJ3pmUGx1Z2luJylcbiAgICAgICAgICAvKipcbiAgICAgICAgICAgKiBGaXJlcyB3aGVuIHRoZSBwbHVnaW4gaGFzIGJlZW4gZGVzdHJveWVkLlxuICAgICAgICAgICAqIEBldmVudCBQbHVnaW4jZGVzdHJveWVkXG4gICAgICAgICAgICovXG4gICAgICAgICAgLnRyaWdnZXIoYGRlc3Ryb3llZC56Zi4ke3BsdWdpbk5hbWV9YCk7XG4gICAgZm9yKHZhciBwcm9wIGluIHBsdWdpbil7XG4gICAgICBwbHVnaW5bcHJvcF0gPSBudWxsOy8vY2xlYW4gdXAgc2NyaXB0IHRvIHByZXAgZm9yIGdhcmJhZ2UgY29sbGVjdGlvbi5cbiAgICB9XG4gICAgcmV0dXJuO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb25cbiAgICogQ2F1c2VzIG9uZSBvciBtb3JlIGFjdGl2ZSBwbHVnaW5zIHRvIHJlLWluaXRpYWxpemUsIHJlc2V0dGluZyBldmVudCBsaXN0ZW5lcnMsIHJlY2FsY3VsYXRpbmcgcG9zaXRpb25zLCBldGMuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwbHVnaW5zIC0gb3B0aW9uYWwgc3RyaW5nIG9mIGFuIGluZGl2aWR1YWwgcGx1Z2luIGtleSwgYXR0YWluZWQgYnkgY2FsbGluZyBgJChlbGVtZW50KS5kYXRhKCdwbHVnaW5OYW1lJylgLCBvciBzdHJpbmcgb2YgYSBwbHVnaW4gY2xhc3MgaS5lLiBgJ2Ryb3Bkb3duJ2BcbiAgICogQGRlZmF1bHQgSWYgbm8gYXJndW1lbnQgaXMgcGFzc2VkLCByZWZsb3cgYWxsIGN1cnJlbnRseSBhY3RpdmUgcGx1Z2lucy5cbiAgICovXG4gICByZUluaXQ6IGZ1bmN0aW9uKHBsdWdpbnMpe1xuICAgICB2YXIgaXNKUSA9IHBsdWdpbnMgaW5zdGFuY2VvZiAkO1xuICAgICB0cnl7XG4gICAgICAgaWYoaXNKUSl7XG4gICAgICAgICBwbHVnaW5zLmVhY2goZnVuY3Rpb24oKXtcbiAgICAgICAgICAgJCh0aGlzKS5kYXRhKCd6ZlBsdWdpbicpLl9pbml0KCk7XG4gICAgICAgICB9KTtcbiAgICAgICB9ZWxzZXtcbiAgICAgICAgIHZhciB0eXBlID0gdHlwZW9mIHBsdWdpbnMsXG4gICAgICAgICBfdGhpcyA9IHRoaXMsXG4gICAgICAgICBmbnMgPSB7XG4gICAgICAgICAgICdvYmplY3QnOiBmdW5jdGlvbihwbGdzKXtcbiAgICAgICAgICAgICBwbGdzLmZvckVhY2goZnVuY3Rpb24ocCl7XG4gICAgICAgICAgICAgICBwID0gaHlwaGVuYXRlKHApO1xuICAgICAgICAgICAgICAgJCgnW2RhdGEtJysgcCArJ10nKS5mb3VuZGF0aW9uKCdfaW5pdCcpO1xuICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICB9LFxuICAgICAgICAgICAnc3RyaW5nJzogZnVuY3Rpb24oKXtcbiAgICAgICAgICAgICBwbHVnaW5zID0gaHlwaGVuYXRlKHBsdWdpbnMpO1xuICAgICAgICAgICAgICQoJ1tkYXRhLScrIHBsdWdpbnMgKyddJykuZm91bmRhdGlvbignX2luaXQnKTtcbiAgICAgICAgICAgfSxcbiAgICAgICAgICAgJ3VuZGVmaW5lZCc6IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICAgdGhpc1snb2JqZWN0J10oT2JqZWN0LmtleXMoX3RoaXMuX3BsdWdpbnMpKTtcbiAgICAgICAgICAgfVxuICAgICAgICAgfTtcbiAgICAgICAgIGZuc1t0eXBlXShwbHVnaW5zKTtcbiAgICAgICB9XG4gICAgIH1jYXRjaChlcnIpe1xuICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgfWZpbmFsbHl7XG4gICAgICAgcmV0dXJuIHBsdWdpbnM7XG4gICAgIH1cbiAgIH0sXG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgcGx1Z2lucyBvbiBhbnkgZWxlbWVudHMgd2l0aGluIGBlbGVtYCAoYW5kIGBlbGVtYCBpdHNlbGYpIHRoYXQgYXJlbid0IGFscmVhZHkgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBlbGVtIC0galF1ZXJ5IG9iamVjdCBjb250YWluaW5nIHRoZSBlbGVtZW50IHRvIGNoZWNrIGluc2lkZS4gQWxzbyBjaGVja3MgdGhlIGVsZW1lbnQgaXRzZWxmLCB1bmxlc3MgaXQncyB0aGUgYGRvY3VtZW50YCBvYmplY3QuXG4gICAqIEBwYXJhbSB7U3RyaW5nfEFycmF5fSBwbHVnaW5zIC0gQSBsaXN0IG9mIHBsdWdpbnMgdG8gaW5pdGlhbGl6ZS4gTGVhdmUgdGhpcyBvdXQgdG8gaW5pdGlhbGl6ZSBldmVyeXRoaW5nLlxuICAgKi9cbiAgcmVmbG93OiBmdW5jdGlvbihlbGVtLCBwbHVnaW5zKSB7XG5cbiAgICAvLyBJZiBwbHVnaW5zIGlzIHVuZGVmaW5lZCwganVzdCBncmFiIGV2ZXJ5dGhpbmdcbiAgICBpZiAodHlwZW9mIHBsdWdpbnMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBwbHVnaW5zID0gT2JqZWN0LmtleXModGhpcy5fcGx1Z2lucyk7XG4gICAgfVxuICAgIC8vIElmIHBsdWdpbnMgaXMgYSBzdHJpbmcsIGNvbnZlcnQgaXQgdG8gYW4gYXJyYXkgd2l0aCBvbmUgaXRlbVxuICAgIGVsc2UgaWYgKHR5cGVvZiBwbHVnaW5zID09PSAnc3RyaW5nJykge1xuICAgICAgcGx1Z2lucyA9IFtwbHVnaW5zXTtcbiAgICB9XG5cbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xuXG4gICAgLy8gSXRlcmF0ZSB0aHJvdWdoIGVhY2ggcGx1Z2luXG4gICAgJC5lYWNoKHBsdWdpbnMsIGZ1bmN0aW9uKGksIG5hbWUpIHtcbiAgICAgIC8vIEdldCB0aGUgY3VycmVudCBwbHVnaW5cbiAgICAgIHZhciBwbHVnaW4gPSBfdGhpcy5fcGx1Z2luc1tuYW1lXTtcblxuICAgICAgLy8gTG9jYWxpemUgdGhlIHNlYXJjaCB0byBhbGwgZWxlbWVudHMgaW5zaWRlIGVsZW0sIGFzIHdlbGwgYXMgZWxlbSBpdHNlbGYsIHVubGVzcyBlbGVtID09PSBkb2N1bWVudFxuICAgICAgdmFyICRlbGVtID0gJChlbGVtKS5maW5kKCdbZGF0YS0nK25hbWUrJ10nKS5hZGRCYWNrKCdbZGF0YS0nK25hbWUrJ10nKTtcblxuICAgICAgLy8gRm9yIGVhY2ggcGx1Z2luIGZvdW5kLCBpbml0aWFsaXplIGl0XG4gICAgICAkZWxlbS5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgJGVsID0gJCh0aGlzKSxcbiAgICAgICAgICAgIG9wdHMgPSB7fTtcbiAgICAgICAgLy8gRG9uJ3QgZG91YmxlLWRpcCBvbiBwbHVnaW5zXG4gICAgICAgIGlmICgkZWwuZGF0YSgnemZQbHVnaW4nKSkge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcIlRyaWVkIHRvIGluaXRpYWxpemUgXCIrbmFtZStcIiBvbiBhbiBlbGVtZW50IHRoYXQgYWxyZWFkeSBoYXMgYSBGb3VuZGF0aW9uIHBsdWdpbi5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoJGVsLmF0dHIoJ2RhdGEtb3B0aW9ucycpKXtcbiAgICAgICAgICB2YXIgdGhpbmcgPSAkZWwuYXR0cignZGF0YS1vcHRpb25zJykuc3BsaXQoJzsnKS5mb3JFYWNoKGZ1bmN0aW9uKGUsIGkpe1xuICAgICAgICAgICAgdmFyIG9wdCA9IGUuc3BsaXQoJzonKS5tYXAoZnVuY3Rpb24oZWwpeyByZXR1cm4gZWwudHJpbSgpOyB9KTtcbiAgICAgICAgICAgIGlmKG9wdFswXSkgb3B0c1tvcHRbMF1dID0gcGFyc2VWYWx1ZShvcHRbMV0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHRyeXtcbiAgICAgICAgICAkZWwuZGF0YSgnemZQbHVnaW4nLCBuZXcgcGx1Z2luKCQodGhpcyksIG9wdHMpKTtcbiAgICAgICAgfWNhdGNoKGVyKXtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGVyKTtcbiAgICAgICAgfWZpbmFsbHl7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgZ2V0Rm5OYW1lOiBmdW5jdGlvbk5hbWUsXG5cbiAgYWRkVG9KcXVlcnk6IGZ1bmN0aW9uKCQpIHtcbiAgICAvLyBUT0RPOiBjb25zaWRlciBub3QgbWFraW5nIHRoaXMgYSBqUXVlcnkgZnVuY3Rpb25cbiAgICAvLyBUT0RPOiBuZWVkIHdheSB0byByZWZsb3cgdnMuIHJlLWluaXRpYWxpemVcbiAgICAvKipcbiAgICAgKiBUaGUgRm91bmRhdGlvbiBqUXVlcnkgbWV0aG9kLlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfEFycmF5fSBtZXRob2QgLSBBbiBhY3Rpb24gdG8gcGVyZm9ybSBvbiB0aGUgY3VycmVudCBqUXVlcnkgb2JqZWN0LlxuICAgICAqL1xuICAgIHZhciBmb3VuZGF0aW9uID0gZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICB2YXIgdHlwZSA9IHR5cGVvZiBtZXRob2QsXG4gICAgICAgICAgJG5vSlMgPSAkKCcubm8tanMnKTtcblxuICAgICAgaWYoJG5vSlMubGVuZ3RoKXtcbiAgICAgICAgJG5vSlMucmVtb3ZlQ2xhc3MoJ25vLWpzJyk7XG4gICAgICB9XG5cbiAgICAgIGlmKHR5cGUgPT09ICd1bmRlZmluZWQnKXsvL25lZWRzIHRvIGluaXRpYWxpemUgdGhlIEZvdW5kYXRpb24gb2JqZWN0LCBvciBhbiBpbmRpdmlkdWFsIHBsdWdpbi5cbiAgICAgICAgTWVkaWFRdWVyeS5faW5pdCgpO1xuICAgICAgICBGb3VuZGF0aW9uLnJlZmxvdyh0aGlzKTtcbiAgICAgIH1lbHNlIGlmKHR5cGUgPT09ICdzdHJpbmcnKXsvL2FuIGluZGl2aWR1YWwgbWV0aG9kIHRvIGludm9rZSBvbiBhIHBsdWdpbiBvciBncm91cCBvZiBwbHVnaW5zXG4gICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTsvL2NvbGxlY3QgYWxsIHRoZSBhcmd1bWVudHMsIGlmIG5lY2Vzc2FyeVxuICAgICAgICB2YXIgcGx1Z0NsYXNzID0gdGhpcy5kYXRhKCd6ZlBsdWdpbicpOy8vZGV0ZXJtaW5lIHRoZSBjbGFzcyBvZiBwbHVnaW5cblxuICAgICAgICBpZihwbHVnQ2xhc3MgIT09IHVuZGVmaW5lZCAmJiBwbHVnQ2xhc3NbbWV0aG9kXSAhPT0gdW5kZWZpbmVkKXsvL21ha2Ugc3VyZSBib3RoIHRoZSBjbGFzcyBhbmQgbWV0aG9kIGV4aXN0XG4gICAgICAgICAgaWYodGhpcy5sZW5ndGggPT09IDEpey8vaWYgdGhlcmUncyBvbmx5IG9uZSwgY2FsbCBpdCBkaXJlY3RseS5cbiAgICAgICAgICAgICAgcGx1Z0NsYXNzW21ldGhvZF0uYXBwbHkocGx1Z0NsYXNzLCBhcmdzKTtcbiAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbihpLCBlbCl7Ly9vdGhlcndpc2UgbG9vcCB0aHJvdWdoIHRoZSBqUXVlcnkgY29sbGVjdGlvbiBhbmQgaW52b2tlIHRoZSBtZXRob2Qgb24gZWFjaFxuICAgICAgICAgICAgICBwbHVnQ2xhc3NbbWV0aG9kXS5hcHBseSgkKGVsKS5kYXRhKCd6ZlBsdWdpbicpLCBhcmdzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfWVsc2V7Ly9lcnJvciBmb3Igbm8gY2xhc3Mgb3Igbm8gbWV0aG9kXG4gICAgICAgICAgdGhyb3cgbmV3IFJlZmVyZW5jZUVycm9yKFwiV2UncmUgc29ycnksICdcIiArIG1ldGhvZCArIFwiJyBpcyBub3QgYW4gYXZhaWxhYmxlIG1ldGhvZCBmb3IgXCIgKyAocGx1Z0NsYXNzID8gZnVuY3Rpb25OYW1lKHBsdWdDbGFzcykgOiAndGhpcyBlbGVtZW50JykgKyAnLicpO1xuICAgICAgICB9XG4gICAgICB9ZWxzZXsvL2Vycm9yIGZvciBpbnZhbGlkIGFyZ3VtZW50IHR5cGVcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgV2UncmUgc29ycnksICR7dHlwZX0gaXMgbm90IGEgdmFsaWQgcGFyYW1ldGVyLiBZb3UgbXVzdCB1c2UgYSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBtZXRob2QgeW91IHdpc2ggdG8gaW52b2tlLmApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcbiAgICAkLmZuLmZvdW5kYXRpb24gPSBmb3VuZGF0aW9uO1xuICAgIHJldHVybiAkO1xuICB9XG59O1xuXG5Gb3VuZGF0aW9uLnV0aWwgPSB7XG4gIC8qKlxuICAgKiBGdW5jdGlvbiBmb3IgYXBwbHlpbmcgYSBkZWJvdW5jZSBlZmZlY3QgdG8gYSBmdW5jdGlvbiBjYWxsLlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyAtIEZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBhdCBlbmQgb2YgdGltZW91dC5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IGRlbGF5IC0gVGltZSBpbiBtcyB0byBkZWxheSB0aGUgY2FsbCBvZiBgZnVuY2AuXG4gICAqIEByZXR1cm5zIGZ1bmN0aW9uXG4gICAqL1xuICB0aHJvdHRsZTogZnVuY3Rpb24gKGZ1bmMsIGRlbGF5KSB7XG4gICAgdmFyIHRpbWVyID0gbnVsbDtcblxuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgY29udGV4dCA9IHRoaXMsIGFyZ3MgPSBhcmd1bWVudHM7XG5cbiAgICAgIGlmICh0aW1lciA9PT0gbnVsbCkge1xuICAgICAgICB0aW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgICAgdGltZXIgPSBudWxsO1xuICAgICAgICB9LCBkZWxheSk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufTtcblxud2luZG93LkZvdW5kYXRpb24gPSBGb3VuZGF0aW9uO1xuXG4vLyBQb2x5ZmlsbCBmb3IgcmVxdWVzdEFuaW1hdGlvbkZyYW1lXG4oZnVuY3Rpb24oKSB7XG4gIGlmICghRGF0ZS5ub3cgfHwgIXdpbmRvdy5EYXRlLm5vdylcbiAgICB3aW5kb3cuRGF0ZS5ub3cgPSBEYXRlLm5vdyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbmV3IERhdGUoKS5nZXRUaW1lKCk7IH07XG5cbiAgdmFyIHZlbmRvcnMgPSBbJ3dlYmtpdCcsICdtb3onXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB2ZW5kb3JzLmxlbmd0aCAmJiAhd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZTsgKytpKSB7XG4gICAgICB2YXIgdnAgPSB2ZW5kb3JzW2ldO1xuICAgICAgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA9IHdpbmRvd1t2cCsnUmVxdWVzdEFuaW1hdGlvbkZyYW1lJ107XG4gICAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUgPSAod2luZG93W3ZwKydDYW5jZWxBbmltYXRpb25GcmFtZSddXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCB3aW5kb3dbdnArJ0NhbmNlbFJlcXVlc3RBbmltYXRpb25GcmFtZSddKTtcbiAgfVxuICBpZiAoL2lQKGFkfGhvbmV8b2QpLipPUyA2Ly50ZXN0KHdpbmRvdy5uYXZpZ2F0b3IudXNlckFnZW50KVxuICAgIHx8ICF3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8ICF3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUpIHtcbiAgICB2YXIgbGFzdFRpbWUgPSAwO1xuICAgIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICAgICAgICB2YXIgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgdmFyIG5leHRUaW1lID0gTWF0aC5tYXgobGFzdFRpbWUgKyAxNiwgbm93KTtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNhbGxiYWNrKGxhc3RUaW1lID0gbmV4dFRpbWUpOyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0VGltZSAtIG5vdyk7XG4gICAgfTtcbiAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUgPSBjbGVhclRpbWVvdXQ7XG4gIH1cbiAgLyoqXG4gICAqIFBvbHlmaWxsIGZvciBwZXJmb3JtYW5jZS5ub3csIHJlcXVpcmVkIGJ5IHJBRlxuICAgKi9cbiAgaWYoIXdpbmRvdy5wZXJmb3JtYW5jZSB8fCAhd2luZG93LnBlcmZvcm1hbmNlLm5vdyl7XG4gICAgd2luZG93LnBlcmZvcm1hbmNlID0ge1xuICAgICAgc3RhcnQ6IERhdGUubm93KCksXG4gICAgICBub3c6IGZ1bmN0aW9uKCl7IHJldHVybiBEYXRlLm5vdygpIC0gdGhpcy5zdGFydDsgfVxuICAgIH07XG4gIH1cbn0pKCk7XG5pZiAoIUZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kKSB7XG4gIEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kID0gZnVuY3Rpb24ob1RoaXMpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIGNsb3Nlc3QgdGhpbmcgcG9zc2libGUgdG8gdGhlIEVDTUFTY3JpcHQgNVxuICAgICAgLy8gaW50ZXJuYWwgSXNDYWxsYWJsZSBmdW5jdGlvblxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQgLSB3aGF0IGlzIHRyeWluZyB0byBiZSBib3VuZCBpcyBub3QgY2FsbGFibGUnKTtcbiAgICB9XG5cbiAgICB2YXIgYUFyZ3MgICA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgIGZUb0JpbmQgPSB0aGlzLFxuICAgICAgICBmTk9QICAgID0gZnVuY3Rpb24oKSB7fSxcbiAgICAgICAgZkJvdW5kICA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBmVG9CaW5kLmFwcGx5KHRoaXMgaW5zdGFuY2VvZiBmTk9QXG4gICAgICAgICAgICAgICAgID8gdGhpc1xuICAgICAgICAgICAgICAgICA6IG9UaGlzLFxuICAgICAgICAgICAgICAgICBhQXJncy5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9O1xuXG4gICAgaWYgKHRoaXMucHJvdG90eXBlKSB7XG4gICAgICAvLyBuYXRpdmUgZnVuY3Rpb25zIGRvbid0IGhhdmUgYSBwcm90b3R5cGVcbiAgICAgIGZOT1AucHJvdG90eXBlID0gdGhpcy5wcm90b3R5cGU7XG4gICAgfVxuICAgIGZCb3VuZC5wcm90b3R5cGUgPSBuZXcgZk5PUCgpO1xuXG4gICAgcmV0dXJuIGZCb3VuZDtcbiAgfTtcbn1cbi8vIFBvbHlmaWxsIHRvIGdldCB0aGUgbmFtZSBvZiBhIGZ1bmN0aW9uIGluIElFOVxuZnVuY3Rpb24gZnVuY3Rpb25OYW1lKGZuKSB7XG4gIGlmIChGdW5jdGlvbi5wcm90b3R5cGUubmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdmFyIGZ1bmNOYW1lUmVnZXggPSAvZnVuY3Rpb25cXHMoW14oXXsxLH0pXFwoLztcbiAgICB2YXIgcmVzdWx0cyA9IChmdW5jTmFtZVJlZ2V4KS5leGVjKChmbikudG9TdHJpbmcoKSk7XG4gICAgcmV0dXJuIChyZXN1bHRzICYmIHJlc3VsdHMubGVuZ3RoID4gMSkgPyByZXN1bHRzWzFdLnRyaW0oKSA6IFwiXCI7XG4gIH1cbiAgZWxzZSBpZiAoZm4ucHJvdG90eXBlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gZm4uY29uc3RydWN0b3IubmFtZTtcbiAgfVxuICBlbHNlIHtcbiAgICByZXR1cm4gZm4ucHJvdG90eXBlLmNvbnN0cnVjdG9yLm5hbWU7XG4gIH1cbn1cbmZ1bmN0aW9uIHBhcnNlVmFsdWUoc3RyKXtcbiAgaWYgKCd0cnVlJyA9PT0gc3RyKSByZXR1cm4gdHJ1ZTtcbiAgZWxzZSBpZiAoJ2ZhbHNlJyA9PT0gc3RyKSByZXR1cm4gZmFsc2U7XG4gIGVsc2UgaWYgKCFpc05hTihzdHIgKiAxKSkgcmV0dXJuIHBhcnNlRmxvYXQoc3RyKTtcbiAgcmV0dXJuIHN0cjtcbn1cbi8vIENvbnZlcnQgUGFzY2FsQ2FzZSB0byBrZWJhYi1jYXNlXG4vLyBUaGFuayB5b3U6IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzg5NTU1ODBcbmZ1bmN0aW9uIGh5cGhlbmF0ZShzdHIpIHtcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCAnJDEtJDInKS50b0xvd2VyQ2FzZSgpO1xufVxuXG5leHBvcnQge0ZvdW5kYXRpb259O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5pbXBvcnQgJCBmcm9tICdqcXVlcnknO1xuXG4vLyBEZWZhdWx0IHNldCBvZiBtZWRpYSBxdWVyaWVzXG5jb25zdCBkZWZhdWx0UXVlcmllcyA9IHtcbiAgJ2RlZmF1bHQnIDogJ29ubHkgc2NyZWVuJyxcbiAgbGFuZHNjYXBlIDogJ29ubHkgc2NyZWVuIGFuZCAob3JpZW50YXRpb246IGxhbmRzY2FwZSknLFxuICBwb3J0cmFpdCA6ICdvbmx5IHNjcmVlbiBhbmQgKG9yaWVudGF0aW9uOiBwb3J0cmFpdCknLFxuICByZXRpbmEgOiAnb25seSBzY3JlZW4gYW5kICgtd2Via2l0LW1pbi1kZXZpY2UtcGl4ZWwtcmF0aW86IDIpLCcgK1xuICAgICdvbmx5IHNjcmVlbiBhbmQgKG1pbi0tbW96LWRldmljZS1waXhlbC1yYXRpbzogMiksJyArXG4gICAgJ29ubHkgc2NyZWVuIGFuZCAoLW8tbWluLWRldmljZS1waXhlbC1yYXRpbzogMi8xKSwnICtcbiAgICAnb25seSBzY3JlZW4gYW5kIChtaW4tZGV2aWNlLXBpeGVsLXJhdGlvOiAyKSwnICtcbiAgICAnb25seSBzY3JlZW4gYW5kIChtaW4tcmVzb2x1dGlvbjogMTkyZHBpKSwnICtcbiAgICAnb25seSBzY3JlZW4gYW5kIChtaW4tcmVzb2x1dGlvbjogMmRwcHgpJ1xuICB9O1xuXG5cbi8vIG1hdGNoTWVkaWEoKSBwb2x5ZmlsbCAtIFRlc3QgYSBDU1MgbWVkaWEgdHlwZS9xdWVyeSBpbiBKUy5cbi8vIEF1dGhvcnMgJiBjb3B5cmlnaHQgKGMpIDIwMTI6IFNjb3R0IEplaGwsIFBhdWwgSXJpc2gsIE5pY2hvbGFzIFpha2FzLCBEYXZpZCBLbmlnaHQuIER1YWwgTUlUL0JTRCBsaWNlbnNlXG5sZXQgbWF0Y2hNZWRpYSA9IHdpbmRvdy5tYXRjaE1lZGlhIHx8IChmdW5jdGlvbigpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8vIEZvciBicm93c2VycyB0aGF0IHN1cHBvcnQgbWF0Y2hNZWRpdW0gYXBpIHN1Y2ggYXMgSUUgOSBhbmQgd2Via2l0XG4gIHZhciBzdHlsZU1lZGlhID0gKHdpbmRvdy5zdHlsZU1lZGlhIHx8IHdpbmRvdy5tZWRpYSk7XG5cbiAgLy8gRm9yIHRob3NlIHRoYXQgZG9uJ3Qgc3VwcG9ydCBtYXRjaE1lZGl1bVxuICBpZiAoIXN0eWxlTWVkaWEpIHtcbiAgICB2YXIgc3R5bGUgICA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyksXG4gICAgc2NyaXB0ICAgICAgPSBkb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnc2NyaXB0JylbMF0sXG4gICAgaW5mbyAgICAgICAgPSBudWxsO1xuXG4gICAgc3R5bGUudHlwZSAgPSAndGV4dC9jc3MnO1xuICAgIHN0eWxlLmlkICAgID0gJ21hdGNobWVkaWFqcy10ZXN0JztcblxuICAgIHNjcmlwdCAmJiBzY3JpcHQucGFyZW50Tm9kZSAmJiBzY3JpcHQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoc3R5bGUsIHNjcmlwdCk7XG5cbiAgICAvLyAnc3R5bGUuY3VycmVudFN0eWxlJyBpcyB1c2VkIGJ5IElFIDw9IDggYW5kICd3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZScgZm9yIGFsbCBvdGhlciBicm93c2Vyc1xuICAgIGluZm8gPSAoJ2dldENvbXB1dGVkU3R5bGUnIGluIHdpbmRvdykgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoc3R5bGUsIG51bGwpIHx8IHN0eWxlLmN1cnJlbnRTdHlsZTtcblxuICAgIHN0eWxlTWVkaWEgPSB7XG4gICAgICBtYXRjaE1lZGl1bShtZWRpYSkge1xuICAgICAgICB2YXIgdGV4dCA9IGBAbWVkaWEgJHttZWRpYX17ICNtYXRjaG1lZGlhanMtdGVzdCB7IHdpZHRoOiAxcHg7IH0gfWA7XG5cbiAgICAgICAgLy8gJ3N0eWxlLnN0eWxlU2hlZXQnIGlzIHVzZWQgYnkgSUUgPD0gOCBhbmQgJ3N0eWxlLnRleHRDb250ZW50JyBmb3IgYWxsIG90aGVyIGJyb3dzZXJzXG4gICAgICAgIGlmIChzdHlsZS5zdHlsZVNoZWV0KSB7XG4gICAgICAgICAgc3R5bGUuc3R5bGVTaGVldC5jc3NUZXh0ID0gdGV4dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzdHlsZS50ZXh0Q29udGVudCA9IHRleHQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUZXN0IGlmIG1lZGlhIHF1ZXJ5IGlzIHRydWUgb3IgZmFsc2VcbiAgICAgICAgcmV0dXJuIGluZm8ud2lkdGggPT09ICcxcHgnO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbihtZWRpYSkge1xuICAgIHJldHVybiB7XG4gICAgICBtYXRjaGVzOiBzdHlsZU1lZGlhLm1hdGNoTWVkaXVtKG1lZGlhIHx8ICdhbGwnKSxcbiAgICAgIG1lZGlhOiBtZWRpYSB8fCAnYWxsJ1xuICAgIH07XG4gIH1cbn0pKCk7XG5cbnZhciBNZWRpYVF1ZXJ5ID0ge1xuICBxdWVyaWVzOiBbXSxcblxuICBjdXJyZW50OiAnJyxcblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgdGhlIG1lZGlhIHF1ZXJ5IGhlbHBlciwgYnkgZXh0cmFjdGluZyB0aGUgYnJlYWtwb2ludCBsaXN0IGZyb20gdGhlIENTUyBhbmQgYWN0aXZhdGluZyB0aGUgYnJlYWtwb2ludCB3YXRjaGVyLlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHByaXZhdGVcbiAgICovXG4gIF9pbml0KCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgJG1ldGEgPSAkKCdtZXRhLmZvdW5kYXRpb24tbXEnKTtcbiAgICBpZighJG1ldGEubGVuZ3RoKXtcbiAgICAgICQoJzxtZXRhIGNsYXNzPVwiZm91bmRhdGlvbi1tcVwiPicpLmFwcGVuZFRvKGRvY3VtZW50LmhlYWQpO1xuICAgIH1cblxuICAgIHZhciBleHRyYWN0ZWRTdHlsZXMgPSAkKCcuZm91bmRhdGlvbi1tcScpLmNzcygnZm9udC1mYW1pbHknKTtcbiAgICB2YXIgbmFtZWRRdWVyaWVzO1xuXG4gICAgbmFtZWRRdWVyaWVzID0gcGFyc2VTdHlsZVRvT2JqZWN0KGV4dHJhY3RlZFN0eWxlcyk7XG5cbiAgICBmb3IgKHZhciBrZXkgaW4gbmFtZWRRdWVyaWVzKSB7XG4gICAgICBpZihuYW1lZFF1ZXJpZXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICBzZWxmLnF1ZXJpZXMucHVzaCh7XG4gICAgICAgICAgbmFtZToga2V5LFxuICAgICAgICAgIHZhbHVlOiBgb25seSBzY3JlZW4gYW5kIChtaW4td2lkdGg6ICR7bmFtZWRRdWVyaWVzW2tleV19KWBcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jdXJyZW50ID0gdGhpcy5fZ2V0Q3VycmVudFNpemUoKTtcblxuICAgIHRoaXMuX3dhdGNoZXIoKTtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRoZSBzY3JlZW4gaXMgYXQgbGVhc3QgYXMgd2lkZSBhcyBhIGJyZWFrcG9pbnQuXG4gICAqIEBmdW5jdGlvblxuICAgKiBAcGFyYW0ge1N0cmluZ30gc2l6ZSAtIE5hbWUgb2YgdGhlIGJyZWFrcG9pbnQgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtCb29sZWFufSBgdHJ1ZWAgaWYgdGhlIGJyZWFrcG9pbnQgbWF0Y2hlcywgYGZhbHNlYCBpZiBpdCdzIHNtYWxsZXIuXG4gICAqL1xuICBhdExlYXN0KHNpemUpIHtcbiAgICB2YXIgcXVlcnkgPSB0aGlzLmdldChzaXplKTtcblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgcmV0dXJuIG1hdGNoTWVkaWEocXVlcnkpLm1hdGNoZXM7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgdGhlIHNjcmVlbiBtYXRjaGVzIHRvIGEgYnJlYWtwb2ludC5cbiAgICogQGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzaXplIC0gTmFtZSBvZiB0aGUgYnJlYWtwb2ludCB0byBjaGVjaywgZWl0aGVyICdzbWFsbCBvbmx5JyBvciAnc21hbGwnLiBPbWl0dGluZyAnb25seScgZmFsbHMgYmFjayB0byB1c2luZyBhdExlYXN0KCkgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7Qm9vbGVhbn0gYHRydWVgIGlmIHRoZSBicmVha3BvaW50IG1hdGNoZXMsIGBmYWxzZWAgaWYgaXQgZG9lcyBub3QuXG4gICAqL1xuICBpcyhzaXplKSB7XG4gICAgc2l6ZSA9IHNpemUudHJpbSgpLnNwbGl0KCcgJyk7XG4gICAgaWYoc2l6ZS5sZW5ndGggPiAxICYmIHNpemVbMV0gPT09ICdvbmx5Jykge1xuICAgICAgaWYoc2l6ZVswXSA9PT0gdGhpcy5fZ2V0Q3VycmVudFNpemUoKSkgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmF0TGVhc3Qoc2l6ZVswXSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICAvKipcbiAgICogR2V0cyB0aGUgbWVkaWEgcXVlcnkgb2YgYSBicmVha3BvaW50LlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHBhcmFtIHtTdHJpbmd9IHNpemUgLSBOYW1lIG9mIHRoZSBicmVha3BvaW50IHRvIGdldC5cbiAgICogQHJldHVybnMge1N0cmluZ3xudWxsfSAtIFRoZSBtZWRpYSBxdWVyeSBvZiB0aGUgYnJlYWtwb2ludCwgb3IgYG51bGxgIGlmIHRoZSBicmVha3BvaW50IGRvZXNuJ3QgZXhpc3QuXG4gICAqL1xuICBnZXQoc2l6ZSkge1xuICAgIGZvciAodmFyIGkgaW4gdGhpcy5xdWVyaWVzKSB7XG4gICAgICBpZih0aGlzLnF1ZXJpZXMuaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgICAgdmFyIHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW2ldO1xuICAgICAgICBpZiAoc2l6ZSA9PT0gcXVlcnkubmFtZSkgcmV0dXJuIHF1ZXJ5LnZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9LFxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGJyZWFrcG9pbnQgbmFtZSBieSB0ZXN0aW5nIGV2ZXJ5IGJyZWFrcG9pbnQgYW5kIHJldHVybmluZyB0aGUgbGFzdCBvbmUgdG8gbWF0Y2ggKHRoZSBiaWdnZXN0IG9uZSkuXG4gICAqIEBmdW5jdGlvblxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBOYW1lIG9mIHRoZSBjdXJyZW50IGJyZWFrcG9pbnQuXG4gICAqL1xuICBfZ2V0Q3VycmVudFNpemUoKSB7XG4gICAgdmFyIG1hdGNoZWQ7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVlcmllcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW2ldO1xuXG4gICAgICBpZiAobWF0Y2hNZWRpYShxdWVyeS52YWx1ZSkubWF0Y2hlcykge1xuICAgICAgICBtYXRjaGVkID0gcXVlcnk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBtYXRjaGVkID09PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIG1hdGNoZWQubmFtZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hdGNoZWQ7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBBY3RpdmF0ZXMgdGhlIGJyZWFrcG9pbnQgd2F0Y2hlciwgd2hpY2ggZmlyZXMgYW4gZXZlbnQgb24gdGhlIHdpbmRvdyB3aGVuZXZlciB0aGUgYnJlYWtwb2ludCBjaGFuZ2VzLlxuICAgKiBAZnVuY3Rpb25cbiAgICogQHByaXZhdGVcbiAgICovXG4gIF93YXRjaGVyKCkge1xuICAgICQod2luZG93KS5vZmYoJ3Jlc2l6ZS56Zi5tZWRpYXF1ZXJ5Jykub24oJ3Jlc2l6ZS56Zi5tZWRpYXF1ZXJ5JywgKCkgPT4ge1xuICAgICAgdmFyIG5ld1NpemUgPSB0aGlzLl9nZXRDdXJyZW50U2l6ZSgpLCBjdXJyZW50U2l6ZSA9IHRoaXMuY3VycmVudDtcblxuICAgICAgaWYgKG5ld1NpemUgIT09IGN1cnJlbnRTaXplKSB7XG4gICAgICAgIC8vIENoYW5nZSB0aGUgY3VycmVudCBtZWRpYSBxdWVyeVxuICAgICAgICB0aGlzLmN1cnJlbnQgPSBuZXdTaXplO1xuXG4gICAgICAgIC8vIEJyb2FkY2FzdCB0aGUgbWVkaWEgcXVlcnkgY2hhbmdlIG9uIHRoZSB3aW5kb3dcbiAgICAgICAgJCh3aW5kb3cpLnRyaWdnZXIoJ2NoYW5nZWQuemYubWVkaWFxdWVyeScsIFtuZXdTaXplLCBjdXJyZW50U2l6ZV0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59O1xuXG5cblxuLy8gVGhhbmsgeW91OiBodHRwczovL2dpdGh1Yi5jb20vc2luZHJlc29yaHVzL3F1ZXJ5LXN0cmluZ1xuZnVuY3Rpb24gcGFyc2VTdHlsZVRvT2JqZWN0KHN0cikge1xuICB2YXIgc3R5bGVPYmplY3QgPSB7fTtcblxuICBpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gc3R5bGVPYmplY3Q7XG4gIH1cblxuICBzdHIgPSBzdHIudHJpbSgpLnNsaWNlKDEsIC0xKTsgLy8gYnJvd3NlcnMgcmUtcXVvdGUgc3RyaW5nIHN0eWxlIHZhbHVlc1xuXG4gIGlmICghc3RyKSB7XG4gICAgcmV0dXJuIHN0eWxlT2JqZWN0O1xuICB9XG5cbiAgc3R5bGVPYmplY3QgPSBzdHIuc3BsaXQoJyYnKS5yZWR1Y2UoZnVuY3Rpb24ocmV0LCBwYXJhbSkge1xuICAgIHZhciBwYXJ0cyA9IHBhcmFtLnJlcGxhY2UoL1xcKy9nLCAnICcpLnNwbGl0KCc9Jyk7XG4gICAgdmFyIGtleSA9IHBhcnRzWzBdO1xuICAgIHZhciB2YWwgPSBwYXJ0c1sxXTtcbiAgICBrZXkgPSBkZWNvZGVVUklDb21wb25lbnQoa2V5KTtcblxuICAgIC8vIG1pc3NpbmcgYD1gIHNob3VsZCBiZSBgbnVsbGA6XG4gICAgLy8gaHR0cDovL3czLm9yZy9UUi8yMDEyL1dELXVybC0yMDEyMDUyNC8jY29sbGVjdC11cmwtcGFyYW1ldGVyc1xuICAgIHZhbCA9IHZhbCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGRlY29kZVVSSUNvbXBvbmVudCh2YWwpO1xuXG4gICAgaWYgKCFyZXQuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgcmV0W2tleV0gPSB2YWw7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHJldFtrZXldKSkge1xuICAgICAgcmV0W2tleV0ucHVzaCh2YWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXRba2V5XSA9IFtyZXRba2V5XSwgdmFsXTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfSwge30pO1xuXG4gIHJldHVybiBzdHlsZU9iamVjdDtcbn1cblxuZXhwb3J0IHtNZWRpYVF1ZXJ5fTtcbiIsIi8qKlxuICogQGZpbGVcbiAqIFJlcGxhY2VzIHJlZmVyZW5jZXMgdG8gU1ZHIGZpbGVzIHdpdGggZnVsbCBTVkcgbWFya3VwIGlubGluZS5cbiAqL1xuXG4oZnVuY3Rpb24gc3ZnSW5qZWN0b3IoJCwgRHJ1cGFsLCBTdmdJbmplY3Rvcikge1xuICAvKipcbiAgICogUmVwbGFjZXMgaW1hZ2VzIHdpdGggc3JjIG9yIGRhdGEtc3JjIGF0dHJpYnV0ZSB3aXRoIGZ1bGwgU1ZHIG1hcmt1cCBpbmxpbmUuXG4gICAqXG4gICAqIFRoZXJlIGFyZSBhIG51bWJlciBvZiB3YXlzIHRvIHVzZSBTVkcgb24gYSBwYWdlIChvYmplY3QsIGVtYmVkLCBpZnJhbWUsXG4gICAqIGltZywgQ1NTIGJhY2tncm91bmQtaW1hZ2UpIGJ1dCB0byB1bmxvY2sgdGhlIGZ1bGwgcG90ZW50aWFsIG9mIFNWRyxcbiAgICogaW5jbHVkaW5nIGZ1bGwgZWxlbWVudC1sZXZlbCBDU1Mgc3R5bGluZyBhbmQgZXZhbHVhdGlvbiBvZiBlbWJlZGRlZFxuICAgKiBKYXZhU2NyaXB0LCB0aGUgZnVsbCBTVkcgbWFya3VwIG11c3QgYmUgaW5jbHVkZWQgZGlyZWN0bHkgaW4gdGhlIERPTS5cbiAgICpcbiAgICogV3JhbmdsaW5nIGFuZCBtYWludGFpbmluZyBhIGJ1bmNoIG9mIGlubGluZSBTVkcgb24geW91ciBwYWdlcyBpc24ndFxuICAgKiBhbnlvbmUncyBpZGVhIG9mIGdvb2QgdGltZSwgc28gU1ZHSW5qZWN0b3IgbGV0cyB5b3Ugd29yayB3aXRoIHNpbXBsZSBpbWdcbiAgICogdGFnIGVsZW1lbnRzIChvciBvdGhlciB0YWcgb2YgeW91ciBjaG9vc2luZykgYW5kIGRvZXMgdGhlIGhlYXZ5IGxpZnRpbmcgb2ZcbiAgICogc3dhcHBpbmcgaW4gdGhlIFNWRyBtYXJrdXAgaW5saW5lIGZvciB5b3UuXG4gICAqXG4gICAqIEB0eXBlIHtEcnVwYWx+YmVoYXZpb3J9XG4gICAqXG4gICAqIEBwcm9wIHtEcnVwYWx+YmVoYXZpb3JBdHRhY2h9IGF0dGFjaFxuICAgKiAgIEF0dGFjaGVzIHRoZSBiZWhhdmlvciBmb3IgcmVwbGFjaW5nIGltYWdlcy5cbiAgICovXG4gIERydXBhbC5iZWhhdmlvcnMuc3ZnSW5qZWN0b3IgPSB7XG4gICAgYXR0YWNoKGNvbnRleHQpIHtcbiAgICAgIGNvbnN0IGVsZW1lbnRzID0gJCgnaW1nLnN2Zy1pbmplY3QnLCBjb250ZXh0KS5vbmNlKCdzdmctaW5qZWN0JykuZ2V0KCk7XG4gICAgICBTdmdJbmplY3RvcihlbGVtZW50cyk7XG4gICAgfSxcbiAgfTtcbn0oalF1ZXJ5LCBEcnVwYWwsIFNWR0luamVjdG9yKSk7XG4iXX0=
